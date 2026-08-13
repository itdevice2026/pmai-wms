"use server";

import { revalidatePath } from "next/cache";
import { q1, tx, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

export async function scanInput(code: string, fpsId: string): Promise<MoveResult> {
  const user = await requirePermission("fps.station.use");
  if (!fpsId) return { ok: false, message: "No run selected." };

  const run = await q1<{ id: number; fps_no: string; status: string }>(
    "SELECT id, fps_no, status::text AS status FROM fps_processings WHERE id=$1",
    [Number(fpsId)]
  );
  if (!run) return { ok: false, message: "Run not found." };
  if (run.status !== "in_progress") return { ok: false, message: `Run ${run.fps_no} is ${run.status}.` };

  const res = await moveCrate({
    crateCode: code,
    toStatus: "issued_to_fps",
    user,
    module: "Further Processing",
    refTable: "fps_processings",
    refId: run.id,
    refNo: run.fps_no,
    expectFrom: ["warehouse", "storage"],
  });
  if (!res.ok) return res;

  const crate = await q1<{ id: string; product_id: number; net_weight_kg: string }>(
    "SELECT id, product_id, net_weight_kg FROM crates WHERE crate_no=$1",
    [code.trim()]
  );

  await tx(async (client) => {
    await client.query(
      `INSERT INTO fps_inputs (fps_id, crate_id, product_id, weight_kg, issued_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [run.id, crate!.id, crate!.product_id, crate!.net_weight_kg, user.id]
    );
    await client.query(
      `UPDATE fps_processings f SET input_weight_kg = s.wt,
              yield_pct = CASE WHEN s.wt > 0 THEN round(100 * f.output_weight_kg / s.wt, 3) END
         FROM (SELECT COALESCE(sum(weight_kg),0) wt FROM fps_inputs WHERE fps_id=$1) s
        WHERE f.id = $1`,
      [run.id]
    );
  });

  revalidatePath("/fps/station");
  return { ...res, message: `Input to ${run.fps_no}` };
}

export async function recordOutput(formData: FormData): Promise<{
  ok: boolean; error?: string; crateNo?: string;
}> {
  const user = await requirePermission("fps.station.use");

  const fpsId = Number(formData.get("fpsId"));
  const productId = Number(formData.get("productId"));
  const weightKg = Number(formData.get("weightKg"));
  const heads = formData.get("heads") ? Number(formData.get("heads")) : null;

  if (!fpsId || !productId) return { ok: false, error: "Choose a run and an output product." };
  if (!(weightKg > 0)) return { ok: false, error: "Weight must be greater than zero." };

  const run = await q1<{ fps_no: string; process_date: string; status: string }>(
    "SELECT fps_no, process_date::text AS process_date, status::text AS status FROM fps_processings WHERE id=$1",
    [fpsId]
  );
  if (!run) return { ok: false, error: "Run not found." };
  if (run.status !== "in_progress") return { ok: false, error: `Run ${run.fps_no} is ${run.status}.` };

  const plant = await q1<{ id: number; code: string }>("SELECT id, code FROM plants ORDER BY id LIMIT 1");
  const product = await q1<{ shelf_life_days: number | null; sku: string }>(
    "SELECT shelf_life_days, sku FROM products WHERE id=$1", [productId]
  );

  const crateNo = await tx(async (client) => {
    const stamp = run.process_date.replace(/-/g, "");
    const seq = await client.query<{ last_value: string }>(
      `INSERT INTO doc_sequences(key, prefix, last_value) VALUES ($1,'CRATE',1)
       ON CONFLICT (key) DO UPDATE SET last_value = doc_sequences.last_value + 1
       RETURNING last_value`,
      [`CRATE-${stamp}`]
    );
    const no = `${plant!.code}-${stamp}-${String(Number(seq.rows[0].last_value)).padStart(4, "0")}-P1`;

    const crate = await client.query<{ id: string }>(
      `INSERT INTO crates (crate_no, plant_id, product_id, production_date, expiry_date,
                           heads, net_weight_kg, gross_weight_kg, status, weighed_at, weighed_by)
       VALUES ($1,$2,$3,$4::date,
               CASE WHEN $5::int IS NULL THEN NULL ELSE $4::date + $5::int END,
               $6,$7,$7,'fps_processed', now(), $8)
       RETURNING id`,
      [no, plant!.id, productId, run.process_date, product?.shelf_life_days ?? null, heads, weightKg, user.id]
    );

    await client.query(
      `INSERT INTO fps_outputs (fps_id, crate_id, product_id, weight_kg, produced_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [fpsId, crate.rows[0].id, productId, weightKg, user.id]
    );
    await client.query(
      `INSERT INTO crate_movements (crate_id, kind, to_status, weight_kg, user_id, ref_table, ref_no)
       VALUES ($1,'fps_receive','fps_processed',$2,$3,'fps_processings',$4)`,
      [crate.rows[0].id, weightKg, user.id, run.fps_no]
    );
    await client.query(
      `UPDATE fps_processings f SET output_weight_kg = s.wt,
              yield_pct = CASE WHEN f.input_weight_kg > 0
                               THEN round(100 * s.wt / f.input_weight_kg, 3) END
         FROM (SELECT COALESCE(sum(weight_kg),0) wt FROM fps_outputs WHERE fps_id=$1) s
        WHERE f.id = $1`,
      [fpsId]
    );
    return no;
  });

  await logActivity({
    userId: user.id, module: "Further Processing", action: "produce", entity: "fps_outputs",
    description: `Produced ${crateNo} (${product?.sku}, ${weightKg} kg) on ${run.fps_no}`,
  });

  revalidatePath("/fps/station");
  return { ok: true, crateNo };
}

export async function closeRun(fpsId: string): Promise<{ ok: boolean; error?: string; fpsNo?: string }> {
  const user = await requirePermission("fps.station.use");
  const id = Number(fpsId);
  if (!id) return { ok: false, error: "No run selected." };

  const run = await q1<{ fps_no: string; input_weight_kg: string; output_weight_kg: string }>(
    "SELECT fps_no, input_weight_kg, output_weight_kg FROM fps_processings WHERE id=$1", [id]
  );
  if (!run) return { ok: false, error: "Run not found." };

  await q1(
    "UPDATE fps_processings SET status='completed', ended_at=now() WHERE id=$1 RETURNING id", [id]
  );
  await logActivity({
    userId: user.id, module: "Further Processing", action: "complete", entity: "fps_processings",
    entityId: id,
    description: `Closed ${run.fps_no} — in ${run.input_weight_kg} kg, out ${run.output_weight_kg} kg`,
  });

  revalidatePath("/fps/station");
  return { ok: true, fpsNo: run.fps_no };
}
