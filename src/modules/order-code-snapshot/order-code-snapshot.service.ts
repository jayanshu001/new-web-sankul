/**
 * Order code snapshot: builds the purchase-time object every checkout path writes into an order's
 * `promocode` / `refferalcode` columns.
 *
 * An object, not the code string: `modules/promoter-data` computes the promoter
 * dashboard by JSON-path querying the order row; a bare string matches none of
 * those paths and pays out nothing. A snapshot, not a join: percentages and plan
 * prices are editable, and commission must use the terms in force at purchase.
 *
 * A snapshot never fails a payment: builders return null when source rows are
 * missing and the caller stores null.
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

/** Every builder resolves its plan here, so a new plan kind cannot be half-wired. */
const resolvePlan = async (
  planId: number,
  planKind: SnapshotPlanKind
): Promise<SnapshotPlan | null> => {
  if (planKind === "livePlan") return toLiveSnapshotPlan(await repo.findLivePlan(planId));
  if (planKind === "testSeriesPrice") return toTestSeriesSnapshotPlan(await repo.findTestSeriesPlan(planId));
  return toSnapshotPlan(await repo.findPlan(planId));
};

/**
 * Returns null if the promocode row has since been deleted. `planKind` selects both
 * the link row and the plan table (see repository.findPlanLink).
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
  // Only a "price" link carries its plan on the loaded relation; other kinds' FK points
  // at the wrong table. No link → global-discount promocode → no plan to embed.
  const linkPlan = !link
    ? null
    : planKind !== "price"
      ? await resolvePlan(planId, planKind)
      : toSnapshotPlan((link as { packageCourseEbookPrice?: any }).packageCourseEbookPrice ?? null);
  return toPromocodeSnapshot(promo, link, linkPlan);
};

/** Returns null if the program or the referring customer can't be resolved. */
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
 * The single call a create-order path makes. `referrerId` and `promocodeId` are
 * mutually exclusive by construction (`resolvePromoForPlanSql`); referral is checked
 * first anyway, so at most one snapshot is produced. Both null costs no queries.
 */
export const buildOrderCodeSnapshots = async (input: {
  promocodeId: number | null;
  referrerId: number | null;
  planId: number;
  /** Defaults to "price"; live-course checkout must pass "livePlan", test-series "testSeriesPrice". */
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
 * Promoter attribution for a subscription's `promoter_id` / `promoter_percentage`,
 * read from the order's promocode snapshot. Kept next to the writer because these
 * are the same JSON paths promoter-data filters on.
 *
 * A referral snapshot yields nothing: its `promoter` key is the referring customer,
 * and attributing it would book referral rewards as promoter commission.
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
