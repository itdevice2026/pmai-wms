import { reportCsv } from "@/lib/report-export";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return reportCsv("crate-audit", req);
}
