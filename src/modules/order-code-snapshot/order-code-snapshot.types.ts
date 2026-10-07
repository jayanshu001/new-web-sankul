// Order code snapshot: purchase-time promocode and referral JSON types.
/**
 * Purchase-time JSON written into the order `promocode` / `refferalcode` columns.
 *
 * The legacy shape is a live read contract: `modules/promoter-data` attributes
 * promoter commission by JSON-path querying the order column directly:
 *
 *   WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
 *   JSON_EXTRACT(o.promocode,'$.promocode')
 *   JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')
 *
 * Renaming or flattening any of those keys silently zeroes the promoter dashboard.
 * Field order mirrors the legacy payload; decimals are strings ("50", "5") because
 * `CAST(... AS DECIMAL)` in promoter-data reads them back that way.
 */

/**
 * A plan row as embedded in a snapshot. Nullable int FKs render as 0 (legacy).
 *
 * Price plans fill ebookId / courseId / packageId; live-course and test-series plans
 * leave them 0 and carry their parent in `liveCourseId` / `testSeriesId`, which are
 * omitted entirely for price plans (that snapshot must not gain keys).
 *
 * `duration` is DAYS for a price plan but MONTHS for a live-course plan (see
 * LIVE_COURSE_DESIGN §3); the value is preserved verbatim.
 */
export type SnapshotPlan = {
  id: number;
  name: string | null;
  price: number;
  status: boolean;
  ebookId: number;
  courseId: number;
  duration: number;
  isDefault: boolean;
  packageId: number;
  created_at: string | null;
  updated_at: string | null;
  withMaterial: boolean;
  materialPrice: number;
  liveCourseId?: number;
  testSeriesId?: number;
};

/**
 * Which plan table `planId` points at; same values as
 * `ws_promoted_package_course_ebook.plan_kind`. The tables share an id space, so
 * resolving a plan id without this returns an unrelated plan (and its promoter percentage).
 */
export type SnapshotPlanKind = "price" | "livePlan" | "testSeriesPrice";

/** snake_case, as in the legacy shape. */
export type SnapshotPromoter = {
  id: number;
  email: string | null;
  image: string | null;
  phone: string | null;
  status: boolean;
  full_name: string | null;
  is_delete: boolean;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * One promocode→plan link with its plan expanded under `planId`. Only the purchased
 * plan's link is snapshotted: promoter-data reads index [0], so embedding the full
 * link list would make the commission rate depend on row order.
 */
export type SnapshotPlanLink = {
  id: number;
  type: string | null;
  planId: SnapshotPlan | null;
  created_at: string | null;
  updated_at: string | null;
  promocodeId: number | null;
  customerPercentage: string;
  promoterPercentage: string;
};

export type PromocodeSnapshot = {
  id: number;
  type: string;
  title: string | null;
  status: boolean;
  promoter: SnapshotPromoter | null;
  promocode: string | null;
  created_at: string | null;
  promoterId: number | null;
  updated_at: string | null;
  description: string | null;
  promo_start_at: string | null;
  promo_expire_at: string | null;
  promotedPackageCourseEbook: SnapshotPlanLink[];
};

/**
 * Referral program row + purchased plan + the referring customer under `promoter`.
 * Here `promoter` is a CUSTOMER (camelCase fields), not a ws_promoter. A referral
 * snapshot carries no `promoterId`, so promoter-data's commission queries never match it.
 */
export type ReferralSnapshot = {
  id: number;
  name: string;
  image: string;
  title: string;
  video: string;
  planId: SnapshotPlan | null;
  status: boolean;
  promoter: {
    id: number;
    fullName: string | null;
    phoneNumber: string | null;
    referralCode: string | null;
  };
  minimumPrice: number;
  refferalReward: string;
  refferalDiscount: string;
  initialRewardAmount: number;
};

export type OrderCodeSnapshots = {
  promocode: PromocodeSnapshot | null;
  refferalcode: ReferralSnapshot | null;
};
