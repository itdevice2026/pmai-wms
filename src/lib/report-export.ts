import { q } from "./db";
import { requirePermission } from "./auth";
import { REPORTS } from "./reports";
import { resolveParams, type SearchParams } from "@/components/ReportView";
import { toCSV, kg, num, dateStr, dateTimeStr } from "./format";

/** Shared CSV export for every registry-defined report. */
export async function reportCsv(id: string, req: Request): Promise<Response> {
  const def = REPORTS[id];
  if (!def) return new Response("Unknown report", { status: 404 });

  await requirePermission(def.permission);

  const url = new URL(req.url);
  const sp: SearchParams = Object.fromEntries(url.searchParams.entries());
  const { params } = resolveParams(def, sp);

  const rows = (await q(def.sql, params)) as Record<string, unknown>[];

  // Re-label and format columns so the CSV matches what's on screen.
  const shaped = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of def.columns) {
      const v = r[c.key];
      out[c.header] =
        v === null || v === undefined
          ? ""
          : c.format === "kg"
            ? kg(v)
            : c.format === "num"
              ? num(v)
              : c.format === "date"
                ? dateStr(v)
                : c.format === "datetime"
                  ? dateTimeStr(v)
                  : String(v);
    }
    return out;
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCSV(shaped), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${id}-${stamp}.csv"`,
    },
  });
}
