"use server";

import { revalidatePath } from "next/cache";
import { q1, tx, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

export async function createDispatch(formData: FormData) {
  const user = await requirePermission("wh.dispatch.manage");

  const customerId = Number(formData.get("customerId"));
  const picklistId = formData.get("picklistId") ? Number(formData.get("picklistId")) : null;
  const dispatchDate = String(formData.get("dispatchDate") ?? "");
  if (!customerId) return { ok: false as const, error: "Choose a customer." };

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const dispatchNo = await nextDocNo("DSP");

  const row = await q1<{ id: number }>(
    `INSERT INTO dispatches (dispatch_no, picklist_id, plant_id, customer_id, dispatch_date,
                             status, released_by)
     VALUES ($1,$2,$3,$4, COALESCE(NULLIF($5,'')::date, current_date), 'in_progress', $6)
     RETURNING id`,
    [dispatchNo, picklistId, plant!.id, customerId, dispatchDate, user.id]
  );

  await logActivity({
    userId: user.id, module: "Warehouse", action: "create", entity: "dispatches",
    entityId: row!.id, description: `Opened dispatch ${dispatchNo}`,
  });

  revalidatePath("/wh/dispatch");
  return { ok: true as const, dispatchId: row!.id, dispatchNo };
}

export async function scanOntoDispatch(code: string, dispatchId: string): Promise<MoveResult> {
  const user = await requirePermission("wh.dispatch.manage");
  if (!dispatchId) return { ok: false, message: "No dispatch selected." };

  const d = await q1<{ id: number; dispatch_no: string; status: string }>(
    "SELECT id, dispatch_no, status::text AS status FROM dispatches WHERE id=$1",
    [Number(dispatchId)]
  );
  if (!d) return { ok: false, message: "Dispatch not found." };
  if (!["draft", "in_progress"].includes(d.status)) {
    return { ok: false, message: `Dispatch ${d.dispatch_no} is ${d.status}.` };
  }

  // Only picked crates may be loaded — this is what stops unpicked stock
  // leaving the building.
  const res = await moveCrate({
    crateCode: code,
    toStatus: "dispatched",
    user,
    module: "Warehouse",
    refTable: "dispatches",
    refId: d.id,
    refNo: d.dispatch_no,
    expectFrom: ["picked"],
  });
  if (!res.ok) return res;

  const crate = await q1<{ id: string; product_id: number; net_weight_kg: string; pallet_id: string | null }>(
    "SELECT id, product_id, net_weight_kg, pallet_id FROM crates WHERE crate_no=$1",
    [code.trim()]
  );

  await tx(async (client) => {
    await client.query(
      `INSERT INTO dispatch_lines (dispatch_id, crate_id, pallet_id, product_id, weight_kg)
       VALUES ($1,$2,$3,$4,$5)`,
      [d.id, crate!.id, crate!.pallet_id, crate!.product_id, crate!.net_weight_kg]
    );
    await client.query(
      `UPDATE dispatches dd SET total_weight_kg = s.wt
         FROM (SELECT COALESCE(sum(weight_kg),0) wt FROM dispatch_lines WHERE dispatch_id=$1) s
        WHERE dd.id = $1`,
      [d.id]
    );
  });

  revalidatePath("/wh/dispatch");
  return { ...res, message: `Loaded onto ${d.dispatch_no}` };
}

export async function releaseDispatch(formData: FormData) {
  const user = await requirePermission("wh.dispatch.release");

  const dispatchId = Number(formData.get("dispatchId"));
  const drNo = String(formData.get("drNo") ?? "").trim();
  const plateNo = String(formData.get("plateNo") ?? "").trim();
  const driverName = String(formData.get("driverName") ?? "").trim();
  const truckTempRaw = String(formData.get("truckTempC") ?? "").trim();

  if (!dispatchId) return { ok: false as const, error: "No dispatch selected." };
  if (!drNo || !plateNo) return { ok: false as const, error: "DR number and plate are required." };

  const truckTempC = truckTempRaw === "" ? null : Number(truckTempRaw);
  if (truckTempC !== null && !Number.isFinite(truckTempC)) {
    return { ok: false as const, error: "Truck temperature must be a number." };
  }

  const d = await q1<{ dispatch_no: string; crates: number }>(
    `SELECT d.dispatch_no,
            (SELECT count(*) FROM dispatch_lines dl WHERE dl.dispatch_id = d.id)::int AS crates
       FROM dispatches d WHERE d.id = $1`,
    [dispatchId]
  );
  if (!d) return { ok: false as const, error: "Dispatch not found." };
  if (d.crates === 0) return { ok: false as const, error: "Nothing has been loaded yet." };

  await q1(
    `UPDATE dispatches
        SET dr_no=$2, plate_no=$3, driver_name=NULLIF($4,''), truck_temp_c=$5,
            status='completed', departed_at=now(), checked_by=$6
      WHERE id=$1 RETURNING id`,
    [dispatchId, drNo, plateNo, driverName, truckTempC, user.id]
  );

  await logActivity({
    userId: user.id, module: "Warehouse", action: "release", entity: "dispatches",
    entityId: dispatchId,
    description: `Released ${d.dispatch_no} — DR ${drNo}, plate ${plateNo}, ${d.crates} crates`,
  });

  revalidatePath("/wh/dispatch");
  return { ok: true as const, dispatchNo: d.dispatch_no, crates: d.crates };
}
