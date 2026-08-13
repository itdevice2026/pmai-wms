"use server";

import { revalidatePath } from "next/cache";
import { q1, tx } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export type ImportResult = {
  ok: boolean;
  error?: string;
  total?: number;
  success?: number;
  failed?: number;
  errors?: string[];
};

/**
 * Import weighing records from CSV.
 * Expected header: production_date,sku,weight_kg,heads[,crate_type]
 */
export async function importWeighings(formData: FormData): Promise<ImportResult> {
  const user = await requirePermission("bd.import.use");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file to import." };
  }
  if (file.size > 5_000_000) {
    return { ok: false, error: "File is larger than 5 MB — split it into smaller batches." };
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { ok: false, error: "The file has no data rows." };

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const need = ["production_date", "sku", "weight_kg", "heads"];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length) {
    return { ok: false, error: `Missing column(s): ${missing.join(", ")}` };
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const plant = await q1<{ id: number; code: string }>("SELECT id, code FROM plants ORDER BY id LIMIT 1");
  const defaultType = await q1<{ id: number; tare_kg: string }>(
    "SELECT id, tare_kg FROM crate_types WHERE code='FULL'"
  );

  const errors: string[] = [];
  let success = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const rowNo = i + 1;
    const date = cols[idx["production_date"]];
    const sku = cols[idx["sku"]];
    const weight = Number(cols[idx["weight_kg"]]);
    const heads = Number(cols[idx["heads"]]);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      errors.push(`Row ${rowNo}: production_date must be YYYY-MM-DD`);
      continue;
    }
    if (!(weight > 0)) { errors.push(`Row ${rowNo}: weight_kg must be > 0`); continue; }
    if (!Number.isInteger(heads) || heads < 0) { errors.push(`Row ${rowNo}: heads must be a whole number`); continue; }

    const product = await q1<{ id: number; shelf_life_days: number | null }>(
      "SELECT id, shelf_life_days FROM products WHERE sku=$1 AND is_active", [sku]
    );
    if (!product) { errors.push(`Row ${rowNo}: unknown SKU "${sku}"`); continue; }

    const locked = await q1<{ locked: boolean }>(
      "SELECT is_locked('weighing_records', NULL, $1::date) AS locked", [date]
    );
    if (locked?.locked) { errors.push(`Row ${rowNo}: ${date} is locked`); continue; }

    try {
      await tx(async (client) => {
        const stamp = date.replace(/-/g, "");
        const seq = await client.query<{ last_value: string }>(
          `INSERT INTO doc_sequences(key, prefix, last_value) VALUES ($1,'CRATE',1)
           ON CONFLICT (key) DO UPDATE SET last_value = doc_sequences.last_value + 1
           RETURNING last_value`,
          [`CRATE-${stamp}`]
        );
        const no = `${plant!.code}-${stamp}-${String(Number(seq.rows[0].last_value)).padStart(4, "0")}-P1`;
        const tare = Number(defaultType?.tare_kg ?? 0);
        const net = weight - tare;

        const crate = await client.query<{ id: string }>(
          `INSERT INTO crates (crate_no, plant_id, product_id, crate_type_id, production_date,
                               expiry_date, heads, gross_weight_kg, tare_weight_kg, net_weight_kg,
                               status, weighed_at, weighed_by)
           VALUES ($1,$2,$3,$4,$5::date,
                   CASE WHEN $6::int IS NULL THEN NULL ELSE $5::date + $6::int END,
                   $7,$8,$9,$10,'production',now(),$11) RETURNING id`,
          [no, plant!.id, product.id, defaultType?.id ?? null, date,
           product.shelf_life_days, heads, weight, tare, net, user.id]
        );
        await client.query(
          `INSERT INTO weighing_records (crate_id, product_id, crate_type_id, production_date,
                                         heads, gross_weight_kg, tare_weight_kg, net_weight_kg, weighed_by)
           VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
          [crate.rows[0].id, product.id, defaultType?.id ?? null, date, heads, weight, tare, net, user.id]
        );
        await client.query(
          `INSERT INTO crate_movements (crate_id, kind, to_status, weight_kg, user_id, ref_table, ref_no)
           VALUES ($1,'bd_weighing','production',$2,$3,'import_batches',$4)`,
          [crate.rows[0].id, net, user.id, file.name]
        );
      });
      success++;
    } catch (e) {
      errors.push(`Row ${rowNo}: ${e instanceof Error ? e.message : "insert failed"}`);
    }
  }

  const total = lines.length - 1;
  await q1(
    `INSERT INTO import_batches (filename, target, row_count, success_count, error_count, errors, imported_by)
     VALUES ($1,'weighing',$2,$3,$4,$5::jsonb,$6) RETURNING id`,
    [file.name, total, success, errors.length, JSON.stringify(errors.slice(0, 200)), user.id]
  );

  await logActivity({
    userId: user.id, module: "Basic Dressing", action: "import", entity: "import_batches",
    description: `Imported ${success}/${total} weighing rows from ${file.name}`,
  });

  revalidatePath("/bd/import");
  return { ok: true, total, success, failed: errors.length, errors: errors.slice(0, 50) };
}
