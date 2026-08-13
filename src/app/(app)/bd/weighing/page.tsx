import { q, q1 } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { WeighingForm, type Product, type CrateType, type ClassOpt } from "./WeighingForm";
import { TodaysRecords, type RecordRow } from "./TodaysRecords";
import { toISODate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "BD Weighing Entry · PMAI Warehouse" };

async function setting<T>(key: string, fallback: T): Promise<T> {
  const row = await q1<{ value: T }>(
    "SELECT value FROM app_settings WHERE scope='global' AND key=$1",
    [key]
  );
  return (row?.value ?? fallback) as T;
}

export default async function WeighingPage() {
  const user = await requirePermission("bd.weighing.view");

  const today = toISODate();
  const futureDays = await setting<number>("weighing.future_days", 1);
  const maxDate = toISODate(new Date(Date.now() + futureDays * 86400000));

  const [classes, products, crateTypes, records, labelSize, autoPrint, fillSpace] =
    await Promise.all([
      q<ClassOpt>(
        "SELECT id, code, name FROM product_classes WHERE is_active ORDER BY sort_order, code"
      ),
      q<Product>(
        `SELECT p.id, p.sku, pc.code AS class_code, p.band_code, p.band_min_kg, p.band_max_kg
           FROM products p JOIN product_classes pc ON pc.id = p.class_id
          WHERE p.is_active AND p.band_code IS NOT NULL
          ORDER BY pc.sort_order, p.sort_order`
      ),
      q<CrateType>(
        "SELECT id, code, name, tare_kg, default_heads FROM crate_types WHERE is_active ORDER BY sort_order"
      ),
      q<RecordRow>(
        `SELECT c.id AS crate_id, c.crate_no, p.sku, p.band_code, c.heads,
                c.net_weight_kg, c.weighed_at, c.status::text AS status, u.full_name AS weighed_by
           FROM crates c
           JOIN products p ON p.id = c.product_id
           LEFT JOIN users u ON u.id = c.weighed_by
          WHERE c.production_date = current_date AND NOT c.is_voided
          ORDER BY c.weighed_at DESC
          LIMIT 500`
      ),
      setting<string>("label.size", "5x3"),
      setting<boolean>("label.auto_print", true),
      setting<boolean>("label.fill_space", false),
    ]);

  const skus = [...new Set(records.map((r) => r.sku))].sort();

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <WeighingForm
        classes={classes}
        products={products}
        crateTypes={crateTypes}
        today={today}
        maxDate={maxDate}
        canUnlockDate={can(user, "bd.weighing.unlock_date")}
        labelSize={labelSize}
        autoPrint={autoPrint}
        fillSpace={fillSpace}
      />
      <TodaysRecords
        rows={records}
        skus={skus}
        canDelete={can(user, "bd.weighing.delete")}
      />
    </div>
  );
}
