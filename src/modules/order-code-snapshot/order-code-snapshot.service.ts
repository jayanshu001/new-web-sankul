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
import {
  toLiveSnapshotPlan,
  toPromocodeSnapshot,
  toReferralSnapshot,
  toSnapshotPlan,
  toTestSeriesSnapshotPlan,
} from "./order-code-snapshot.transformer";
import type {
  OrderCodeSnapshots,
  PromocodeSnapshot,
  ReferralSnapshot,
  SnapshotPlan,
  SnapshotPlanKind,
} from "./order-code-snapshot.types";

export const ORDER_CODE_SNAPSHOT_MODULE = "order-code-snapshot";

/**
 * The purchased plan, read from whichever table `planKind` names, in the one
 * SnapshotPlan shape. Centralised so a new plan kind can never be half-wired: every
 * builder resolves its plan through here.
 */
const resolvePlan = async (
  planId: number,
  planKind: SnapshotPlanKind
): Promise<SnapshotPlan | null> => {
  if (planKind === "livePlan") return toLiveSnapshotPlan(await repo.findLivePlan(planId));
  if (planKind === "testSeriesPrice") return toTestSeriesSnapshotPlan(await repo.findTestSeriesPlan(planId));
  return toSnapshotPlan(await repo.findPlan(planId));
};

/**
 * Snapshot a redeemed promocode against the purchased plan. Returns null if the
 * promocode row has since been deleted.
 *
 * `planKind` selects both the link row and the plan table — see
 * repository.findPlanLink for why matching on the plan id alone is unsafe.
 */
export const buildPromocodeSnapshot = async (
  promocodeId: number,
  planId: number,
  planKind: SnapshotPlanKind = "price"
): Promise<PromocodeSnapshot | null> => {
  const [promo, link] = await Promise.all([
    repo.findPromocode(promocodeId),
    repo.findPlanLink(promocodeId, planId, planKind),
  ]);
  if (!promo) return null;
  // A "price" link carries its plan on the relation already loaded; a "livePlan" or
  // "testSeriesPrice" link cannot (its FK points at the wrong table), so read that
  // plan separately. No link at all → a global-discount promocode → no plan to embed.
  const linkPlan = !link
    ? null
    : planKind !== "price"
      ? await resolvePlan(planId, planKind)
      : toSnapshotPlan((link as { packageCourseEbookPrice?: any }).packageCourseEbookPrice ?? null);
  return toPromocodeSnapshot(promo, link, linkPlan);
};

/**
 * Snapshot a redeemed customer referral code against the purchased plan.
 * Returns null if the program or the referring customer can't be resolved.
 */
export const buildReferralSnapshot = async (
  referrerId: number,
  planId: number,
  planKind: SnapshotPlanKind = "price"
): Promise<ReferralSnapshot | null> => {
  const [program, referrer, plan] = await Promise.all([
    repo.findReferralProgram(),
    repo.findReferrer(referrerId),
    resolvePlan(planId, planKind),
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
  /**
   * Which plan table `planId` belongs to. Defaults to "price"
   * (ws_package_course_ebook_price) — the course / package / ebook checkouts — so
   * those callers are unaffected. Live-course checkout MUST pass "livePlan" and
   * test-series checkout MUST pass "testSeriesPrice".
   */
  planKind?: SnapshotPlanKind;
}): Promise<OrderCodeSnapshots> => {
  const planKind = input.planKind ?? "price";
  if (input.referrerId) {
    return {
      promocode: null,
      refferalcode: await buildReferralSnapshot(input.referrerId, input.planId, planKind),
    };
  }
  if (input.promocodeId) {
    return {
      promocode: await buildPromocodeSnapshot(input.promocodeId, input.planId, planKind),
      refferalcode: null,
    };
  }
  return { promocode: null, refferalcode: null };
};

/**
 * Promoter attribution for a subscription's `promoter_id` / `promoter_percentage`
 * columns, denormalised out of the ORDER's frozen promocode snapshot.
 *
 * Lives here because this module owns the snapshot shape: the two JSON paths read
 * below (`$.promoterId`, `$.promotedPackageCourseEbook[0].promoterPercentage`) are
 * the same ones `modules/promoter-data` filters the package promoter dashboard on,
 * and they are documented as load-bearing in order-code-snapshot.types.ts. Keeping
 * the reader next to the writer is what stops the two drifting apart.
 *
 * Shared by live-course (2026-08-27) and test-series (2026-08-31) verify.
 *
 * ⚠ A REFERRAL snapshot deliberately yields nothing. In the legacy referral shape the
 * key `promoter` holds the referring CUSTOMER, not a `ws_promoter` — attributing one
 * as the other would book customer referral rewards as promoter commission.
 */
export const extractPromoterAttribution = (row: {
  promocode?: unknown;
}): { promoterId: number | null; promoterPercentage: number | null } => {
  const promo = row.promocode as any;
  if (!promo || typeof promo !== "object") return { promoterId: null, promoterPercentage: null };

  const id = promo.promoterId;
  const pct = Array.isArray(promo.promotedPackageCourseEbook)
    ? promo.promotedPackageCourseEbook[0]?.promoterPercentage
    : null;
  const pctNum = pct != null && pct !== "" ? Number(pct) : null;

  return {
    promoterId: Number.isInteger(id) && id > 0 ? (id as number) : null,
    promoterPercentage: pctNum != null && Number.isFinite(pctNum) ? pctNum : null,
  };
};
