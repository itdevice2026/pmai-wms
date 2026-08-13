import { ReportView, type SearchParams } from "@/components/ReportView";
import { REPORTS } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: `${REPORTS["pallets"].title} · PMAI Warehouse` };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <ReportView id="pallets" searchParams={await searchParams} />;
}
