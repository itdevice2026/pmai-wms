"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { q, q1, tx } from "@/lib/db";
import { requirePermission, can, logActivity } from "@/lib/auth";

const SaveSchema = z.object({
  productId: z.coerce.number().int().positive(),
  crateTypeId: z.coerce.number().int().positive(),
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.coerce.number().positive().max(500),
  heads: z.coerce.number().int().min(0).max(200),
});

export type SaveResult = {
  ok: boolean;
  error?: string;
  crateNo?: string;
  netKg?: number;
};

/** Read a global setting, falling back to the supplied default. */
async function setting<T>(key: string, fallback: T): Promise<T> {
  const row = await q1<{ value: T }>(
    "SELECT value FROM app_settings WHERE scope='global' AND key=$1",
    [key]
  );
  return (row?.value ?? fallback) as T;
}

export async function saveWeighing(formData: FormData): Promise<SaveResult> {
  const user = await requirePermission("bd.weighing.manage");

  const parsed = SaveSchema.safeParse({
    productId: formData.get("productId"),
    crateTypeId: formData.get("crateTypeId"),
    productionDate: formData.get("productionDate"),
    weightKg: formData.get("weightKg"),
    heads: formData.get("heads"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the entered values." };
  }
  const { productId, crateTypeId, productionDate, weightKg, heads } = parsed.data;

  // --- Production date window -------------------------------------------------
  const futureDays = await setting<number>("weighing.future_days", 1);
  const operatorsMayEdit = await setting<boolean>("weighing.operators_can_edit_date", false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const entered = new Date(productionDate + "T00:00:00");
  const diffDays = Math.round((entered.getTime() - today.getTime()) / 86400000);

  if (diffDays > futureDays) {
    return {
      ok: false,
      error: `Production date can only be set up to ${futureDays} day${futureDays === 1 ? "" : "s"} ahead.`,
    };
  }
  const isBackdated = diffDays < 0;
  if (isBackdated && !operatorsMayEdit && !can(user, "bd.weighing.unlock_date")) {
    return {
      ok: false,
      error: "Back-dating is locked for operators. Ask a supervisor to unlock.",
    };
  }

  // --- Period lock ------------------------------------------------------------
  const locked = await q1<{ locked: boolean }>(
    "SELECT is_locked('weighing_records', NULL, $1::date) AS locked",
    [productionDate]
  );
  if (locked?.locked) {
    return { ok: false, error: `Production date ${productionDate} is locked. No new entries allowed.` };
  }

  // --- Resolve tare and shelf life -------------------------------------------
  const crateType = await q1<{ tare_kg: string; name: string }>(
    "SELECT tare_kg, name FROM crate_types WHERE id=$1 AND is_active",
    [crateTypeId]
  );
  if (!crateType) return { ok: false, error: "Unknown crate type." };

  const product = await q1<{ sku: string; shelf_life_days: number | null }>(
    "SELECT sku, shelf_life_days FROM products WHERE id=$1 AND is_active",
    [productId]
  );
  if (!product) return { ok: false, error: "Unknown SKU." };

  const tare = Number(crateType.tare_kg);
  const net = Number((weightKg - tare).toFixed(3));
  if (net <= 0) {
    return { ok: false, error: `Weight must exceed the ${tare} kg tare for ${crateType.name}.` };
  }

  const plant = await q1<{ id: number; code: string }>("SELECT id, code FROM plants ORDER BY id LIMIT 1");
  if (!plant) return { ok: false, error: "No plant configured." };

  try {
    const crateNo = await tx(async (client) => {
      // Sequence is per production date, matching PMAI-YYYYMMDD-####-P1
      const stamp = productionDate.replace(/-/g, "");
      const seqRow = await client.query<{ last_value: string }>(
        `INSERT INTO doc_sequences(key, prefix, last_value)
         VALUES ($1, $2, 1)
         ON CONFLICT (key) DO UPDATE SET last_value = doc_sequences.last_value + 1
         RETURNING last_value`,
        [`CRATE-${stamp}`, "CRATE"]
      );
      const seq = Number(seqRow.rows[0].last_value);
      const no = `${plant.code}-${stamp}-${String(seq).padStart(4, "0")}-P1`;

      const crate = await client.query<{ id: string }>(
        `INSERT INTO crates
           (crate_no, plant_id, product_id, crate_type_id, production_date, expiry_date,
            heads, gross_weight_kg, tare_weight_kg, net_weight_kg, status,
            weighed_at, weighed_by)
         VALUES ($1,$2,$3,$4,$5::date,
                 CASE WHEN $6::int IS NULL THEN NULL ELSE $5::date + $6::int END,
                 $7,$8,$9,$10,'production', now(), $11)
         RETURNING id`,
        [
          no, plant.id, productId, crateTypeId, productionDate,
          product.shelf_life_days, heads, weightKg, tare, net, user.id,
        ]
      );

      await client.query(
        `INSERT INTO weighing_records
           (crate_id, product_id, crate_type_id, production_date, heads,
            gross_weight_kg, tare_weight_kg, net_weight_kg, weighed_at, weighed_by)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8, now(), $9)`,
        [crate.rows[0].id, productId, crateTypeId, productionDate, heads, weightKg, tare, net, user.id]
      );

      // The crate row is INSERTed as 'production', so the AFTER UPDATE trigger
      // does not fire. Record the originating movement explicitly.
      await client.query(
        `INSERT INTO crate_movements (crate_id, kind, to_status, weight_kg, user_id, ref_table, ref_no)
         VALUES ($1,'bd_weighing','production',$2,$3,'weighing_records',$4)`,
        [crate.rows[0].id, net, user.id, no]
      );

      return no;
    });

    await logActivity({
      userId: user.id,
      module: "Basic Dressing",
      action: "weigh",
      entity: "crates",
      description: `Weighed ${crateNo} · ${product.sku} · ${net} kg · ${heads} heads`,
    });

    revalidatePath("/bd/weighing");
    return { ok: true, crateNo, netKg: net };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the weighing." };
  }
}

export async function deleteWeighing(crateId: number): Promise<SaveResult> {
  const user = await requirePermission("bd.weighing.delete");

  const crate = await q1<{ crate_no: string; status: string }>(
    "SELECT crate_no, status::text AS status FROM crates WHERE id=$1",
    [crateId]
  );
  if (!crate) return { ok: false, error: "Crate not found." };
  if (crate.status !== "production") {
    return {
      ok: false,
      error: `${crate.crate_no} has already moved to ${crate.status.replace(/_/g, " ")} and cannot be deleted here.`,
    };
  }

  await tx(async (client) => {
    await client.query(
      "UPDATE weighing_records SET is_deleted=true, deleted_by=$2, deleted_at=now() WHERE crate_id=$1",
      [crateId, user.id]
    );
    await client.query("UPDATE crates SET is_voided=true, status='voided' WHERE id=$1", [crateId]);
  });

  await logActivity({
    userId: user.id,
    module: "Basic Dressing",
    action: "delete",
    entity: "crates",
    entityId: crateId,
    description: `Voided weighing record ${crate.crate_no}`,
  });

  revalidatePath("/bd/weighing");
  return { ok: true, crateNo: crate.crate_no };
}

export async function updateLabelSetting(key: string, value: unknown) {
  await requirePermission("bd.weighing.manage");
  await q(
    `INSERT INTO app_settings (scope, key, value) VALUES ('global', $1, $2::jsonb)
     ON CONFLICT (key) WHERE scope='global'
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  revalidatePath("/bd/weighing");
}
