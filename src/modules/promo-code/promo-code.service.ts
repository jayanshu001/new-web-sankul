/**
 * PromoCode (appliesTo) — SQL. Backed by ws_promocode / Prisma model `Promocode`
 * (appliesToType + appliesToIds JSON int[], discountType/discountValue). As of
 * 2026-07-08 this is the SAME table the promoter promocode flow uses — the former
 * standalone ws_promo_code / `PromoCodeRule` model was merged in and dropped.
 *
 * Scope: the appliesTo-driven admin CRUD (list/get/create/update/delete/toggle/
 * bulk) + the client apply-promo coverage/discount check + the per-plan
 * promoter/customer % "plan links" (PromotedPackageCourseEbook /
 * ws_promoted_package_course_ebook), keyed by this table's id.
 *
 * All ids are SQL ints at runtime; DTOs restringify (`_id = String(id)`) to the
 * Mongo doc shape so the admin/client response contracts are unchanged. Note the
 * Mongo doc casing: `promo_start_at` / `promo_expire_at`.
 */
import { prisma } from "../../config/prisma";
import { buildPagination } from "../../utils/listQuery";

// 2026-07-08: the discount-rule promocode was merged into ws_promocode (Prisma
// model `Promocode`); the former ws_promo_code / `PromoCodeRule` model is gone.
// Row timestamp/window fields are snake-cased on `Promocode`
// (promo_start_at / promo_expire_at / created_at / updated_at); the
// discount/appliesTo columns keep their camelCase Prisma names via @map.
export const PROMO_CODE_MODULE = "promo-code";
export const isPromoCodeMysql = (): boolean => true;

export const parsePcId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const APPLIES_TO_TYPES = ["package", "course", "liveCourse", "ebook", "testSeries"] as const;
export type AppliesToType = (typeof APPLIES_TO_TYPES)[number];

// A normalized appliesTo group: one entity type + its int ids.
export type AppliesGroup = { type: AppliesToType; ids: number[] };

/**
 * Read a promo row's appliesTo as normalized groups, handling BOTH shapes:
 *  - legacy single-type: appliesToType="package", appliesToIds=[1,2,3]
 *  - multi-type:         appliesToType="mixed",   appliesToIds=[{type,ids},…]
 * Single source of truth used by promoCovers / detail / validPlans so a
 * mixed-type promocode behaves identically to a single-type one everywhere.
 */
export const appliesToGroups = (r: { appliesToType: string | null; appliesToIds: any }): AppliesGroup[] => {
  if (r.appliesToType === "mixed") {
    const arr = Array.isArray(r.appliesToIds) ? r.appliesToIds : [];
    const out: AppliesGroup[] = [];
    for (const g of arr) {
      const t = (g as any)?.type;
      if (!APPLIES_TO_TYPES.includes(t)) continue;
      const ids = parseIdArray((g as any)?.ids);
      if (ids.length) out.push({ type: t, ids });
    }
    return out;
  }
  if (r.appliesToType && (APPLIES_TO_TYPES as readonly string[]).includes(r.appliesToType)) {
    const ids = parseIdArray(r.appliesToIds);
    return ids.length ? [{ type: r.appliesToType as AppliesToType, ids }] : [];
  }
  return [];
};

/**
 * Convert groups → the stored columns. A SINGLE group is stored in the legacy
 * shape (appliesToType + flat int[]) so existing readers/rows stay compatible;
 * MULTIPLE groups use appliesToType="mixed" + appliesToIds=[{type,ids},…].
 */
const toAppliesToStorage = (groups: AppliesGroup[]): { appliesToType: string; appliesToIds: any } => {
  if (groups.length === 1) {
    return { appliesToType: groups[0].type, appliesToIds: parseIdArray(groups[0].ids) };
  }
  return { appliesToType: "mixed", appliesToIds: groups.map((g) => ({ type: g.type, ids: parseIdArray(g.ids) })) };
};

/** Validate every group's ids exist; throws {__badRequest} on mismatch. */
export const assertAppliesToGroupsExistSql = async (groups: AppliesGroup[]): Promise<void> => {
  if (!groups.length) throw badRequest("Select at least one item");
  for (const g of groups) await assertAppliesToExistsSql(g.type, g.ids);
};

/** Raw appliesTo groups for a promo id (effective value when updating plans). */
export const getAppliesToGroupsById = async (id: number): Promise<AppliesGroup[]> => {
  const row = await prisma.promocode.findUnique({
    where: { id },
    select: { appliesToType: true, appliesToIds: true },
  });
  return row ? appliesToGroups(row) : [];
};

/** Coerce a stored JSON column (int[] | string[] | null) to a clean int[]. */
export const parseIdArray = (json: any): number[] => {
  const a = Array.isArray(json) ? json : [];
  const out: number[] = [];
  for (const v of a) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
};

const badRequest = (message: string) =>
  Object.assign(new Error(message), { __badRequest: true });

// ── appliesTo resolution across the 5 SQL entity tables ──────────────────────
// Preserve the Mongo populate shape `{ _id, name, image }`. testSeries maps
// title→name + thumbnail→image; ebook maps thumbnail→image.

type PopulatedRef = { _id: string; name: string | null; image: string | null };

const resolveAppliesToRefs = async (
  type: AppliesToType,
  ids: number[]
): Promise<PopulatedRef[]> => {
  if (!ids.length) return [];
  let rows: { id: number; name: string | null; image: string | null }[] = [];
  switch (type) {
    case "package": {
      const r = await prisma.package.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, image: true },
      });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.image ?? null }));
      break;
    }
    case "course": {
      const r = await prisma.course.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, image: true },
      });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.image ?? null }));
      break;
    }
    case "liveCourse": {
      const r = await prisma.liveCourse.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, image: true },
      });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.image ?? null }));
      break;
    }
    case "ebook": {
      const r = await prisma.eBook.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, thumbnail: true },
      });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.thumbnail ?? null }));
      break;
    }
    case "testSeries": {
      const r = await prisma.testSeries.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, thumbnail: true },
      });
      rows = r.map((x) => ({ id: x.id, name: x.title ?? null, image: x.thumbnail ?? null }));
      break;
    }
  }
  // Preserve the requested id order (mirror Mongo populate over an id array).
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ _id: String(r.id), name: r.name, image: r.image }));
};

