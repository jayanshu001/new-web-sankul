/**
 * Order · code snapshot types — the purchase-time JSON written into the order
 * `promocode` / `refferalcode` columns.
 *
 * These are NOT free-form DTOs: the legacy V1 shape is a live read contract.
 * `modules/promoter-data` attributes every rupee of promoter commission by
 * JSON-path querying the order column directly:
 *
 *   WHERE JSON_EXTRACT(o.promocode,'$.promoterId') = ?
 *   JSON_EXTRACT(o.promocode,'$.promocode')
 *   JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')
 *
 * so `promoterId`, `promocode` and `promotedPackageCourseEbook[0].promoterPercentage`
 * are load-bearing keys — renaming or flattening any of them silently zeroes the
 * promoter dashboard instead of failing. Keep these shapes byte-compatible with
 * the legacy objects.
 *
 * Field ORDER mirrors the legacy payload so a snapshot diffs cleanly against a
 * pre-migration row. Decimals are strings ("50", "5") because that is how the
 * legacy ORM serialized them and how `CAST(... AS DECIMAL)` in promoter-data
 * expects to read them back.
 */

/**
 * A plan row as embedded in a snapshot. Nullable int FKs render as 0 (legacy).
 *
 * Serves BOTH plan tables. `ws_package_course_ebook_price` (planKind "price") fills
 * ebookId / courseId / packageId; `ws_live_course_plan` (planKind "livePlan") has no
 * such parent, so those three stay 0 — the same "not this entity" sentinel V1 used —
 * and the parent is carried in the extra `liveCourseId` key.
 *
 * `liveCourseId` is OPTIONAL and is OMITTED entirely for price plans: the
 * package/course/ebook snapshot is a byte-compatible legacy contract and must not
 * gain keys. Live-course snapshots are a new column with no legacy rows to match.
 *
 * ⚠ `duration` is DAYS for a price plan but MONTHS for a live-course plan (see
 * LIVE_COURSE_DESIGN §3). The snapshot preserves the source value verbatim; the unit
 * is implied by which kind of plan it is, exactly as on the live rows.
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
};

/**
 * Which plan table a snapshot's `planId` points at — the same discriminator
 * `ws_promoted_package_course_ebook.plan_kind` uses.
 *
 * ⚠ The two tables SHARE an id space and the link row's `pcb_price_id` FK is declared
 * against ws_package_course_ebook_price regardless of kind, so resolving a live-course
 * plan id without this discriminator silently returns an unrelated course/package plan
 * (and, worse, ITS promoter percentage).
 */
export type SnapshotPlanKind = "price" | "livePlan";

/** The promoter who owns the promocode (ws_promoter) — snake_case, as in V1. */
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
 * One promocode→plan link (ws_promoted_package_course_ebook) with its plan
 * expanded under `planId`.
 *
 * ⚠ Only the link for the PURCHASED plan is ever snapshotted, because
 * promoter-data reads `promotedPackageCourseEbook[0].promoterPercentage` at a
 * FIXED index — embedding the promocode's full link list would make the
 * commission rate depend on row order and pay out a different plan's percentage.
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

/** Snapshot of a real promocode (ws_promocode) → the `promocode` column. */
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
 * Snapshot of a customer referral redemption → the `refferalcode` column. This
 * is the referral PROGRAM row (ws_refferal_program) plus the purchased plan and
 * the referring customer under `promoter`.
 *
 * Note `promoter` here is a CUSTOMER (camelCase fields), not a ws_promoter — the
 * legacy shape overloads the key name. A referral snapshot deliberately carries
 * no `promoterId`, so promoter-data's commission queries never match it.
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

/** What a create-order path writes into the two code columns. */
export type OrderCodeSnapshots = {
  promocode: PromocodeSnapshot | null;
  refferalcode: ReferralSnapshot | null;
};
