"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

export async function receiveFromFps(code: string, locationId: string): Promise<MoveResult> {
  const user = await requirePermission("wh.receiving.manage");
  const res = await moveCrate({
    crateCode: code,
    toStatus: "fps_processed",
    user,
    toLocationId: locationId ? Number(locationId) : null,
    module: "Warehouse",
    expectFrom: ["issued_to_fps"],
  });
  if (res.ok) revalidatePath("/wh/fps-receiving-station");
  return res;
}
