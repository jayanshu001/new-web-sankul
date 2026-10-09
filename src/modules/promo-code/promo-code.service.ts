/**
 * Promocodes on ws_promocode (Prisma `Promocode`): appliesTo-driven admin CRUD, the
 * client apply-promo coverage/discount check, and the per-plan promoter/customer %
 * plan links (ws_promoted_package_course_ebook). DTOs stringify ids (`_id`) and keep
 * the snake_case `promo_start_at` / `promo_expire_at` keys.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { buildPagination } from "../../utils/listQuery";
import { buildPrismaPrefixSearch } from "../../utils/searchFilter";
import logger from "../../utils/logger";
import { parsePositiveInt } from "../../utils/parseId";

// Timestamp/window fields are snake_case on `Promocode`; discount/appliesTo
// columns keep camelCase Prisma names via @map.

export const parsePcId = parsePositiveInt;

export const APPLIES_TO_TYPES = ["package", "course", "liveCourse", "ebook", "testSeries"] as const;
export type AppliesToType = (typeof APPLIES_TO_TYPES)[number];

export type AppliesGroup = { type: AppliesToType; ids: number[] };

/**
 * Normalised appliesTo groups from either stored shape:
 *  - single-type: appliesToType="package", appliesToIds=[1,2,3]
 *  - multi-type:  appliesToType="mixed",   appliesToIds=[{type,ids},…]
 * Single source of truth so a mixed-type promocode behaves like a single-type one.
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

/** A single group is stored in the single-type shape so existing rows stay compatible. */
const toAppliesToStorage = (groups: AppliesGroup[]): { appliesToType: string; appliesToIds: any } => {
  if (groups.length === 1) {
    return { appliesToType: groups[0].type, appliesToIds: parseIdArray(groups[0].ids) };
  }
  return { appliesToType: "mixed", appliesToIds: groups.map((g) => ({ type: g.type, ids: parseIdArray(g.ids) })) };
};

/** Throws {__badRequest} on mismatch. */
export const assertAppliesToGroupsExistSql = async (groups: AppliesGroup[]): Promise<void> => {
  if (!groups.length) throw badRequest("Select at least one item");
  for (const g of groups) await assertAppliesToExistsSql(g.type, g.ids);
};

/** Effective value when updating plans. */
export const getAppliesToGroupsById = async (id: number): Promise<AppliesGroup[]> => {
  const row = await prisma.promocode.findUnique({
    where: { id },
    select: { appliesToType: true, appliesToIds: true },
  });
  return row ? appliesToGroups(row) : [];
};

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

// `{ _id, name, image }` refs; testSeries maps title→name, ebook/testSeries map thumbnail→image.

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
  // Preserve the requested id order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ _id: String(r.id), name: r.name, image: r.image }));
};

/** Throws {__badRequest} when any id is missing. */
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

/** appliesTo summarised to `{ type, count }` (type="mixed" for multi). */
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
 * appliesTo as an array of populated groups `[{ type, ids: [{_id,name,image}] }, …]`.
 * The per-plan grid is rebuilt separately from loadPlanLinksSql.
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

