"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

export async function scanIntoWarehouse(
  code: string,
  locationId: string
): Promise<MoveResult> {
  const user = await requirePermission("bd.scan.use");

  const res = await moveCrate({
    crateCode: code,
    toStatus: "warehouse",
    user,
    toLocationId: locationId ? Number(locationId) : null,
    module: "Basic Dressing",
    expectFrom: ["production"],
  });

  if (res.ok) revalidatePath("/bd/scan-station");
  return res;
}
