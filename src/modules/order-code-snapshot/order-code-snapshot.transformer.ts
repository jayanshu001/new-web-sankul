import type {
  PromocodeSnapshot,
  ReferralSnapshot,
  SnapshotPlan,
  SnapshotPlanLink,
  SnapshotPromoter,
} from "./order-code-snapshot.types";

/**
 * Prisma rows → the legacy purchase-time snapshot objects.
 *
 * A snapshot is frozen JSON: it must stay readable years after the promocode,
 * plan or promoter it describes has been edited or deleted, so every value is
 * flattened to a primitive here and nothing is left as a live reference.
 */

/**
 * A Date as it would appear had the row been returned by the API directly.
 * `toISOString()` is exactly what `res.json()` does to a Prisma Date, so a
 * snapshotted timestamp reads identically to a live one. (The IST read
 * middleware has already normalised the Date; JSON columns are not re-shifted,
 * which is what keeps the frozen value stable.)
 */
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * A Decimal as the legacy ORM serialized it: the stored digits as a string
 * ("50", not 50 and not "50.00"). promoter-data casts this back with
 * `CAST(... AS DECIMAL(10,2))`, so the string form is the interoperable one.
 */
const dec = (v: unknown): string => (v == null ? "0" : String(v));

/** Nullable int FK → 0. V1 wrote 0 for "not this entity", never null. */
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
 * A LIVE-COURSE plan (ws_live_course_plan) in the SAME SnapshotPlan shape, so a
 * consumer reading `$.promotedPackageCourseEbook[0].planId.price` does not need to
 * know which plan table the purchase came from.
 *
 * ebookId / courseId / packageId are 0 — the legacy "not this entity" sentinel — and
 * the real parent rides in `liveCourseId`, a key that exists ONLY on this variant.
 * ⚠ `duration` here is MONTHS, not days (LIVE_COURSE_DESIGN §3); the value is copied
 * verbatim, exactly as the live row carries it.
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
 * A TEST-SERIES plan (ws_test_series_price) in the SAME SnapshotPlan shape, for the
 * same reason as the live-course variant: a consumer reading
 * `$.promotedPackageCourseEbook[0].planId.price` must not need to know which of the
 * three plan tables the purchase came from.
 *
 * ebookId / courseId / packageId are 0 — the legacy "not this entity" sentinel — and
 * the real parent rides in `testSeriesId`, a key that exists ONLY on this variant.
 * `withMaterial` / `materialPrice` are false / 0 because ws_test_series_price has no
 * such columns: a test series is digital and never ships a material kit.
 * `duration` is DAYS here (duration_days), as on a price plan.
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
        // ws_test_series_price.price is decimal(10,2) — Prisma hands back a Decimal
        // object, which would serialise into the frozen JSON as {s,e,d} internals.
        // Every other SnapshotPlan carries a plain number, so coerce here.
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
 * `plan` is passed in already resolved rather than read off the link's relation: a
 * live-course link's `pcb_price_id` FK resolves against the WRONG table (see
 * order-code-snapshot.repository.findPlanLink), so only the caller knows which plan
 * table the id belongs to.
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
 * Promocode row (+ promoter) and the ONE link for the purchased plan → the
 * `promocode` column snapshot.
 *
 * `link` is null for a legacy global-discount promocode with no per-plan rows;
 * `promotedPackageCourseEbook` is then an empty array and promoter-data's
 * `[0].promoterPercentage` resolves to NULL → 0 commission, which is the correct
 * answer for a code that carries no promoter percentage.
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

/**
 * Referral program row + purchased plan + referring customer → the
 * `refferalcode` column snapshot.
 */
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