export const listPromocodes = async (opts: {
  search: string | null;
  status: boolean | null;
  type: "public" | "private" | null;
  fromDate: Date | null;
  toDate: Date | null;
  promoterId?: number | null;
  skip: number;
  limitNum: number;
  pageNum: number;
}) => {
  const where: Prisma.PromocodeWhereInput = {};
  if (opts.search) where.promocode = { contains: opts.search.toUpperCase() };
  if (opts.status !== null) where.status = opts.status;
  if (opts.type) where.type = opts.type;
  if (opts.promoterId != null) where.promoterId = opts.promoterId;
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

// The JSON id match can't run in SQL, and these admin reads cover every code ever
// created (no status/date filter). So match on the three columns appliesToGroups reads,
// then load full rows only for the ids kept, in the same order.
const coveringIds = async (
  where: Prisma.PromocodeWhereInput,
  orderBy: Prisma.PromocodeOrderByWithRelationInput,
  type: AppliesToType,
  id: number
): Promise<number[]> => {
  const rows = await prisma.promocode.findMany({ where, orderBy, select: { id: true, appliesToType: true, appliesToIds: true } });
  return rows.filter((r) => appliesToGroups(r).some((g) => g.type === type && g.ids.includes(id))).map((r) => r.id);
};
const promocodesInOrder = async (ids: number[]) => {
  if (!ids.length) return [];
  const byId = new Map((await prisma.promocode.findMany({ where: { id: { in: ids } } })).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r != null);
};

/** Newest first. The JSON id match is resolved in memory after narrowing by type. */
export const listPromocodesForPackage = async (packageId: number) => {
  // "mixed" rows are included and matched via appliesToGroups.
  const ids = await coveringIds({ appliesToType: { in: ["package", "mixed"] } }, { created_at: "desc" }, "package", packageId);
  return (await promocodesInOrder(ids)).map(listDto);
};

/**
 * Paginated promocodes scoped to one entity (admin package/course/ebook tabs). SQL
 * can't paginate on the `appliesToIds` JSON match, so rows are narrowed to
 * `[type,"mixed"]` (+ code search) in SQL, matched in memory, then sliced; `total`
 * is the matched count. Newest first.
 */
export const listPromocodesForScope = async (
  type: AppliesToType,
  id: number,
  q: { search?: string; page: number; limit: number; skip: number }
) => {
  const matched = await coveringIds(
    {
      appliesToType: { in: [type, "mixed"] },
      ...(q.search ? { promocode: { contains: q.search.toUpperCase() } } : {}),
    },
    { created_at: "desc" },
    type,
    id
  );
  const data = (await promocodesInOrder(matched.slice(q.skip, q.skip + q.limit))).map(listDto);
  return { data, pagination: buildPagination(matched.length, q.page, q.limit) };
};

/** Plan links are not returned here (`plans: []`). */
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

  const data: Prisma.PromocodeUncheckedUpdateInput = { updated_at: new Date() };
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

// Flip the status, or set it when nextStatus is given.
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

/** Client public list: `status:true, type:"public"` within the active window, by promo_expire_at asc. */
const toPublicPromoDto = (
  r: any,
  /** Effective discount resolved from plan links; falls back to the row's own columns. */
  effective?: { discountType: string; discountValue: number }
) => ({
  _id: String(r.id),
  promocode: r.promocode,
  title: r.title ?? "",
  description: r.description ?? "",
  discountType: effective?.discountType ?? r.discountType,
  discountValue: effective ? effective.discountValue : Number(r.discountValue ?? 0),
  promo_start_at: r.promo_start_at ?? null,
  promo_expire_at: r.promo_expire_at ?? null,
});

/**
 * Each code's effective discount, using the same rule as applyPromocode: per-plan
 * link rows (customer_percentage) are the real source; the `discount_value` column
 * is only a fallback for codes with no link rows at all.
 *
 * With an `appliesTo` filter only that entity's own plans contribute, so a code
 * can't advertise another entity's percentage. Plan ids are per-table, so links are
 * matched on `planKind` as well as `planId`. Differing percentages report the
 * highest ("up to X% off"); checkout still prices per plan.
 *
 * A link matching at 0% is left unset so the DTO falls back to the row's own
 * columns (as resolvePromoForPlanSql does at checkout). Linked-but-no-match stays 0:
 * checkout rejects every plan of that entity.
 */
export const resolveEffectiveDiscounts = async (
  rows: any[],
  appliesTo?: { type: AppliesToType; id: number }
): Promise<Map<number, { discountType: string; discountValue: number }>> => {
  const out = new Map<number, { discountType: string; discountValue: number }>();
  if (!rows.length) return out;

  const links = await prisma.promotedPackageCourseEbook.findMany({
    where: { promocodeId: { in: rows.map((r) => Number(r.id)) } },
    select: { promocodeId: true, planId: true, planKind: true, customerPercentage: true },
  });
  if (!links.length) return out; // all legacy codes → callers keep the column value

  let scopedPlanIds: Set<number> | null = null;
  let scopedKind: PlanKind | null = null;
  if (appliesTo) {
    const plans = await loadPlansForEntitiesSql(appliesTo.type, [appliesTo.id]);
    scopedPlanIds = new Set(plans.map((p) => p.id));
    scopedKind = PLAN_KIND_BY_TYPE[appliesTo.type];
  }

  const best = new Map<number, number>();
  const linked = new Set<number>();
  for (const l of links) {
    const pid = l.promocodeId == null ? null : Number(l.promocodeId);
    if (pid == null || l.planId == null) continue;
    // Any link row makes the code link-driven, even if none match this entity.
    linked.add(pid);
    if (scopedPlanIds && !(l.planKind === scopedKind && scopedPlanIds.has(l.planId))) continue;
    const pct = Number(l.customerPercentage ?? 0);
    best.set(pid, Math.max(best.get(pid) ?? 0, pct));
  }

  for (const id of linked) {
    const pct = best.get(id);
    if (pct === undefined) out.set(id, { discountType: "percentage", discountValue: 0 }); // linked, none in scope
    else if (pct > 0) out.set(id, { discountType: "percentage", discountValue: pct });
    // matched at 0% → unset → row column, mirroring checkout
  }
  return out;
};

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

  // Public codes per type are a small set, so the in-memory coverage filter keeps
  // totals exact without a JSON query. "mixed" rows are included and matched via appliesToGroups.
  if (opts.appliesTo) {
    const rows = await prisma.promocode.findMany({
      where: { ...baseWhere, appliesToType: { in: [opts.appliesTo.type, "mixed"] } },
      orderBy: { promo_expire_at: "asc" },
    });
    const covered = rows.filter((r) =>
      appliesToGroups(r).some((g) => g.type === opts.appliesTo!.type && g.ids.includes(opts.appliesTo!.id))
    );
    const total = covered.length;
    const pageRows = covered.slice(opts.skip, opts.skip + opts.limitNum);
    const effective = await resolveEffectiveDiscounts(pageRows, opts.appliesTo);
    return {
      data: pageRows.map((r) => toPublicPromoDto(r, effective.get(Number(r.id)))),
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

  const effective = await resolveEffectiveDiscounts(rows);
  return {
    data: rows.map((r) => toPublicPromoDto(r, effective.get(Number(r.id)))),
    pagination: {
      total,
      page: opts.pageNum,
      limit: opts.limitNum,
      totalPages: Math.ceil(total / opts.limitNum),
    },
  };
};

/** FE `type` param (kebab aliases allowed) → canonical appliesTo type, or null. */
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

/** Active = status + window; code is upper-cased. */
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

// Referral codes (ws_customer.referral_code) double as a global percentage code so
// the app uses one apply/checkout flow; callers fall back to this when a code isn't
// a promocode. Discount = the active "student" program's refferalDiscount.
// package/course/ebook are served by /promocodes/apply; testSeries and liveCourse
// by their own plan-based preview endpoints.
export const REFERRAL_COVERED_TYPES: readonly AppliesToType[] = ["package", "course", "ebook", "testSeries", "liveCourse"];
export const referralCovers = (type: AppliesToType): boolean =>
  REFERRAL_COVERED_TYPES.includes(type);

// Referral code to referrer + student-program discount; null if unknown or 0%.
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

export const promoCovers = (
  promo: { appliesToType: string | null; appliesToIds: any },
  context: { type: AppliesToType; id: number }
): boolean =>
  appliesToGroups(promo).some((g) => g.type === context.type && g.ids.includes(context.id));

/** package / course / ebook only; liveCourse/testSeries use their own plan-based endpoints. */
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

/** All three types' plans live in `ws_package_course_ebook_price`. */
export const loadPricingPlansSql = async (entity: {
  type: "package" | "course" | "ebook";
  id: number;
}) => {
  const where: Prisma.PackageCourseEbookPriceWhereInput = { status: true };
  if (entity.type === "package") where.packageId = entity.id;
  else if (entity.type === "course") where.courseId = entity.id;
  else where.ebookId = entity.id;
  return prisma.packageCourseEbookPrice.findMany({ where, orderBy: { duration: "asc" } });
};

// Plan links (ws_promoted_package_course_ebook). `planKind` says which table
// `planId` (`pcb_price_id`) points at:
//   - "price"           → ws_package_course_ebook_price (package/course/ebook)
//   - "livePlan"        → ws_live_course_plan
//   - "testSeriesPrice" → ws_test_series_price
// The column has no FK to the latter two, so the kind is required to resolve them.
export type PlanKind = "price" | "livePlan" | "testSeriesPrice";

const PLAN_KIND_BY_TYPE: Record<AppliesToType, PlanKind> = {
  package: "price",
  course: "price",
  liveCourse: "livePlan",
  ebook: "price",
  testSeries: "testSeriesPrice",
};

/**
 * `type` on ws_promoted_package_course_ebook: what the link is for. `planKind` only
 * says which table `pcb_price_id` points at, so it can't tell a course link from an
 * ebook link:
 *
 *   planKind "price"           → type "package" | "course" | "ebook"
 *   planKind "livePlan"        → type "live_course"
 *   planKind "testSeriesPrice" → type "test_series"
 *
 * See docs/migration/schema-changes/2026-08-21_promoted_plan_link_type.sql.
 */
export const PLAN_LINK_TYPES = [
  "package",
  "course",
  "ebook",
  "live_course",
  "test_series",
] as const;
export type PlanLinkType = (typeof PLAN_LINK_TYPES)[number];

const PLAN_LINK_TYPE_BY_APPLIES_TO: Record<AppliesToType, PlanLinkType> = {
  package: "package",
  course: "course",
  ebook: "ebook",
  liveCourse: "live_course",
  testSeries: "test_series",
};

export const planLinkTypeFor = (type: AppliesToType): PlanLinkType =>
  PLAN_LINK_TYPE_BY_APPLIES_TO[type];

export interface ResolvedPlanSql {
  id: number;
  entityId: number;
  duration: number;
  price: number;
  withMaterial: boolean;
  kind: PlanKind;
  type: PlanLinkType;
}

export interface PlanLinkInputSql {
  planId: string | number;
  promoterPercentage: number;
  customerPercentage: number;
  /**
   * Plan ids overlap across the three plan tables, so (planId, planKind) is the key
   * everywhere: resolve, upsert and replace-delete.
   */
  planKind: PlanKind;
}

// Active plans of the given products, tagged with plan kind and link type.
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
      type: "live_course" as const,
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
      type: "test_series" as const,
    }));
  }

  const where: Prisma.PackageCourseEbookPriceWhereInput = { status: true };
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
    // All three share one table; the caller's appliesTo type is what tells them apart.
    type: planLinkTypeFor(type),
  }));
};

