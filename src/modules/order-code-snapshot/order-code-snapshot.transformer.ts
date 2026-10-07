// Order code snapshot: rows to the frozen legacy snapshot JSON shape.
import type {
  PromocodeSnapshot,
  ReferralSnapshot,
  SnapshotPlan,
  SnapshotPlanLink,
  SnapshotPromoter,
} from "./order-code-snapshot.types";

/**
 * Snapshots are frozen JSON that must stay readable after the source rows are
 * edited or deleted, so every value is flattened to a primitive here.
 */

/**
 * Same as `res.json()` on a Prisma Date, so a snapshotted timestamp reads like a
 * live one. JSON columns are not re-shifted by the IST middleware, which keeps it stable.
 */
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** The stored digits as a string ("50", not 50 or "50.00"); promoter-data casts it back to DECIMAL. */
const dec = (v: unknown): string => (v == null ? "0" : String(v));

/** Nullable int FK → 0; the legacy shape writes 0 for "not this entity", never null. */
const zero = (n: number | null | undefined): number => n ?? 0;

export const toSnapshotPlan = (
  p: {
    id: number;
    name: string | null;
    price: number;
    status: boolean;
    ebookId: number | null;
    courseId: number | null;
    duration: number;
    isDefault: boolean;
    packageId: number | null;
    created_at: Date | null;
    updated_at: Date | null;
    withMaterial: boolean;
    materialPrice: number | null;
  } | null
): SnapshotPlan | null =>
  p
    ? {
        id: p.id,
        name: p.name,
        price: p.price,
        status: p.status,
        ebookId: zero(p.ebookId),
        courseId: zero(p.courseId),
        duration: p.duration,
        isDefault: p.isDefault,
        packageId: zero(p.packageId),
        created_at: iso(p.created_at),
        updated_at: iso(p.updated_at),
        withMaterial: p.withMaterial,
        materialPrice: zero(p.materialPrice),
      }
    : null;

/**
 * ws_live_course_plan in the same SnapshotPlan shape, so readers of
 * `$.promotedPackageCourseEbook[0].planId.price` need not know the source table.
 * Parent rides in `liveCourseId`; `duration` is MONTHS here (LIVE_COURSE_DESIGN §3).
 */
export const toLiveSnapshotPlan = (
  p: {
    id: number;
    name: string | null;
    price: number;
    status: boolean;
    duration: number;
    isDefault: boolean;
    liveCourseId: number;
    createdAt: Date | null;
    updatedAt: Date | null;
    withMaterial: boolean;
    materialPrice: number | null;
  } | null
): SnapshotPlan | null =>
  p
    ? {
        id: p.id,
        name: p.name,
        price: p.price,
        status: p.status,
        ebookId: 0,
        courseId: 0,
        duration: p.duration,
        isDefault: p.isDefault,
        packageId: 0,
        created_at: iso(p.createdAt),
        updated_at: iso(p.updatedAt),
        withMaterial: p.withMaterial,
        materialPrice: zero(p.materialPrice),
        liveCourseId: p.liveCourseId,
      }
    : null;

/**
 * ws_test_series_price in the same SnapshotPlan shape. Parent rides in `testSeriesId`;
 * `withMaterial`/`materialPrice` are false/0 (no such columns, nothing ships);
 * `duration` is DAYS (duration_days).
 */
export const toTestSeriesSnapshotPlan = (
  p: {
    id: number;
    name: string | null;
    price: unknown;
    status: boolean;
    durationDays: number;
    isDefault: boolean;
    testSeriesId: number;
    createdAt: Date | null;
    updatedAt: Date | null;
  } | null
): SnapshotPlan | null =>
  p
    ? {
        id: p.id,
        name: p.name,
        // decimal(10,2): a Prisma Decimal would serialise as {s,e,d} internals in the frozen JSON.
        price: Number(p.price ?? 0),
        status: p.status,
        ebookId: 0,
        courseId: 0,
        duration: p.durationDays,
        isDefault: p.isDefault,
        packageId: 0,
        created_at: iso(p.createdAt),
        updated_at: iso(p.updatedAt),
        withMaterial: false,
        materialPrice: 0,
        testSeriesId: p.testSeriesId,
      }
    : null;