/** Count-match the ids against the right entity table; throw {__badRequest} on mismatch. */
export const assertAppliesToExistsSql = async (
  type: AppliesToType,
  ids: number[]
): Promise<void> => {
  if (!ids.length) throw badRequest("Select at least one item");
  const where = { id: { in: ids } };
  let found = 0;
  switch (type) {
    case "package":
      found = await prisma.package.count({ where });
      break;
    case "course":
      found = await prisma.course.count({ where });
      break;
    case "liveCourse":
      found = await prisma.liveCourse.count({ where });
      break;
    case "ebook":
      found = await prisma.eBook.count({ where });
      break;
    case "testSeries":
      found = await prisma.testSeries.count({ where });
      break;
  }
  if (found !== ids.length)
    throw badRequest(`One or more ${type} ids do not exist`);
};

// ── DTOs (Mongo doc shape) ───────────────────────────────────────────────────
const baseDto = (r: any) => ({
  _id: String(r.id),
  type: r.type,
  promocode: r.promocode,
  title: r.title ?? "",
  description: r.description ?? "",
  promo_start_at: r.promo_start_at ?? null,
  promo_expire_at: r.promo_expire_at ?? null,
  status: r.status,
  discountType: r.discountType,
  discountValue: Number(r.discountValue ?? 0),
  promoterId: r.promoterId != null ? String(r.promoterId) : null,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

/** List DTO — appliesTo summarised to `{ type, count }` (type="mixed" for multi). */
const listDto = (r: any) => {
  const groups = appliesToGroups(r);
  const count = groups.reduce((n, g) => n + g.ids.length, 0);
  const type = groups.length === 0 ? null : groups.length === 1 ? groups[0].type : "mixed";
  return {
    ...baseDto(r),
    appliesTo: type ? { type, count } : null,
  };
};

/**
 * Detail DTO — appliesTo as an ARRAY of populated groups:
 *   [{ type, ids: [{_id,name,image}] }, …]
 * (one element for single-type, N for multi-type). The FE rebuilds the per-type
 * selection from this; the per-plan grid is rebuilt from loadPlanLinksSql.
 */
const detailDto = async (r: any) => {
  const dto: any = baseDto(r);
  const groups = appliesToGroups(r);
  if (!groups.length) {
    dto.appliesTo = null;
    return dto;
  }
  dto.appliesTo = await Promise.all(
    groups.map(async (g) => ({ type: g.type, ids: await resolveAppliesToRefs(g.type, g.ids) }))
  );
  return dto;
};

// ── Admin CRUD ───────────────────────────────────────────────────────────────
export const listPromocodes = async (opts: {
  search: string | null;
  status: boolean | null;
  type: "public" | "private" | null;
  fromDate: Date | null;
  toDate: Date | null;
  skip: number;
  limitNum: number;
  pageNum: number;
}) => {
  const where: any = {};
  if (opts.search) where.promocode = { contains: opts.search.toUpperCase() };
  if (opts.status !== null) where.status = opts.status;
  if (opts.type) where.type = opts.type;
  if (opts.fromDate || opts.toDate) {
    where.promo_start_at = {};
    if (opts.fromDate) where.promo_start_at.gte = opts.fromDate;
    if (opts.toDate) where.promo_start_at.lte = opts.toDate;
  }

  const [rows, total] = await Promise.all([
    prisma.promocode.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: opts.skip,
      take: opts.limitNum,
    }),
    prisma.promocode.count({ where }),
  ]);

  return {
    data: rows.map(listDto),
    pagination: {
      total,
      page: opts.pageNum,
      limit: opts.limitNum,
      totalPages: Math.ceil(total / opts.limitNum),
    },
  };
};

/**
 * Promo codes whose appliesTo targets a given package — the SQL equivalent of
 * the Mongo `PromoCode.find({ "appliesTo.type": "package", "appliesTo.ids": id })`.
 * appliesToIds is a JSON int[]; filter in-memory after narrowing to package-type
 * rows so the match is exact regardless of JSON storage quirks. Sorted newest
 * first to mirror the Mongo `.sort({ createdAt: -1 })`.
 */
export const listPromocodesForPackage = async (packageId: number) => {
  // Include both single-type "package" rows and multi-type "mixed" rows; the
  // package match is resolved via appliesToGroups so mixed codes are not missed.
  const rows = await prisma.promocode.findMany({
    where: { appliesToType: { in: ["package", "mixed"] } },
    orderBy: { created_at: "desc" },
  });
  return rows
    .filter((r) => appliesToGroups(r).some((g) => g.type === "package" && g.ids.includes(packageId)))
    .map(listDto);
};

/**
 * Paginated promocodes scoped to a single entity (package/course/ebook/liveCourse/
 * testSeries). The scope match lives in `appliesToIds` JSON (int[] or mixed
 * [{type,ids}]), which SQL cannot LIMIT/OFFSET on directly, so we narrow to
 * `[type,"mixed"]` rows (+ optional code search) in SQL, resolve the exact match
 * in-memory via appliesToGroups, then slice the page. `total` reflects the matched
 * set (not the pre-filter fetch), so pagination stays correct. Used by the admin
 * package/course/ebook promocode tabs. Newest-first, mirroring the other lists.
 */
