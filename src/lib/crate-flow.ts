import { q1, tx } from "./db";
import type { SessionUser } from "./auth";
import { logActivity } from "./auth";

/**
 * The crate lifecycle, in one place.
 *
 * Every screen that advances a crate goes through `moveCrate`, so the legal
 * transitions, the locking rules and the movement ledger stay consistent no
 * matter which terminal the operator is standing at.
 */
export const CRATE_FLOW: Record<string, string[]> = {
  production: ["warehouse", "voided"],
  warehouse: ["storage", "cutting", "issued_to_fps", "picked"],
  storage: ["cutting", "issued_to_fps", "picked", "warehouse"],
  cutting: ["wh_received_cut"],
  issued_to_fps: ["fps_processed"],
  fps_processed: ["storage", "picked"],
  wh_received_cut: ["storage", "picked"],
  picked: ["dispatched", "storage"],
  dispatched: [],
  voided: [],
};

export type MoveResult = {
  ok: boolean;
  message: string;
  crateNo?: string;
  sku?: string;
  weightKg?: number;
  toStatus?: string;
};

export type MoveOptions = {
  crateCode: string;
  toStatus: string;
  user: SessionUser;
  /** Target slot; pass null to leave the location unchanged. */
  toLocationId?: number | null;
  /** Attach to (or detach from) a pallet. */
  toPalletId?: number | null;
  refTable?: string;
  refId?: number;
  refNo?: string;
  module?: string;
  /** Reject the scan unless the crate is currently in one of these statuses. */
  expectFrom?: string[];
};

export async function moveCrate(opts: MoveOptions): Promise<MoveResult> {
  const {
    crateCode, toStatus, user, toLocationId, toPalletId,
    refTable, refId, refNo, module = "Warehouse", expectFrom,
  } = opts;

  const code = crateCode.trim();
  if (!code) return { ok: false, message: "No crate code scanned." };

  const crate = await q1<{
    id: string;
    crate_no: string;
    status: string;
    net_weight_kg: string;
    production_date: string;
    sku: string;
    is_voided: boolean;
  }>(
    `SELECT c.id, c.crate_no, c.status::text AS status, c.net_weight_kg,
            c.production_date, p.sku, c.is_voided
       FROM crates c JOIN products p ON p.id = c.product_id
      WHERE c.crate_no = $1`,
    [code]
  );

  if (!crate) return { ok: false, message: `Unknown crate ${code}` };
  if (crate.is_voided) return { ok: false, message: `${crate.crate_no} is voided`, crateNo: crate.crate_no };

  const weightKg = Number(crate.net_weight_kg);

  if (crate.status === toStatus) {
    return {
      ok: false,
      message: `Already ${toStatus.replace(/_/g, " ")}`,
      crateNo: crate.crate_no,
      sku: crate.sku,
      weightKg,
    };
  }

  if (expectFrom && !expectFrom.includes(crate.status)) {
    return {
      ok: false,
      message: `Crate is ${crate.status.replace(/_/g, " ")} — expected ${expectFrom
        .map((s) => s.replace(/_/g, " "))
        .join(" or ")}`,
      crateNo: crate.crate_no,
      sku: crate.sku,
      weightKg,
    };
  }

  const allowed = CRATE_FLOW[crate.status] ?? [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      message: `Cannot go ${crate.status.replace(/_/g, " ")} → ${toStatus.replace(/_/g, " ")}`,
      crateNo: crate.crate_no,
      sku: crate.sku,
      weightKg,
    };
  }

  // Respect period locks on the crate's production date.
  const locked = await q1<{ locked: boolean }>(
    "SELECT is_locked('crates', NULL, $1::date) AS locked",
    [crate.production_date]
  );
  if (locked?.locked) {
    return {
      ok: false,
      message: `Production date is locked — cannot move ${crate.crate_no}`,
      crateNo: crate.crate_no,
      sku: crate.sku,
      weightKg,
    };
  }

  await tx(async (client) => {
    await client.query(
      `UPDATE crates
          SET status = $2::crate_status,
              location_id = COALESCE($3, location_id),
              pallet_id   = CASE WHEN $4::bigint IS NULL THEN pallet_id ELSE $4::bigint END
        WHERE id = $1`,
      [crate.id, toStatus, toLocationId ?? null, toPalletId ?? null]
    );

    // The AFTER UPDATE trigger writes the movement row but cannot know who did
    // it — stamp the actor and document reference onto that row here.
    await client.query(
      `UPDATE crate_movements
          SET user_id = $2, ref_table = $3, ref_id = $4, ref_no = $5
        WHERE id = (SELECT max(id) FROM crate_movements WHERE crate_id = $1)`,
      [crate.id, user.id, refTable ?? null, refId ?? null, refNo ?? null]
    );
  });

  await logActivity({
    userId: user.id,
    module,
    action: "move",
    entity: "crates",
    entityId: crate.id,
    description: `${crate.crate_no} ${crate.status} → ${toStatus}${refNo ? ` (${refNo})` : ""}`,
  });

  return {
    ok: true,
    message: `${crate.status.replace(/_/g, " ")} → ${toStatus.replace(/_/g, " ")}`,
    crateNo: crate.crate_no,
    sku: crate.sku,
    weightKg,
    toStatus,
  };
}