/**
 * planId → every plan that id could refer to; more than one when appliesTo spans
 * plan tables whose id spaces overlap.
 */
export type ValidPlanMap = Map<number, ResolvedPlanSql[]>;

/**
 * Exact (planId, planKind) match or 400. No first-match fallback: with two plan
 * kinds sharing an id it would store one under the other's row and lose a link.
 */
const pickPlanCandidate = (
  candidates: ResolvedPlanSql[],
  wanted: PlanKind,
  planId: number
): ResolvedPlanSql => {
  const exact = candidates.find((c) => c.kind === wanted);
  if (exact) return exact;
  throw badRequest(
    `plans[]: planId ${planId} is not a ${wanted} plan of the selected entities (found: ${[...new Set(candidates.map((c) => c.kind))].join(", ")}).`
  );
};

/**
 * Replace semantics: upsert each kept link and delete the rest. Links whose planId
 * isn't in `validPlans` are silently dropped.
 */
export const syncPlanLinksSql = async (
  promocodeId: number,
  plans: PlanLinkInputSql[],
  validPlans: ValidPlanMap
): Promise<void> => {
  const kept = plans
    .map((p) => ({ ...p, pid: Number(p.planId) }))
    .filter((p) => Number.isInteger(p.pid) && validPlans.has(p.pid));

  const keptKeys: { planId: number; planKind: PlanKind }[] = [];
  for (const p of kept) {
    const { kind, type } = pickPlanCandidate(validPlans.get(p.pid)!, p.planKind, p.pid);
    keptKeys.push({ planId: p.pid, planKind: kind });
    // planKind is part of the identity, or the update could rewrite another kind's row.
    const existing = await prisma.promotedPackageCourseEbook.findFirst({
      where: { promocodeId, planId: p.pid, planKind: kind },
      select: { id: true },
    });
    if (existing) {
      await prisma.promotedPackageCourseEbook.update({
        where: { id: existing.id },
        data: {
          planKind: kind,
          type,
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
          type,
          promoterPercentage: p.promoterPercentage,
          customerPercentage: p.customerPercentage,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }
  }

  await deleteLinksExcept(promocodeId, keptKeys);
};

/** Keyed on (planId, planKind): removing test-series plan 1 must keep live plan 1. */
const deleteLinksExcept = (
  promocodeId: number,
  keep: { planId: number; planKind: PlanKind }[]
) =>
  prisma.promotedPackageCourseEbook.deleteMany({
    where: { promocodeId, ...(keep.length ? { NOT: keep } : {}) },
  });

/** Used when appliesTo changes but `plans` is omitted, so stale percentages don't linger. */
export const prunePlanLinksSql = async (
  promocodeId: number,
  validPlans: ValidPlanMap
): Promise<void> => {
  const keep = [...validPlans.values()].flat().map((p) => ({ planId: p.id, planKind: p.kind }));
  await deleteLinksExcept(promocodeId, keep);
};

/** Delete/bulk-delete cleanup. */
export const deletePlanLinksSql = async (promocodeIds: number[]): Promise<void> => {
  if (!promocodeIds.length) return;
  await prisma.promotedPackageCourseEbook.deleteMany({
    where: { promocodeId: { in: promocodeIds } },
  });
};

/**
 * Edit-screen `plans[]`: each link with `planId` populated (duration/price/withMaterial
 * + parent entity `{ _id, name }`), matching the FE `toPlanLink` parser.
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
 * planId → customerPercentage for price-kind links (package/course/ebook). A key's
 * presence means the code is valid for that plan; an empty map means a code with no
 * per-plan links (caller falls back to the global discount).
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

/** Same as loadPlanDiscountsSql, for "testSeriesPrice" links. */
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

/** Same as loadPlanDiscountsSql, for "livePlan" links. */
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

export interface PromoResolveResultSql {
  promo: { _id: string; promocode: string };
  discountType: "flat" | "percentage";
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  promoterPercentage: number;
  promoterCommission: number;
  /** Set only for a referral code: the owning customer, stamped as referrer_id and credited at verify. */
  referrerId?: number;
}

/**
 * Promo resolution for one plan at checkout:
 *   - the code must be active and cover `entity` (appliesTo);
 *   - a code with any link rows is per-plan scoped: an unlinked plan is rejected;
 *   - discount = that plan's `customerPercentage` when > 0, else the code's own
 *     `discountType`/`discountValue`.
 * A code that isn't a promocode is tried as a referral code.
 */
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
    return resolveReferralForPlanSql(code, baseAmount, entity, buyerId);
  }
  if (!promoCovers(promo, entity)) return { error: "This promo code is not valid for this item." };

  // `planKind` is required in the link filter (see order-code-snapshot.repository.findPlanLink):
  // the plan tables have overlapping id spaces and `pcb_price_id` stores a bare id, so
  // (promocodeId, planId) alone lets a live-course link answer for an ebook plan of the
  // same id, applying its percentages. Real codes link both kinds under one code.
  // The count stays kind-agnostic: "is this code per-plan scoped at all?" is a property of the code.
  const planKind = PLAN_KIND_BY_TYPE[entity.type];
  const [totalLinks, link] = await Promise.all([
    prisma.promotedPackageCourseEbook.count({ where: { promocodeId: promo.id } }),
    prisma.promotedPackageCourseEbook.findFirst({
      where: { promocodeId: promo.id, planId, planKind },
      select: { customerPercentage: true, promoterPercentage: true },
    }),
  ]);
  if (totalLinks > 0 && !link) {
    return { error: "This promo code is not valid for this plan." };
  }

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
 * A referral code has no promocode row or plan links: a global percentage. `promo._id`
 * is empty so the payment controllers store no promocodeId. Self-referral is rejected.
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

/** Soft-deleted addresses (`status: false`) are not usable at checkout. */
export const addressBelongsToCustomerSql = async (
  addressId: number,
  customerId: number
): Promise<boolean> => {
  const row = await prisma.customerAddress.findFirst({
    where: { id: addressId, userId: customerId, status: true },
    select: { id: true },
  });
  return !!row;
};

const ALL_APPLIES_TO_TYPES: AppliesToType[] = [
  "package",
  "course",
  "liveCourse",
  "ebook",
  "testSeries",
];

/**
 * Picker payload: entities with ≥ 1 plan. Only active entities are offered.
 *
 * There is no package→goal-label linkage in SQL, so exam-type grouping isn't
 * possible: `examTypes` is empty, every entity lands in the FE's "Ungrouped"
 * bucket, and an `examTypeId` filter matches nothing.
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
        where: { ...buildPrismaPrefixSearch(search, ["name"]), active: true },
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else if (t === "course") {
      const rows = await prisma.course.findMany({
        where: { ...buildPrismaPrefixSearch(search, ["name"]), status: true },
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else if (t === "liveCourse") {
      const rows = await prisma.liveCourse.findMany({
        where: { ...buildPrismaPrefixSearch(search, ["name"]), status: true },
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else if (t === "ebook") {
      const rows = await prisma.eBook.findMany({
        where: { ...buildPrismaPrefixSearch(search, ["name"]), active: true },
        select: { id: true, name: true },
      });
      docs = rows.map((r) => ({ id: r.id, name: r.name }));
    } else {
      const rows = await prisma.testSeries.findMany({
        where: { ...buildPrismaPrefixSearch(search, ["title"]), status: true },
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

/**
 * Union of every group's plans (multi-type promocodes), so syncPlanLinksSql only
 * drops links absent from the full multi-type plans[].
 */
export const resolveValidPlansMultiSql = async (
  groups: AppliesGroup[]
): Promise<ValidPlanMap> => {
  const map: ValidPlanMap = new Map();
  for (const g of groups) {
    const resolved = await loadPlansForEntitiesSql(g.type, g.ids);
    for (const p of resolved) {
      // Append, never overwrite: plans of different kinds can share an id.
      const existing = map.get(p.id);
      if (existing) existing.push(p);
      else map.set(p.id, [p]);
    }
  }
  return map;
};
