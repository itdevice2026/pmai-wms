import { ReportView, type SearchParams } from "@/components/ReportView";
import { REPORTS } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: `${REPORTS["unscanned-crates"].title} · PMAI Warehouse` };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <ReportView id="unscanned-crates" searchParams={await searchParams} />;
}