export const listPromocodesForScope = async (
  type: AppliesToType,
  id: number,
  q: { search?: string; page: number; limit: number; skip: number }
) => {
  const rows = await prisma.promocode.findMany({
    where: {
      appliesToType: { in: [type, "mixed"] },
      ...(q.search ? { promocode: { contains: q.search.toUpperCase() } } : {}),
    },
    orderBy: { created_at: "desc" },
  });
  const matched = rows.filter((r) => appliesToGroups(r).some((g) => g.type === type && g.ids.includes(id)));
  const data = matched.slice(q.skip, q.skip + q.limit).map(listDto);
  return { data, pagination: buildPagination(matched.length, q.page, q.limit) };
};

/** getById — populates appliesTo; the OUT-OF-SCOPE plan links return []. */
export const getPromocodeById = async (id: number) => {
  const row = await prisma.promocode.findUnique({ where: { id } });
  if (!row) return { notFound: true as const };
  const promocode = await detailDto(row);
  return { data: { promocode, plans: [] as any[] } };
};

export const createPromocode = async (input: {
  promocode: string;
  title: string;
  description: string;
  promo_start_at: Date;
  promo_expire_at: Date;
  type: "public" | "private";
  status: boolean;
  discountType: "flat" | "percentage";
  discountValue: number;
  promoterId: number | null;
  appliesTo: AppliesGroup[];
}) => {
  const code = input.promocode.toUpperCase();
  const dup = await prisma.promocode.findFirst({ where: { promocode: code } });
  if (dup) return { conflict: true as const };

  await assertAppliesToGroupsExistSql(input.appliesTo);
  const storage = toAppliesToStorage(input.appliesTo);

  const now = new Date();
  const row = await prisma.promocode.create({
    data: {
      type: input.type,
      promocode: code,
      title: input.title,
      description: input.description,
      promo_start_at: input.promo_start_at,
      promo_expire_at: input.promo_expire_at,
      status: input.status,
      discountType: input.discountType,
      discountValue: input.discountValue,
      promoterId: input.promoterId,
      appliesToType: storage.appliesToType,
      appliesToIds: storage.appliesToIds,
      created_at: now,
      updated_at: now,
    },
  });
  return { data: baseDto(row) };
};

export const updatePromocode = async (
  id: number,
  input: Partial<{
    promocode: string;
    title: string;
    description: string;
    promo_start_at: Date;
    promo_expire_at: Date;
    type: "public" | "private";
    status: boolean;
    discountType: "flat" | "percentage";
    discountValue: number;
    promoterId: number | null;
    appliesTo: AppliesGroup[];
  }>
) => {
  const existing = await prisma.promocode.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { notFound: true as const };

  const data: any = { updated_at: new Date() };
  if (input.promocode !== undefined) {
    const code = input.promocode.toUpperCase();
    const dup = await prisma.promocode.findFirst({
      where: { promocode: code, id: { not: id } },
    });
    if (dup) return { conflict: true as const };
    data.promocode = code;
  }
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.promo_start_at !== undefined) data.promo_start_at = input.promo_start_at;
  if (input.promo_expire_at !== undefined) data.promo_expire_at = input.promo_expire_at;
  if (input.type !== undefined) data.type = input.type;
  if (input.status !== undefined) data.status = input.status;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined) data.discountValue = input.discountValue;
  if (input.promoterId !== undefined) data.promoterId = input.promoterId;
  if (input.appliesTo !== undefined) {
    await assertAppliesToGroupsExistSql(input.appliesTo);
    const storage = toAppliesToStorage(input.appliesTo);
    data.appliesToType = storage.appliesToType;
    data.appliesToIds = storage.appliesToIds;
  }

  const row = await prisma.promocode.update({ where: { id }, data });
  return { data: baseDto(row) };
};

export const deletePromocode = async (id: number) => {
  const existing = await prisma.promocode.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { notFound: true as const };
  await prisma.promocode.delete({ where: { id } });
  return { ok: true as const };
};

export const toggleStatus = async (id: number, nextStatus: boolean | null) => {
  const existing = await prisma.promocode.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return { notFound: true as const };
  const status = nextStatus === null ? !existing.status : nextStatus;
  const row = await prisma.promocode.update({
    where: { id },
    data: { status, updated_at: new Date() },
  });
  return { data: { status: row.status } };
};

export const bulkStatus = async (ids: number[], status: boolean) => {
  const result = await prisma.promocode.updateMany({
    where: { id: { in: ids } },
    data: { status, updated_at: new Date() },
  });
  return { matched: result.count, modified: result.count };
};

export const bulkDelete = async (ids: number[]) => {
  await prisma.promocode.deleteMany({ where: { id: { in: ids } } });
  return { ok: true as const };
};

// ── Client public list ───────────────────────────────────────────────────────
/**
 * Client-facing public promocode list — mirrors the Mongo client list:
 * `status:true, type:"public"` within the active window, sorted by
 * promo_expire_at asc, projected to the same fields the Mongo `.select(...)`
 * exposes. Returns `{ data, pagination }` byte-identical to the Mongo path.
 */
const toPublicPromoDto = (r: any) => ({
  _id: String(r.id),
  promocode: r.promocode,
  title: r.title ?? "",
  description: r.description ?? "",
  discountType: r.discountType,
  discountValue: Number(r.discountValue ?? 0),
  promo_start_at: r.promo_start_at ?? null,
  promo_expire_at: r.promo_expire_at ?? null,
});

