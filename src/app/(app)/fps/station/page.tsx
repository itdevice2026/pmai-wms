import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { StationClient } from "./StationClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FPS Station · PMAI Warehouse" };

export default async function Page() {
  await requirePermission("fps.station.use");

  const [runs, products] = await Promise.all([
    q<{ id: number; fps_no: string; input_weight_kg: string; output_weight_kg: string; yield_pct: string | null }>(
      `SELECT id, fps_no, input_weight_kg, output_weight_kg, yield_pct
         FROM fps_processings WHERE status='in_progress' ORDER BY created_at DESC`
    ),
    q<{ id: number; sku: string; name: string }>(
      "SELECT id, sku, name FROM products WHERE is_active AND stage IN ('fps','cut') ORDER BY sku"
    ),
  ]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FPS Station</h1>
        <p className="mt-1 text-sm text-slate-500">
          Shop-floor terminal: scan input crates in, record finished output crates out.
        </p>
      </div>
      <StationClient runs={runs} products={products} />
    </>
  );
}