const toSnapshotPromoter = (
  pr: {
    id: number;
    email: string | null;
    image: string | null;
    phone: string | null;
    status: boolean;
    full_name: string | null;
    is_delete: boolean;
    created_at: Date | null;
    updated_at: Date | null;
  } | null
): SnapshotPromoter | null =>
  pr
    ? {
        id: pr.id,
        email: pr.email,
        image: pr.image,
        phone: pr.phone,
        status: pr.status,
        full_name: pr.full_name,
        is_delete: pr.is_delete,
        created_at: iso(pr.created_at),
        updated_at: iso(pr.updated_at),
      }
    : null;

/**
 * `plan` is passed in resolved: a non-price link's `pcb_price_id` FK resolves against
 * the wrong table (see repository.findPlanLink), so only the caller knows the plan table.
 */
const toSnapshotPlanLink = (
  l: {
    id: number;
    type: string | null;
    created_at: Date | null;
    updated_at: Date | null;
    promocodeId: number | null;
    customerPercentage: unknown;
    promoterPercentage: unknown;
  },
  plan: SnapshotPlan | null
): SnapshotPlanLink => ({
  id: l.id,
  type: l.type,
  planId: plan,
  created_at: iso(l.created_at),
  updated_at: iso(l.updated_at),
  promocodeId: l.promocodeId,
  customerPercentage: dec(l.customerPercentage),
  promoterPercentage: dec(l.promoterPercentage),
});

/**
 * `link` is null for a global-discount promocode; `promotedPackageCourseEbook` is then
 * empty and promoter-data's `[0].promoterPercentage` resolves to NULL → 0 commission,
 * which is correct for a code with no promoter percentage.
 */
export const toPromocodeSnapshot = (
  promo: {
    id: number;
    type: string;
    title: string | null;
    status: boolean;
    promocode: string | null;
    created_at: Date | null;
    promoterId: number | null;
    updated_at: Date | null;
    description: string | null;
    promo_start_at: Date | null;
    promo_expire_at: Date | null;
    promoter?: Parameters<typeof toSnapshotPromoter>[0];
  },
  link: Parameters<typeof toSnapshotPlanLink>[0] | null,
  linkPlan: SnapshotPlan | null
): PromocodeSnapshot => ({
  id: promo.id,
  type: promo.type,
  title: promo.title,
  status: promo.status,
  promoter: toSnapshotPromoter(promo.promoter ?? null),
  promocode: promo.promocode,
  created_at: iso(promo.created_at),
  promoterId: promo.promoterId,
  updated_at: iso(promo.updated_at),
  description: promo.description,
  promo_start_at: iso(promo.promo_start_at),
  promo_expire_at: iso(promo.promo_expire_at),
  promotedPackageCourseEbook: link ? [toSnapshotPlanLink(link, linkPlan)] : [],
});

export const toReferralSnapshot = (
  program: {
    id: number;
    name: string;
    image: string;
    title: string;
    video: string;
    status: boolean | null;
    minimumPrice: number;
    refferalReward: unknown;
    refferalDiscount: unknown;
    initialRewardAmount: number;
  },
  referrer: {
    id: number;
    fullName: string | null;
    phoneNumber: string | null;
    referralCode: string | null;
  },
  plan: SnapshotPlan | null
): ReferralSnapshot => ({
  id: program.id,
  name: program.name,
  image: program.image,
  title: program.title,
  video: program.video,
  planId: plan,
  status: program.status ?? false,
  promoter: {
    id: referrer.id,
    fullName: referrer.fullName,
    phoneNumber: referrer.phoneNumber,
    referralCode: referrer.referralCode,
  },
  minimumPrice: program.minimumPrice,
  refferalReward: dec(program.refferalReward),
  refferalDiscount: dec(program.refferalDiscount),
  initialRewardAmount: program.initialRewardAmount,
});