export const listPublicPromocodes = async (opts: {
  skip: number;
  limitNum: number;
  pageNum: number;
  /** Optional entity filter: only codes whose appliesTo covers (type, id). */
  appliesTo?: { type: AppliesToType; id: number };
}) => {
  const now = new Date();
  const baseWhere: any = {
    status: true,
    type: "public",
    promo_start_at: { lt: now },
    promo_expire_at: { gt: now },
  };

  // Entity-scoped: narrow to the module type at the DB, then keep only codes
  // whose JSON appliesToIds array contains this id. Public codes per type are a
  // small set, so the in-memory id filter keeps pagination totals exact without
  // a JSON query. Mirrors `listPromocodesForPackage`.
  if (opts.appliesTo) {
    // Include single-type rows of this type AND multi-type ("mixed") rows; the
    // coverage match is resolved via appliesToGroups so mixed codes that cover
    // this entity are not missed (they were before — type "mixed" + the
    // [{type,ids}] JSON failed both the type filter and parseIdArray).
    const rows = await prisma.promocode.findMany({
      where: { ...baseWhere, appliesToType: { in: [opts.appliesTo.type, "mixed"] } },
      orderBy: { promo_expire_at: "asc" },
    });
    const covered = rows.filter((r) =>
      appliesToGroups(r).some((g) => g.type === opts.appliesTo!.type && g.ids.includes(opts.appliesTo!.id))
    );
    const total = covered.length;
    const pageRows = covered.slice(opts.skip, opts.skip + opts.limitNum);
    return {
      data: pageRows.map(toPublicPromoDto),
      pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) },
    };
  }

  const [rows, total] = await Promise.all([
    prisma.promocode.findMany({
      where: baseWhere,
      orderBy: { promo_expire_at: "asc" },
      skip: opts.skip,
      take: opts.limitNum,
    }),
    prisma.promocode.count({ where: baseWhere }),
  ]);

  return {
    data: rows.map(toPublicPromoDto),
    pagination: {
      total,
      page: opts.pageNum,
      limit: opts.limitNum,
      totalPages: Math.ceil(total / opts.limitNum),
    },
  };
};

/**
 * Normalize an FE `type` param (kebab aliases allowed) to the canonical
 * appliesTo type, or null if unrecognized. Shared by the client listing.
 */
export const normalizeAppliesToType = (raw: string): AppliesToType | null => {
  const k = raw.trim().toLowerCase();
  const map: Record<string, AppliesToType> = {
    package: "package",
    course: "course",
    ebook: "ebook",
    "e-book": "ebook",
    testseries: "testSeries",
    "test-series": "testSeries",
    livecourse: "liveCourse",
    "live-course": "liveCourse",
  };
  return map[k] ?? null;
};

// ── Client apply ─────────────────────────────────────────────────────────────
/** Find an active (status + window) promocode by (upper-cased) code. */
export const findActiveByCode = async (code: string) => {
  const now = new Date();
  return prisma.promocode.findFirst({
    where: {
      promocode: code.toUpperCase(),
      status: true,
      promo_start_at: { lt: now },
      promo_expire_at: { gt: now },
    },
  });
};

// Referral codes (ws_customer.referral_code) double as a global discount code so
// the app can use ONE apply/checkout flow for both. When a code isn't a
// promocode, callers fall back to this: it resolves the code to its owning
// customer + the active "student" referral program's refferalDiscount (%).
// Referral codes cover ALL five commerce entities: package/course/ebook (served by
// /promocodes/apply) plus testSeries + liveCourse (each served by its own plan-based
// preview endpoint). Referral discounts are always a global percentage.
export const REFERRAL_COVERED_TYPES: readonly AppliesToType[] = ["package", "course", "ebook", "testSeries", "liveCourse"];
export const referralCovers = (type: AppliesToType): boolean =>
  REFERRAL_COVERED_TYPES.includes(type);

export const resolveReferralCode = async (
  rawCode: string
): Promise<{ referrerId: number; discountType: "percentage"; discountValue: number } | null> => {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) return null;
  const owner = await prisma.customer.findFirst({
    where: { referralCode: code, isAccountDeleted: false, status: true },
    select: { id: true },
  });
  if (!owner) return null;
  const program = await prisma.refferalProgram.findFirst({
    where: { name: "student", status: true },
    select: { refferalDiscount: true },
  });
  const discountValue = program ? Number(program.refferalDiscount) || 0 : 0;
  if (!(discountValue > 0)) return null;
  return { referrerId: owner.id, discountType: "percentage", discountValue };
};

/** SQL coverage check: appliesToType===type && appliesToIds.includes(id). */
export const promoCovers = (
  promo: { appliesToType: string | null; appliesToIds: any },
  context: { type: AppliesToType; id: number }
): boolean =>
  // Covered if ANY appliesTo group matches the context type + id. Handles both
  // single-type and multi-type ("mixed") promocodes via appliesToGroups.
  appliesToGroups(promo).some((g) => g.type === context.type && g.ids.includes(context.id));

/**
 * Detect what a SQL int id ACTUALLY is (package / course / ebook), mirroring the
 * Mongo `detectEntity`. liveCourse/testSeries use their own plan-based endpoints
 * and are out of scope here. Returns the detected type + id, or null.
 */
export const detectEntitySql = async (
  id: number
): Promise<{ type: "package" | "course" | "ebook"; id: number } | null> => {
  const [pkg, course, ebook] = await Promise.all([
    prisma.package.findFirst({ where: { id }, select: { id: true } }),
    prisma.course.findFirst({ where: { id }, select: { id: true } }),
    prisma.eBook.findFirst({ where: { id }, select: { id: true } }),
  ]);
  if (pkg) return { type: "package", id };
  if (course) return { type: "course", id };
  if (ebook) return { type: "ebook", id };
  return null;
};

/**
 * Load the active pricing plans for a detected entity. Unlike Mongo (where ebook
 * plans live in a separate EbookPrice collection), SQL stores all three types'
 * plans in `ws_package_course_ebook_price` keyed by packageId/courseId/ebookId.
 */
export const loadPricingPlansSql = async (entity: {
  type: "package" | "course" | "ebook";
  id: number;
}) => {
  const where: any = { status: true };
  if (entity.type === "package") where.packageId = entity.id;
  else if (entity.type === "course") where.courseId = entity.id;
  else where.ebookId = entity.id;
  return prisma.packageCourseEbookPrice.findMany({ where, orderBy: { duration: "asc" } });
};

