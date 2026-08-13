"use server";

import { revalidatePath } from "next/cache";
import { q, q1, tx, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

export async function createPicklist(formData: FormData) {
  const user = await requirePermission("wh.picklist.manage");

  const customerId = Number(formData.get("customerId"));
  const strategy = String(formData.get("strategy") ?? "fefo");
  const requiredDate = String(formData.get("requiredDate") ?? "");
  if (!customerId) return { ok: false as const, error: "Choose a customer." };

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const picklistNo = await nextDocNo("PCK");

  const row = await q1<{ id: number }>(
    `INSERT INTO picklists (picklist_no, plant_id, customer_id, strategy, status,
                            required_at, created_by)
     VALUES ($1,$2,$3,$4,'in_progress',
             CASE WHEN $5 = '' THEN NULL ELSE $5::timestamptz END, $6)
     RETURNING id`,
    [picklistNo, plant!.id, customerId, strategy, requiredDate, user.id]
  );

  await logActivity({
    userId: user.id, module: "Warehouse", action: "create", entity: "picklists",
    entityId: row!.id, description: `Opened picklist ${picklistNo}`,
  });

  revalidatePath("/wh/picklist");
  return { ok: true as const, picklistId: row!.id, picklistNo };
}

export async function addLine(formData: FormData) {
  const user = await requirePermission("wh.picklist.manage");

  const picklistId = Number(formData.get("picklistId"));
  const productId = Number(formData.get("productId"));
  const requiredKg = Number(formData.get("requiredKg"));
  if (!picklistId || !productId || !(requiredKg > 0)) {
    return { ok: false as const, error: "Choose a SKU and enter a positive weight." };
  }

  const product = await q1<{ sku: string }>("SELECT sku FROM products WHERE id=$1", [productId]);

  await tx(async (client) => {
    await client.query(
      `INSERT INTO picklist_lines (picklist_id, product_id, required_weight_kg)
       VALUES ($1,$2,$3)`,
      [picklistId, productId, requiredKg]
    );
    await client.query(
      `UPDATE picklists p SET total_weight_kg = s.wt
         FROM (SELECT COALESCE(sum(required_weight_kg),0) wt
                 FROM picklist_lines WHERE picklist_id=$1) s
        WHERE p.id = $1`,
      [picklistId]
    );
  });

  await logActivity({
    userId: user.id, module: "Warehouse", action: "update", entity: "picklist_lines",
    description: `Added ${product?.sku} × ${requiredKg} kg to picklist ${picklistId}`,
  });

  revalidatePath("/wh/picklist");
  return { ok: true as const, sku: product?.sku, requiredKg };
}

/**
 * Suggest crates for the outstanding lines, oldest first.
 * FEFO orders by expiry; FIFO by production date. Suggestions are advisory —
 * stock only moves when a crate is physically scanned.
 */
export async function suggestFefo(picklistId: string) {
  await requirePermission("wh.picklist.manage");
  const id = Number(picklistId);
  if (!id) return { ok: false as const, error: "No picklist selected." };

  const pl = await q1<{ strategy: string }>("SELECT strategy FROM picklists WHERE id=$1", [id]);
  const orderBy =
    pl?.strategy === "fifo"
      ? "c.production_date, c.crate_no"
      : "COALESCE(c.expiry_date, c.production_date + 365), c.production_date, c.crate_no";

  const suggestions = await q<{
    crate_no: string; sku: string; production_date: string;
    net_weight_kg: string; location_code: string | null; age_days: number;
  }>(
    `WITH needed AS (
       SELECT pl.product_id,
              pl.required_weight_kg - pl.picked_weight_kg AS remaining
         FROM picklist_lines pl
        WHERE pl.picklist_id = $1 AND pl.required_weight_kg > pl.picked_weight_kg
     ),
     ranked AS (
       SELECT c.crate_no, p.sku, c.production_date::text AS production_date,
              c.net_weight_kg, l.code AS location_code,
              (current_date - c.production_date)::int AS age_days,
              n.remaining,
              sum(c.net_weight_kg) OVER (
                PARTITION BY c.product_id ORDER BY ${orderBy}
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
         FROM crates c
         JOIN products p ON p.id = c.product_id
         JOIN needed n ON n.product_id = c.product_id
         LEFT JOIN locations l ON l.id = c.location_id
        WHERE NOT c.is_voided
          AND c.status IN ('warehouse','storage','wh_received_cut','fps_processed')
     )
     SELECT crate_no, sku, production_date, net_weight_kg, location_code, age_days
       FROM ranked
      WHERE running - net_weight_kg < remaining
      ORDER BY sku, age_days DESC
      LIMIT 200`,
    [id]
  );

  return { ok: true as const, suggestions };
}

export async function scanPick(code: string, picklistId: string): Promise<MoveResult> {
  const user = await requirePermission("wh.picklist.manage");
  if (!picklistId) return { ok: false, message: "No picklist selected." };

  const pl = await q1<{ id: number; picklist_no: string; status: string }>(
    "SELECT id, picklist_no, status::text AS status FROM picklists WHERE id=$1",
    [Number(picklistId)]
  );
  if (!pl) return { ok: false, message: "Picklist not found." };
  if (!["draft", "in_progress"].includes(pl.status)) {
    return { ok: false, message: `Picklist ${pl.picklist_no} is ${pl.status}.` };
  }

  const crate = await q1<{ id: string; product_id: number; net_weight_kg: string; sku: string }>(
    `SELECT c.id, c.product_id, c.net_weight_kg, p.sku
       FROM crates c JOIN products p ON p.id = c.product_id
      WHERE c.crate_no = $1 AND NOT c.is_voided`,
    [code.trim()]
  );
  if (!crate) return { ok: false, message: `Unknown crate ${code}` };

  const line = await q1<{ id: string }>(
    "SELECT id FROM picklist_lines WHERE picklist_id=$1 AND product_id=$2 LIMIT 1",
    [pl.id, crate.product_id]
  );
  if (!line) {
    return {
      ok: false,
      message: `${crate.sku} is not on this picklist`,
      crateNo: code.trim(),
      sku: crate.sku,
    };
  }

  const res = await moveCrate({
    crateCode: code,
    toStatus: "picked",
    user,
    module: "Warehouse",
    refTable: "picklists",
    refId: pl.id,
    refNo: pl.picklist_no,
    expectFrom: ["warehouse", "storage", "wh_received_cut", "fps_processed"],
  });
  if (!res.ok) return res;

  await tx(async (client) => {
    await client.query(
      `INSERT INTO picklist_picks (picklist_line_id, crate_id, weight_kg, picked_by)
       VALUES ($1,$2,$3,$4)`,
      [line.id, crate.id, crate.net_weight_kg, user.id]
    );
    await client.query(
      `UPDATE picklist_lines pl SET picked_weight_kg = s.wt
         FROM (SELECT COALESCE(sum(weight_kg),0) wt FROM picklist_picks
                WHERE picklist_line_id = $1) s
        WHERE pl.id = $1`,
      [line.id]
    );
    await client.query(
      `UPDATE picklists p SET picked_weight_kg = s.wt
         FROM (SELECT COALESCE(sum(picked_weight_kg),0) wt FROM picklist_lines
                WHERE picklist_id = $1) s
        WHERE p.id = $1`,
      [pl.id]
    );
  });

  revalidatePath("/wh/picklist");
  return { ...res, message: `Picked onto ${pl.picklist_no}` };
}

export async function completePicklist(picklistId: string) {
  const user = await requirePermission("wh.picklist.manage");
  const id = Number(picklistId);
  if (!id) return { ok: false as const, error: "No picklist selected." };

  const pl = await q1<{ picklist_no: string; picked_weight_kg: string }>(
    "SELECT picklist_no, picked_weight_kg FROM picklists WHERE id=$1",
    [id]
  );
  if (!pl) return { ok: false as const, error: "Picklist not found." };
  if (Number(pl.picked_weight_kg) <= 0) {
    return { ok: false as const, error: "Nothing has been picked yet." };
  }

  await q1(
    "UPDATE picklists SET status='completed', picked_by=$2 WHERE id=$1 RETURNING id",
    [id, user.id]
  );

  await logActivity({
    userId: user.id, module: "Warehouse", action: "complete", entity: "picklists",
    entityId: id, description: `Completed picklist ${pl.picklist_no}`,
  });

  revalidatePath("/wh/picklist");
  return { ok: true as const, picklistNo: pl.picklist_no };
}
