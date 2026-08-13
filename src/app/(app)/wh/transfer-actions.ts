"use server";

import { revalidatePath } from "next/cache";
import { transferCrate, transferPallet, type TransferKind } from "@/lib/transfer-flow";
import type { MoveResult } from "@/lib/crate-flow";

export async function doCrateTransfer(
  kind: TransferKind,
  code: string,
  slotId: string
): Promise<MoveResult> {
  const res = await transferCrate(kind, code, Number(slotId));
  if (res.ok) {
    revalidatePath(`/wh/${kind}-transfer`);
    revalidatePath("/wh/storage-map");
  }
  return res;
}

export async function doPalletTransfer(code: string, slotId: string): Promise<MoveResult> {
  const res = await transferPallet(code, Number(slotId));
  if (res.ok) {
    revalidatePath("/wh/pallet-transfer");
    revalidatePath("/wh/storage-map");
  }
  return res;
}
