/**
 * PromoCode (appliesTo) — dual-path SQL/Mongo. Net-new SQL table ws_promo_code /
 * Prisma model PromoCodeRule (appliesToType + appliesToIds JSON int[]).
 * Gated behind `isMysqlModule("promo-code")`.
 *
 * Scope: the appliesTo-driven admin CRUD (list/get/create/update/delete/toggle/
 * bulk) + the client apply-promo coverage/discount check. The per-plan
 * promoter/customer % "plan links" (PromotedPackageCourseEbook /
 * ws_promoted_package_course_ebook) and the `getPromocodePlans` picker stay on
 * Mongo — they overlap the legacy commission table and are out of scope here.
 *
 * All ids are SQL ints at runtime; DTOs restringify (`_id = String(id)`) to the
 * Mongo doc shape so the admin/client response contracts are unchanged. Note the
 * Mongo doc casing: `promo_start_at` / `promo_expire_at`.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const PROMO_CODE_MODULE = "promo-code";
export const isPromoCodeMysql = (): boolean => isMysqlModule(PROMO_CODE_MODULE);

export const parsePcId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const APPLIES_TO_TYPES = ["package", "course", "liveCourse", "ebook", "testSeries"] as const;
export type AppliesToType = (typeof APPLIES_TO_TYPES)[number];

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
  promo_start_at: r.promoStartAt ?? null,
  promo_expire_at: r.promoExpireAt ?? null,
  status: r.status,
  discountType: r.discountType,
  discountValue: Number(r.discountValue ?? 0),
  promoterId: r.promoterId != null ? String(r.promoterId) : null,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

/** List DTO — appliesTo summarised to `{ type, count }`. */
const listDto = (r: any) => {
  const ids = parseIdArray(r.appliesToIds);
  return {
    ...baseDto(r),
    appliesTo: r.appliesToType ? { type: r.appliesToType, count: ids.length } : null,
  };
};

/** Detail DTO — appliesTo populated to `{ type, ids: [{_id,name,image}] }`. */
const detailDto = async (r: any) => {
  const dto: any = baseDto(r);
  const type = r.appliesToType as AppliesToType | null;
  const ids = parseIdArray(r.appliesToIds);
  if (type && ids.length) {
    const refs = await resolveAppliesToRefs(type, ids);
    dto.appliesTo = { type, ids: refs };
  } else {
    dto.appliesTo = type ? { type, ids: [] } : null;
  }
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
    where.promoStartAt = {};
    if (opts.fromDate) where.promoStartAt.gte = opts.fromDate;
    if (opts.toDate) where.promoStartAt.lte = opts.toDate;
  }

  const [rows, total] = await Promise.all([
    prisma.promoCodeRule.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.limitNum,
    }),
    prisma.promoCodeRule.count({ where }),
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

/** getById — populates appliesTo; the OUT-OF-SCOPE plan links return []. */
export const getPromocodeById = async (id: number) => {
  const row = await prisma.promoCodeRule.findUnique({ where: { id } });
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
  appliesTo: { type: AppliesToType; ids: number[] };
}) => {
  const code = input.promocode.toUpperCase();
  const dup = await prisma.promoCodeRule.findFirst({ where: { promocode: code } });
  if (dup) return { conflict: true as const };

  await assertAppliesToExistsSql(input.appliesTo.type, input.appliesTo.ids);

  const now = new Date();
  const row = await prisma.promoCodeRule.create({
    data: {
      type: input.type,
      promocode: code,
      title: input.title,
      description: input.description,
      promoStartAt: input.promo_start_at,
      promoExpireAt: input.promo_expire_at,
      status: input.status,
      discountType: input.discountType,
      discountValue: input.discountValue,
      promoterId: input.promoterId,
      appliesToType: input.appliesTo.type,
      appliesToIds: parseIdArray(input.appliesTo.ids),
      createdAt: now,
      updatedAt: now,
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
    appliesTo: { type: AppliesToType; ids: number[] };
  }>
) => {
  const existing = await prisma.promoCodeRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { notFound: true as const };

  const data: any = { updatedAt: new Date() };
  if (input.promocode !== undefined) {
    const code = input.promocode.toUpperCase();
    const dup = await prisma.promoCodeRule.findFirst({
      where: { promocode: code, id: { not: id } },
    });
    if (dup) return { conflict: true as const };
    data.promocode = code;
  }
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.promo_start_at !== undefined) data.promoStartAt = input.promo_start_at;
  if (input.promo_expire_at !== undefined) data.promoExpireAt = input.promo_expire_at;
  if (input.type !== undefined) data.type = input.type;
  if (input.status !== undefined) data.status = input.status;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined) data.discountValue = input.discountValue;
  if (input.promoterId !== undefined) data.promoterId = input.promoterId;
  if (input.appliesTo !== undefined) {
    await assertAppliesToExistsSql(input.appliesTo.type, input.appliesTo.ids);
    data.appliesToType = input.appliesTo.type;
    data.appliesToIds = parseIdArray(input.appliesTo.ids);
  }

  const row = await prisma.promoCodeRule.update({ where: { id }, data });
  return { data: baseDto(row) };
};