// ── Plan links (ws_promoted_package_course_ebook) — C5 SQL port ───────────────
// Mirrors the Mongo loadPlansForEntities / syncPlanLinks / loadPlanLinks /
// getPromocodePlans in src/admin/promocode/promocode.controller.ts.
//
// `planKind` distinguishes which plan table a `planId` points at:
//   - "price"    → ws_package_course_ebook_price (package/course/ebook plans)
//   - "livePlan" → ws_live_course_plan (live-course plans)
// testSeries plans also live in ws_test_series_price (their own table); the
// promoted link column has no FK to it, so those ids are stored under a distinct
// "testSeriesPrice" kind so loadPlanLinksSql can resolve them back. NOTE the
// promoted table's `promocodeId` FK is declared against the legacy Promocode
// model, but at the DB level it's a plain `promocode_id` int — we store the
// migrated PromoCodeRule id there directly via the scalar field.

export type PlanKind = "price" | "livePlan" | "testSeriesPrice";

const PLAN_KIND_BY_TYPE: Record<AppliesToType, PlanKind> = {
  package: "price",
  course: "price",
  liveCourse: "livePlan",
  ebook: "price",
  testSeries: "testSeriesPrice",
};

export interface ResolvedPlanSql {
  id: number;
  entityId: number;
  duration: number;
  price: number;
  withMaterial: boolean;
  kind: PlanKind;
}

export interface PlanLinkInputSql {
  planId: string | number;
  promoterPercentage: number;
  customerPercentage: number;
}

/** Load all active plans for the given entities of `type`, normalised. */
export const loadPlansForEntitiesSql = async (
  type: AppliesToType,
  entityIds: number[]
): Promise<ResolvedPlanSql[]> => {
  if (!entityIds.length) return [];

  if (type === "liveCourse") {
    const rows = await prisma.liveCoursePlan.findMany({
      where: { liveCourseId: { in: entityIds }, status: true },
      select: { id: true, liveCourseId: true, duration: true, price: true },
    });
    return rows.map((r) => ({
      id: r.id,
      entityId: r.liveCourseId,
      duration: r.duration,
      price: r.price,
      withMaterial: false,
      kind: "livePlan" as const,
    }));
  }

  if (type === "testSeries") {
    const rows = await prisma.testSeriesPrice.findMany({
      where: { testSeriesId: { in: entityIds }, status: true },
      select: { id: true, testSeriesId: true, durationDays: true, price: true },
    });
    return rows.map((r) => ({
      id: r.id,
      entityId: r.testSeriesId,
      duration: r.durationDays,
      price: Number(r.price),
      withMaterial: false,
      kind: "testSeriesPrice" as const,
    }));
  }

  // package / course / ebook → ws_package_course_ebook_price keyed by the
  // matching entity column.
  const where: any = { status: true };
  if (type === "package") where.packageId = { in: entityIds };
  else if (type === "course") where.courseId = { in: entityIds };
  else where.ebookId = { in: entityIds };

  const rows = await prisma.packageCourseEbookPrice.findMany({
    where,
    select: {
      id: true,
      packageId: true,
      courseId: true,
      ebookId: true,
      duration: true,
      price: true,
      withMaterial: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    entityId:
      type === "package"
        ? (r.packageId as number)
        : type === "course"
        ? (r.courseId as number)
        : (r.ebookId as number),
    duration: r.duration,
    price: r.price,
    withMaterial: !!r.withMaterial,
    kind: "price" as const,
  }));
};

/**
 * Replace-semantics plan-link sync: upsert each kept link (carrying its planKind
 * + percentages) and delete the links no longer present. Only links whose planId
 * resolves to one of `validPlans` are kept (orphans silently dropped — mirrors
 * Mongo). `validPlans` maps numeric planId → ResolvedPlanSql.
 */
