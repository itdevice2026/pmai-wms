import { ReportView, type SearchParams } from "@/components/ReportView";
import { REPORTS } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: `${REPORTS["dispatch-summary"].title} · PMAI Warehouse` };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <ReportView id="dispatch-summary" searchParams={await searchParams} />;
}