export const deletePromocode = async (id: number) => {
  const existing = await prisma.promoCodeRule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { notFound: true as const };
  await prisma.promoCodeRule.delete({ where: { id } });
  return { ok: true as const };
};

export const toggleStatus = async (id: number, nextStatus: boolean | null) => {
  const existing = await prisma.promoCodeRule.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return { notFound: true as const };
  const status = nextStatus === null ? !existing.status : nextStatus;
  const row = await prisma.promoCodeRule.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  });
  return { data: { status: row.status } };
};

export const bulkStatus = async (ids: number[], status: boolean) => {
  const result = await prisma.promoCodeRule.updateMany({
    where: { id: { in: ids } },
    data: { status, updatedAt: new Date() },
  });
  return { matched: result.count, modified: result.count };
};

export const bulkDelete = async (ids: number[]) => {
  await prisma.promoCodeRule.deleteMany({ where: { id: { in: ids } } });
  return { ok: true as const };
};

// ── Client public list ───────────────────────────────────────────────────────
/**
 * Client-facing public promocode list — mirrors the Mongo client list:
 * `status:true, type:"public"` within the active window, sorted by
 * promo_expire_at asc, projected to the same fields the Mongo `.select(...)`
 * exposes. Returns `{ data, pagination }` byte-identical to the Mongo path.
 */
export const listPublicPromocodes = async (opts: {
  skip: number;
  limitNum: number;
  pageNum: number;
}) => {
  const now = new Date();
  const where: any = {
    status: true,
    type: "public",
    promoStartAt: { lt: now },
    promoExpireAt: { gt: now },
  };

  const [rows, total] = await Promise.all([
    prisma.promoCodeRule.findMany({
      where,
      orderBy: { promoExpireAt: "asc" },
      skip: opts.skip,
      take: opts.limitNum,
    }),
    prisma.promoCodeRule.count({ where }),
  ]);

  const data = rows.map((r) => ({
    _id: String(r.id),
    promocode: r.promocode,
    title: r.title ?? "",
    description: r.description ?? "",
    discountType: r.discountType,
    discountValue: Number(r.discountValue ?? 0),
    promo_start_at: r.promoStartAt ?? null,
    promo_expire_at: r.promoExpireAt ?? null,
  }));

  return {
    data,
    pagination: {
      total,
      page: opts.pageNum,
      limit: opts.limitNum,
      totalPages: Math.ceil(total / opts.limitNum),
    },
  };
};

// ── Client apply ─────────────────────────────────────────────────────────────
/** Find an active (status + window) promocode by (upper-cased) code. */
export const findActiveByCode = async (code: string) => {
  const now = new Date();
  return prisma.promoCodeRule.findFirst({
    where: {
      promocode: code.toUpperCase(),
      status: true,
      promoStartAt: { lt: now },
      promoExpireAt: { gt: now },
    },
  });
};

/** SQL coverage check: appliesToType===type && appliesToIds.includes(id). */
export const promoCovers = (
  promo: { appliesToType: string | null; appliesToIds: any },
  context: { type: AppliesToType; id: number }
): boolean => {
  if (!promo.appliesToType || promo.appliesToType !== context.type) return false;
  return parseIdArray(promo.appliesToIds).includes(context.id);
};

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