export const syncPlanLinksSql = async (
  promocodeId: number,
  plans: PlanLinkInputSql[],
  validPlans: Map<number, ResolvedPlanSql>
): Promise<void> => {
  const kept = plans
    .map((p) => ({ ...p, pid: Number(p.planId) }))
    .filter((p) => Number.isInteger(p.pid) && validPlans.has(p.pid));

  for (const p of kept) {
    const kind = validPlans.get(p.pid)!.kind;
    const existing = await prisma.promotedPackageCourseEbook.findFirst({
      where: { promocodeId, planId: p.pid },
      select: { id: true },
    });
    if (existing) {
      await prisma.promotedPackageCourseEbook.update({
        where: { id: existing.id },
        data: {
          planKind: kind,
          promoterPercentage: p.promoterPercentage,
          customerPercentage: p.customerPercentage,
          updated_at: new Date(),
        },
      });
    } else {
      await prisma.promotedPackageCourseEbook.create({
        data: {
          promocodeId,
          planId: p.pid,
          planKind: kind,
          promoterPercentage: p.promoterPercentage,
          customerPercentage: p.customerPercentage,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }
  }

  const keepIds = kept.map((p) => p.pid);
  await prisma.promotedPackageCourseEbook.deleteMany({
    where: {
      promocodeId,
      ...(keepIds.length ? { planId: { notIn: keepIds } } : {}),
    },
  });
};

/**
 * Drop every link whose planId isn't in `validPlanIds` (used when appliesTo
 * changes but `plans` is omitted, so stale percentages don't linger).
 */
export const prunePlanLinksSql = async (
  promocodeId: number,
  validPlanIds: number[]
): Promise<void> => {
  await prisma.promotedPackageCourseEbook.deleteMany({
    where: {
      promocodeId,
      ...(validPlanIds.length ? { planId: { notIn: validPlanIds } } : {}),
    },
  });
};

/** Delete all plan links for a promocode (delete/bulk-delete cleanup). */
export const deletePlanLinksSql = async (promocodeIds: number[]): Promise<void> => {
  if (!promocodeIds.length) return;
  await prisma.promotedPackageCourseEbook.deleteMany({
    where: { promocodeId: { in: promocodeIds } },
  });
};

/**
 * Edit-screen `plans[]`: each link with its `planId` populated to the Mongo
 * shape (duration/price/withMaterial + parent entity { _id, name }), matching
 * the FE `toPlanLink` parser. Resolves price / live / testSeries plans + their
 * parent entity names in batched passes.
 */
export const loadPlanLinksSql = async (promocodeId: number): Promise<any[]> => {
  const links = await prisma.promotedPackageCourseEbook.findMany({
    where: { promocodeId },
    orderBy: { id: "asc" },
  });
  if (!links.length) return [];

  const priceIds = links
    .filter((l) => l.planKind !== "livePlan" && l.planKind !== "testSeriesPrice")
    .map((l) => l.planId)
    .filter((v): v is number => v != null);
  const liveIds = links
    .filter((l) => l.planKind === "livePlan")
    .map((l) => l.planId)
    .filter((v): v is number => v != null);
  const tsIds = links
    .filter((l) => l.planKind === "testSeriesPrice")
    .map((l) => l.planId)
    .filter((v): v is number => v != null);

  const [priceRows, liveRows, tsRows] = await Promise.all([
    priceIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { id: { in: priceIds } },
          select: {
            id: true,
            duration: true,
            price: true,
            withMaterial: true,
            packageId: true,
            courseId: true,
            ebookId: true,
          },
        })
      : Promise.resolve([]),
    liveIds.length
      ? prisma.liveCoursePlan.findMany({
          where: { id: { in: liveIds } },
          select: { id: true, duration: true, price: true, liveCourseId: true },
        })
      : Promise.resolve([]),
    tsIds.length
      ? prisma.testSeriesPrice.findMany({
          where: { id: { in: tsIds } },
          select: { id: true, durationDays: true, price: true, testSeriesId: true },
        })
      : Promise.resolve([]),
  ]);

  const pkgIds = priceRows.filter((r) => r.packageId).map((r) => r.packageId as number);
  const courseIds = priceRows.filter((r) => r.courseId).map((r) => r.courseId as number);
  const ebookIds = priceRows.filter((r) => r.ebookId).map((r) => r.ebookId as number);
  const liveCourseIds = liveRows.map((r) => r.liveCourseId);
  const testSeriesIds = tsRows.map((r) => r.testSeriesId);

  const [pkgs, courses, ebooks, liveCourses, testSeriesList] = await Promise.all([
    pkgIds.length
      ? prisma.package.findMany({ where: { id: { in: pkgIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    courseIds.length
      ? prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    ebookIds.length
      ? prisma.eBook.findMany({ where: { id: { in: ebookIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    liveCourseIds.length
      ? prisma.liveCourse.findMany({
          where: { id: { in: liveCourseIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    testSeriesIds.length
      ? prisma.testSeries.findMany({
          where: { id: { in: testSeriesIds } },
          select: { id: true, title: true },
        })
      : Promise.resolve([]),
  ]);

  const nameOf = (list: { id: number; name: string | null }[]) =>
    new Map(list.map((d) => [d.id, { _id: String(d.id), name: d.name }]));
  const pkgMap = nameOf(pkgs);
  const courseMap = nameOf(courses);
  const ebookMap = nameOf(ebooks);
  const liveMap = nameOf(liveCourses);
  const tsMap = new Map(
    testSeriesList.map((d) => [d.id, { _id: String(d.id), name: d.title }])
  );

  const priceMap = new Map(priceRows.map((r) => [r.id, r]));
  const liveRowMap = new Map(liveRows.map((r) => [r.id, r]));
  const tsRowMap = new Map(tsRows.map((r) => [r.id, r]));

  return links.map((l) => {
    let planId: any = null;
    if (l.planKind === "livePlan") {
      const r = l.planId != null ? liveRowMap.get(l.planId) : undefined;
      if (r) {
        planId = {
          _id: String(r.id),
          duration: r.duration,
          price: r.price,
          withMaterial: false,
          liveCourse: liveMap.get(r.liveCourseId) ?? null,
        };
      }
    } else if (l.planKind === "testSeriesPrice") {
      const r = l.planId != null ? tsRowMap.get(l.planId) : undefined;
      if (r) {
        planId = {
          _id: String(r.id),
          duration: r.durationDays,
          price: Number(r.price),
          withMaterial: false,
          testSeries: tsMap.get(r.testSeriesId) ?? null,
        };
      }
    } else {
      const r = l.planId != null ? priceMap.get(l.planId) : undefined;
      if (r) {
        planId = {
          _id: String(r.id),
          duration: r.duration,
          price: r.price,
          withMaterial: !!r.withMaterial,
        };
        if (r.packageId) planId.packageId = pkgMap.get(r.packageId) ?? null;
        else if (r.courseId) planId.courseId = courseMap.get(r.courseId) ?? null;
        else if (r.ebookId) planId.ebookId = ebookMap.get(r.ebookId) ?? null;
      }
    }
    return {
      _id: String(l.id),
      planId,
      promoterPercentage: Number(l.promoterPercentage),
      customerPercentage: Number(l.customerPercentage),
    };
  });
};

/**
 * Checkout per-plan discount lookup (TASK 2 checkout): map of planId →
 * customerPercentage for a promocode's link rows. Presence of a key means the
 * code is valid for that plan; the value is its discount %. Empty map ⇒ a
 * legacy code with no per-plan links (caller falls back to the global discount).
 * Scoped to price-kind links (package/course/ebook); live/testSeries use their
 * own plan-based apply endpoints.
 */
export const loadPlanDiscountsSql = async (
  promocodeId: number
): Promise<Map<number, number>> => {
  const links = await prisma.promotedPackageCourseEbook.findMany({
    where: { promocodeId },
    select: { planId: true, planKind: true, customerPercentage: true },
  });
  const map = new Map<number, number>();
  for (const l of links) {
    if (l.planId == null) continue;
    if (l.planKind === "livePlan" || l.planKind === "testSeriesPrice") continue;
    map.set(l.planId, Number(l.customerPercentage ?? 0));
  }
  return map;
};

/**
 * Per-plan customerPercentage for TEST-SERIES price links (planKind
 * "testSeriesPrice"). Mirror of loadPlanDiscountsSql, but scoped to test-series
 * plans (which loadPlanDiscountsSql intentionally skips). Returns
 * Map<testSeriesPriceId, percentage>.
 */
export const loadTestSeriesPlanDiscountsSql = async (
  promocodeId: number
): Promise<Map<number, number>> => {
  const links = await prisma.promotedPackageCourseEbook.findMany({
    where: { promocodeId },
    select: { planId: true, planKind: true, customerPercentage: true },
  });
  const map = new Map<number, number>();
  for (const l of links) {
    if (l.planId == null) continue;
    if (l.planKind !== "testSeriesPrice") continue;
    map.set(l.planId, Number(l.customerPercentage ?? 0));
  }
  return map;
};

/**
 * Per-plan customerPercentage for LIVE-COURSE plan links (planKind "livePlan").
 * Mirror of loadTestSeriesPlanDiscountsSql for the live-course endpoint.
 * Returns Map<liveCoursePlanId, percentage>.
 */
export const loadLivePlanDiscountsSql = async (
  promocodeId: number
): Promise<Map<number, number>> => {
  const links = await prisma.promotedPackageCourseEbook.findMany({
    where: { promocodeId },
    select: { planId: true, planKind: true, customerPercentage: true },
  });
  const map = new Map<number, number>();
  for (const l of links) {
    if (l.planId == null) continue;
    if (l.planKind !== "livePlan") continue;
    map.set(l.planId, Number(l.customerPercentage ?? 0));
  }
  return map;
};

/**
 * All-SQL promo resolution for the payment/checkout flow — the SQL counterpart
 * of `client/live-course/promo.resolveLivePromo` (which is Mongo-only and breaks
 * when Mongo isn't connected). Validates the code, enforces entity-level + per-
 * plan scope, and computes the discount for ONE plan:
 *   - code must be active and cover `entity` (appliesTo)
 *   - if the code has ANY link rows it is "per-plan scoped": valid ONLY for a
 *     plan that has a (promocodeId, planId) row — an unlinked plan is rejected
 *   - discount = that plan's `customerPercentage` (%), else (legacy codes with
 *     zero link rows) the top-level `discountType`/`discountValue`
 * Referral codes are intentionally NOT handled (SQL referral is out of scope —
 * mirrors the apply controller's SQL branch). Result shape mirrors the fields
 * the payment controllers read off `resolveLivePromo`'s result.
 */
export interface PromoResolveResultSql {
  promo: { _id: string; promocode: string };
  discountType: "flat" | "percentage";
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  promoterPercentage: number;
  promoterCommission: number;
  // Set ONLY when the code resolved as a referral code (not a promocode): the
  // owning customer's id, so create-order can stamp referrer_id on the order row
  // and verify can credit the referrer's wallet. Undefined for promocodes.
  referrerId?: number;
}

export const resolvePromoForPlanSql = async (
  rawCode: string,
  baseAmount: number,
  entity: { type: AppliesToType; id: number },
  planId: number,
  buyerId?: number
): Promise<{ result?: PromoResolveResultSql; error?: string }> => {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!code) return { error: "Promo code is required." };
  if (!(baseAmount > 0)) return { error: "Promo codes don't apply to a zero-priced plan." };
  if (!entity?.id) return { error: "Entity context is required." };

  const promo = await findActiveByCode(code);
  if (!promo) {
    // Not a promocode — try it as a referral code (single apply flow for both).
    return resolveReferralForPlanSql(code, baseAmount, entity, buyerId);
  }
  if (!promoCovers(promo, entity)) return { error: "This promo code is not valid for this item." };

  // Per-plan scope: a code with link rows is valid only for linked plans.
  const [totalLinks, link] = await Promise.all([
    prisma.promotedPackageCourseEbook.count({ where: { promocodeId: promo.id } }),
    prisma.promotedPackageCourseEbook.findFirst({
      where: { promocodeId: promo.id, planId },
      select: { customerPercentage: true, promoterPercentage: true },
    }),
  ]);
  if (totalLinks > 0 && !link) {
    return { error: "This promo code is not valid for this plan." };
  }

  // Resolve discount: per-plan % when a link row exists, else legacy global.
  let discountType: "flat" | "percentage";
  let discountValue: number;
  let promoterPercentage = 0;
  const perPlanPct = link ? Number(link.customerPercentage ?? 0) : 0;
  if (link && perPlanPct > 0) {
    discountType = "percentage";
    discountValue = perPlanPct;
    promoterPercentage = Number(link.promoterPercentage ?? 0);
  } else {
    discountType = (promo.discountType as "flat" | "percentage") ?? "percentage";
    discountValue = Number(promo.discountValue ?? 0);
  }

  const rawDiscount =
    discountType === "percentage"
      ? Math.round((baseAmount * discountValue) / 100)
      : Math.round(discountValue);
  const discountAmount = Math.min(baseAmount, Math.max(0, rawDiscount));
  if (!(discountAmount > 0)) return { error: "This promo code has no discount configured." };

  const finalAmount = baseAmount - discountAmount;
  const promoterCommission = Math.max(0, Math.round((finalAmount * promoterPercentage) / 100));

  return {
    result: {
      promo: { _id: String(promo.id), promocode: promo.promocode ?? "" },
      discountType,
      discountValue,
      originalAmount: baseAmount,
      discountAmount,
      finalAmount,
      promoterPercentage,
      promoterCommission,
    },
  };
};

/**
 * Referral-code branch of resolvePromoForPlanSql. A referral code has no
 * promocode row and no per-plan links: it's a flat global percentage on any
 * package/course/ebook. `promo._id` is returned EMPTY so the payment controllers
 * store no promocodeId (the discount is still applied to the charged amount).
 * A customer can't redeem their own referral code (self-referral is rejected).
 */
const resolveReferralForPlanSql = async (
  code: string,
  baseAmount: number,
  entity: { type: AppliesToType; id: number },
  buyerId?: number
): Promise<{ result?: PromoResolveResultSql; error?: string }> => {
  const referral = await resolveReferralCode(code);
  if (!referral) return { error: "Invalid or expired promo code." };
  if (!referralCovers(entity.type)) return { error: "This promo code is not valid for this item." };
  if (buyerId && referral.referrerId === buyerId) {
    return { error: "You can't use your own referral code." };
  }

  const discountAmount = Math.min(
    baseAmount,
    Math.max(0, Math.round((baseAmount * referral.discountValue) / 100))
  );
  if (!(discountAmount > 0)) return { error: "This promo code has no discount configured." };

  return {
    result: {
      promo: { _id: "", promocode: code },
      discountType: referral.discountType,
      discountValue: referral.discountValue,
      originalAmount: baseAmount,
      discountAmount,
      finalAmount: baseAmount - discountAmount,
      promoterPercentage: 0,
      promoterCommission: 0,
      referrerId: referral.referrerId,
    },
  };
};

/**
 * SQL delivery-address ownership check (replaces the Mongo `CustomerAddress`
 * lookup in the payment SQL branches — Mongo can't cast the int customerId).
 * Returns true iff address `addressId` belongs to customer `customerId`.
 */
export const addressBelongsToCustomerSql = async (
  addressId: number,
  customerId: number
): Promise<boolean> => {
  const row = await prisma.customerAddress.findFirst({
    where: { id: addressId, userId: customerId },
    select: { id: true },
  });
  return !!row;
};

// ── getPromocodePlans picker (grouped by entity + exam-type via Goal) ─────────
const ALL_APPLIES_TO_TYPES: AppliesToType[] = [
  "package",
  "course",
  "liveCourse",
  "ebook",
  "testSeries",
];

/**
 * Picker payload: entities (with >= 1 plan) grouped under their exam type.
 *
 * NOTE on exam types: in Mongo, packages carry a `goalLabelId` resolved against
 * `Goal.labels` to surface an exam type. The SQL Package model has no
 * goal-label linkage (only `examId`→CustomerTargetGoal), so the exam-type
 * grouping can't be reproduced on SQL — every entity falls into the FE's
 * "Ungrouped" bucket (examType field omitted) and `examTypes` is empty. An
 * `examTypeId` filter, if supplied, matches nothing and returns [] — the
 * conservative degradation. See report.
 */
export const getPromocodePlansSql = async (query: {
  type?: string;
  examTypeId?: string;
  search?: string;
}): Promise<{
  examTypes: { id: string; name: string }[];
  entities: any[];
}> => {
  const requested: AppliesToType[] = ALL_APPLIES_TO_TYPES.includes(query.type as AppliesToType)
    ? [query.type as AppliesToType]
    : ALL_APPLIES_TO_TYPES;

  const search = query.search?.trim();
  const entities: any[] = [];
  const examTypes = new Map<string, string>();

  for (const t of requested) {
    let docs: { id: number; name: string | null; goalLabelId?: any }[] = [];
    if (t === "package") {
      const rows = await prisma.package.findMany({
        where: search ? { name: { contains: search } } : {},
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else if (t === "course") {
      const rows = await prisma.course.findMany({
        where: search ? { name: { contains: search } } : {},
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else if (t === "liveCourse") {
      const rows = await prisma.liveCourse.findMany({
        where: search ? { name: { contains: search } } : {},
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else if (t === "ebook") {
      const rows = await prisma.eBook.findMany({
        where: search ? { name: { contains: search } } : {},
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else {
      const rows = await prisma.testSeries.findMany({
        where: search ? { title: { contains: search } } : {},
        select: { id: true, title: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.title }));
    }
    if (!docs.length) continue;

    const plans = await loadPlansForEntitiesSql(
      t,
      docs.map((d) => d.id)
    );
    const plansByEntity = new Map<number, ResolvedPlanSql[]>();
    for (const p of plans) {
      if (!plansByEntity.has(p.entityId)) plansByEntity.set(p.entityId, []);
      plansByEntity.get(p.entityId)!.push(p);
    }

    for (const d of docs) {
      const entityPlans = plansByEntity.get(d.id);
      if (!entityPlans?.length) continue;

      // SQL has no package→goal-label linkage, so no entity carries an exam
      // type. An examTypeId filter therefore excludes everything.
      if (query.examTypeId) continue;

      const entity: any = {
        id: String(d.id),
        name: d.name,
        type: t,
        plans: entityPlans.map((p) => ({
          id: String(p.id),
          duration: p.duration,
          price: p.price,
          withMaterial: p.withMaterial,
        })),
      };
      entities.push(entity);
    }
  }

  return {
    examTypes: Array.from(examTypes, ([id, name]) => ({ id, name })),
    entities,
  };
};

/** Resolve the validPlans map for a syncPlanLinksSql call from appliesTo. */
export const resolveValidPlansSql = async (
  type: AppliesToType,
  entityIds: number[]
): Promise<Map<number, ResolvedPlanSql>> => {
  const resolved = await loadPlansForEntitiesSql(type, entityIds);
  return new Map(resolved.map((p) => [p.id, p]));
};

/**
 * Resolve validPlans across MULTIPLE appliesTo groups (multi-type promocodes) —
 * the union of every group's plans, keyed by planId. This is what lets
 * syncPlanLinksSql keep links spanning Test Series + Packages + Courses + … at
 * once: a plan is valid (kept) iff it belongs to ANY referenced entity, so the
 * replace-delete only drops links absent from the full multi-type plans[].
 */
export const resolveValidPlansMultiSql = async (
  groups: AppliesGroup[]
): Promise<Map<number, ResolvedPlanSql>> => {
  const map = new Map<number, ResolvedPlanSql>();
  for (const g of groups) {
    const resolved = await loadPlansForEntitiesSql(g.type, g.ids);
    for (const p of resolved) map.set(p.id, p);
  }
  return map;
};
