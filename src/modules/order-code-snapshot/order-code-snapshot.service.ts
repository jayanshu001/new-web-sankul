/**
 * Order · code snapshot service.
 *
 * Builds the purchase-time JSON object that create-order writes into an order's
 * `promocode` / `refferalcode` columns. One builder shared by every checkout
 * path (course, package, ebook) so all order tables carry the same shape.
 *
 * WHY AN OBJECT AND NOT THE CODE STRING: the columns are a read contract, not
 * storage. `modules/promoter-data` computes the entire promoter dashboard —
 * attributed subscriptions, revenue and commission — by JSON-path querying the
 * order row (`$.promoterId`, `$.promotedPackageCourseEbook[0].promoterPercentage`).
 * A bare string satisfies the column type but matches none of those paths, so a
 * flattened order is invisible to promoter attribution and pays out nothing.
 *
 * WHY A SNAPSHOT AND NOT A JOIN: the promocode's percentages are editable and
 * plans get repriced. Commission must be computed against the terms in force at
 * purchase, so the row is frozen into the order rather than resolved live.
 *
 * Failure policy: a snapshot is reporting metadata, never a reason to fail a
 * payment. Every builder returns null when its source rows are missing, and the
 * caller stores null rather than blocking checkout.
 */
import { orderCodeSnapshotRepository as repo } from "./order-code-snapshot.repository";
import { toPromocodeSnapshot, toReferralSnapshot } from "./order-code-snapshot.transformer";
import type {
  OrderCodeSnapshots,
  PromocodeSnapshot,
  ReferralSnapshot,
} from "./order-code-snapshot.types";

export const ORDER_CODE_SNAPSHOT_MODULE = "order-code-snapshot";

/**
 * Snapshot a redeemed promocode against the purchased plan. Returns null if the
 * promocode row has since been deleted.
 */
export const buildPromocodeSnapshot = async (
  promocodeId: number,
  planId: number
): Promise<PromocodeSnapshot | null> => {
  const [promo, link] = await Promise.all([
    repo.findPromocode(promocodeId),
    repo.findPlanLink(promocodeId, planId),
  ]);
  if (!promo) return null;
  return toPromocodeSnapshot(promo, link);
};

/**
 * Snapshot a redeemed customer referral code against the purchased plan.
 * Returns null if the program or the referring customer can't be resolved.
 */
export const buildReferralSnapshot = async (
  referrerId: number,
  planId: number
): Promise<ReferralSnapshot | null> => {
  const [program, referrer, plan] = await Promise.all([
    repo.findReferralProgram(),
    repo.findReferrer(referrerId),
    repo.findPlan(planId),
  ]);
  if (!program || !referrer) return null;
  return toReferralSnapshot(program, referrer, plan);
};

/**
 * The single call a create-order path makes. Exactly one snapshot is ever
 * produced: `referrerId` is set only by the referral branch of
 * `resolvePromoForPlanSql` (which returns an empty `promo._id`), so the two
 * inputs are mutually exclusive by construction — the referral case is checked
 * first regardless, so a malformed pair can never yield two snapshots.
 *
 * Both null (no code redeemed) is the common case and costs no queries.
 */
export const buildOrderCodeSnapshots = async (input: {
  promocodeId: number | null;
  referrerId: number | null;
  planId: number;
}): Promise<OrderCodeSnapshots> => {
  if (input.referrerId) {
    return {
      promocode: null,
      refferalcode: await buildReferralSnapshot(input.referrerId, input.planId),
    };
  }
  if (input.promocodeId) {
    return {
      promocode: await buildPromocodeSnapshot(input.promocodeId, input.planId),
      refferalcode: null,
    };
  }
  return { promocode: null, refferalcode: null };
};
