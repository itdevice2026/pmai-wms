import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { toCSV } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requirePermission("report.view");
  const byPallet = new URL(req.url).searchParams.get("tab") === "pallet";

  const rows = byPallet
    ? await q(
        `SELECT pallet_no AS "Pallet", storage_room AS "Room", location_code AS "Slot",
                section AS "Section", sku AS "SKU", production_date AS "Production Date",
                age_days AS "Age (days)", crate_count AS "Crates",
                head_count AS "Heads", total_weight_kg AS "Weight (kg)"
           FROM v_stock_on_hand_by_pallet
          ORDER BY storage_room, location_code, pallet_no, sku`
      )
    : await q(
        `SELECT section AS "Section", sku AS "SKU", product_name AS "Product",
                production_date AS "Production Date", age_days AS "Age (days)",
                crate_count AS "Crates", head_count AS "Heads",
                total_weight_kg AS "Weight (kg)"
           FROM v_stock_on_hand_by_date
          ORDER BY section, sku, production_date`
      );

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCSV(rows as Record<string, unknown>[]), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="stock-on-hand-${byPallet ? "by-pallet" : "by-date"}-${stamp}.csv"`,
    },
  });
}
