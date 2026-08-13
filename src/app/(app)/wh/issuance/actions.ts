"use server";

import { revalidatePath } from "next/cache";
import { q1, tx, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

/** Purpose determines which crate status the issuance drives the crate into. */
const TARGET_STATUS: Record<string, string> = {
  fps: "issued_to_fps",
  cutting: "cutting",
  customer: "picked",
  sample: "picked",
  disposal: "picked",
};

export async function createIssuance(formData: FormData): Promise<{
  ok: boolean;
  issuanceId?: number;
  issuanceNo?: string;
  error?: string;
}> {
  const user = await requirePermission("wh.issuance.manage");

  const purpose = String(formData.get("purpose") ?? "").trim();
  if (!TARGET_STATUS[purpose]) return { ok: false, error: "Choose a valid purpose." };

  const customerId = formData.get("customerId") ? Number(formData.get("customerId")) : null;
  const jobOrderId = formData.get("jobOrderId") ? Number(formData.get("jobOrderId")) : null;
  const remarks = String(formData.get("remarks") ?? "").trim();

  if (purpose === "customer" && !customerId) {
    return { ok: false, error: "Choose a customer for a customer issuance." };
  }

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const issuanceNo = await nextDocNo("ISS");

  const row = await q1<{ id: number }>(
    `INSERT INTO issuances (issuance_no, plant_id, purpose, customer_id, job_order_id,
                            status, requested_by, issued_by, remarks)
     VALUES ($1,$2,$3,$4,$5,'in_progress',$6,$6,NULLIF($7,''))
     RETURNING id`,
    [issuanceNo, plant!.id, purpose, customerId, jobOrderId, user.id, remarks]
  );

  await logActivity({
    userId: user.id,
    module: "Warehouse",
    action: "create",
    entity: "issuances",
    entityId: row!.id,
    description: `Opened issuance ${issuanceNo} (${purpose})`,
  });

  revalidatePath("/wh/issuance");
  return { ok: true, issuanceId: row!.id, issuanceNo };
}

export async function scanOntoIssuance(code: string, issuanceId: string): Promise<MoveResult> {
  const user = await requirePermission("wh.issuance.manage");
  if (!issuanceId) return { ok: false, message: "No issuance selected." };

  const iss = await q1<{ id: number; issuance_no: string; purpose: string; status: string }>(
    "SELECT id, issuance_no, purpose, status::text AS status FROM issuances WHERE id=$1",
    [Number(issuanceId)]
  );
  if (!iss) return { ok: false, message: "Issuance not found." };
  if (!["draft", "in_progress"].includes(iss.status)) {
    return { ok: false, message: `Issuance ${iss.issuance_no} is ${iss.status}.` };
  }

  const toStatus = TARGET_STATUS[iss.purpose];

  const res = await moveCrate({
    crateCode: code,
    toStatus,
    user,
    module: "Warehouse",
    refTable: "issuances",
    refId: iss.id,
    refNo: iss.issuance_no,
    expectFrom: ["warehouse", "storage", "wh_received_cut", "fps_processed"],
  });

  if (!res.ok) return res;

  // Record the line and roll up the header totals.
  const crate = await q1<{ id: string; product_id: number; net_weight_kg: string }>(
    "SELECT id, product_id, net_weight_kg FROM crates WHERE crate_no=$1",
    [code.trim()]
  );

  await tx(async (client) => {
    await client.query(
      `INSERT INTO issuance_lines (issuance_id, crate_id, product_id, weight_kg, scanned_at, scanned_by)
       VALUES ($1,$2,$3,$4,now(),$5)`,
      [iss.id, crate!.id, crate!.product_id, crate!.net_weight_kg, user.id]
    );
    await client.query(
      `UPDATE issuances i
          SET crate_count = s.cnt, total_weight_kg = s.wt
         FROM (SELECT count(*) cnt, COALESCE(sum(weight_kg),0) wt
                 FROM issuance_lines WHERE issuance_id = $1) s
        WHERE i.id = $1`,
      [iss.id]
    );
  });

  revalidatePath("/wh/issuance");
  return { ...res, message: `Issued on ${iss.issuance_no}` };
}

export async function completeIssuance(issuanceId: string): Promise<{
  ok: boolean;
  issuanceNo?: string;
  error?: string;
}> {
  const user = await requirePermission("wh.issuance.manage");
  if (!issuanceId) return { ok: false, error: "No issuance selected." };

  const iss = await q1<{ issuance_no: string; crate_count: number }>(
    "SELECT issuance_no, crate_count FROM issuances WHERE id=$1",
    [Number(issuanceId)]
  );
  if (!iss) return { ok: false, error: "Issuance not found." };
  if (iss.crate_count === 0) return { ok: false, error: "Issuance has no crates." };

  await q1(
    "UPDATE issuances SET status='completed', completed_at=now() WHERE id=$1 RETURNING id",
    [Number(issuanceId)]
  );

  await logActivity({
    userId: user.id,
    module: "Warehouse",
    action: "complete",
    entity: "issuances",
    entityId: Number(issuanceId),
    description: `Completed issuance ${iss.issuance_no} (${iss.crate_count} crates)`,
  });

  revalidatePath("/wh/issuance");
  return { ok: true, issuanceNo: iss.issuance_no };
}
