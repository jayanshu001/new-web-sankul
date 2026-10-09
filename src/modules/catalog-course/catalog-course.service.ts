// Course catalog: categories, course lists and plan-enriched course listings.
import { computeDaysLeft } from "../../utils/planDuration";
import { catalogCourseRepository as repo } from "./catalog-course.repository";
import { listActivePricesByCourses } from "../commerce-price/commerce-price.service";
import { listActiveForCoursesOrPlans } from "../commerce-subscription/commerce-subscription.service";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import {
  toCourseCategoryWithCountDto,
  toCourseDto,
  toCourseListItemDto,
} from "./catalog-course.transformer";
import type {
  CourseDto,
  CourseListItemDto,
  CourseSubjectCategoryWithCountDto,
  ListCoursesOptions,
  PaginatedCourses,
} from "./catalog-course.types";
import type { PriceDto } from "../commerce-price/commerce-price.types";
import { parsePositiveInt } from "../../utils/parseId";
import { CACHE_TTL } from "../../config/cacheTtl";

export const parseCourseId = parsePositiveInt;

/** Active-course counts are computed only for the returned page; `total` is the full match count. */
export const listCourseCategoriesWithCounts = async (
  opts: { search?: string; skip?: number; limit?: number } = {}
): Promise<{ data: CourseSubjectCategoryWithCountDto[]; total: number }> => {
  const skip = Math.max(opts.skip ?? 0, 0);
  const take = Math.max(opts.limit ?? 20, 1);
  const [categories, total] = await repo.paginateActiveCategories({
    search: opts.search?.trim() || undefined,
    skip,
    take,
  });
  if (categories.length === 0) return { data: [], total };

  const counts = await repo.countActiveCoursesByCategory(categories.map((c) => c.id));
  const countById = new Map<number, number>();
  for (const row of counts) {
    if (row.courseSubjectCategoryId != null) {
      countById.set(row.courseSubjectCategoryId, row._count._all);
    }
  }
  return {
    data: categories.map((c) => toCourseCategoryWithCountDto(c, countById.get(c.id) ?? 0)),
    total,
  };
};

export const findCourseById = async (id: number): Promise<CourseDto | null> => {
  const row = await repo.findCourseById(id);
  return row ? toCourseDto(row) : null;
};

export const listActiveCourses = async (search?: string): Promise<CourseDto[]> => {
  const rows = await repo.listActiveCourses({ search: search?.trim() || undefined });
  return rows.map(toCourseDto);
};

export const listActiveCoursesByCategory = async (
  categoryId: number
): Promise<CourseDto[]> => {
  const rows = await repo.listActiveCoursesByCategory(categoryId);
  return rows.map(toCourseDto);
};

const SORT_FIELD: Record<NonNullable<ListCoursesOptions["sortBy"]>, "createdAt" | "ordered" | "name"> = {
  createdAt: "createdAt",
  ordered: "ordered",
  name: "name",
};

/**
 * `daysLeft`: the longest-lived active sub wins and a lifetime grant (endAt null)
 * beats any dated sub. A sub matches a course directly (`courseId`) or via one of
 * its plans (`planId`).
 */
export const listCoursesWithPlans = async (
  opts: ListCoursesOptions = {}
): Promise<PaginatedCourses> => {
  const page = Math.max(opts.page ?? 1, 1);
  const limit = Math.max(opts.limit ?? 10, 1);
  const skip = (page - 1) * limit;
  const sortField = SORT_FIELD[opts.sortBy ?? "createdAt"];
  const dir = opts.sortOrder === "asc" ? "asc" : "desc";

  // Rows and plans are customer-independent and cached under CacheEntity.CatalogCourse
  // (flushed by admin course and plan/price writes). The isPurchased/daysLeft overlay
  // is always computed live, so a purchase shows up on the next request.
  const { rows, total, plans } = await cache.aside({
    key: cache.key(
      CacheDomain.Client,
      CacheEntity.CatalogCourse,
      `list:${cache.hashFilter({ isPopular: opts.isPopular, search: opts.search, categoryId: opts.categoryId, sortField, dir, skip, limit })}`
    ),
    ttlSeconds: CACHE_TTL.CATALOG_SHARED,
    load: async () => {
      const [rows, total] = await repo.paginateActiveCourses({
        where: { isPopular: opts.isPopular, search: opts.search, categoryId: opts.categoryId },
        orderBy: { field: sortField, dir },
        skip,
        take: limit,
      });
      const courseIds = rows.map((r) => r.id);
      const plans = courseIds.length ? await listActivePricesByCourses(courseIds) : [];
      return { rows, total, plans };
    },
  });

  const courseIds = rows.map((r) => r.id);
  const plansByCourse = new Map<string, { withMaterial: PriceDto[]; withoutMaterial: PriceDto[] }>();
  for (const p of plans) {
    const key = p.courseId ?? "";
    if (!key) continue;
    let bucket = plansByCourse.get(key);
    if (!bucket) {
      bucket = { withMaterial: [], withoutMaterial: [] };
      plansByCourse.set(key, bucket);
    }
    (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
  }

  const now = new Date();
  const endAtByCourse = new Map<string, Date | null>();
  const lifetimeByCourse = new Set<string>();
  if (opts.customerId && courseIds.length) {
    const planIds = plans.map((p) => Number(p._id)).filter((n) => Number.isInteger(n));
    const planToCourse = new Map<string, string>();
    for (const p of plans) if (p.courseId) planToCourse.set(p._id, p.courseId);

    const subs = await listActiveForCoursesOrPlans(opts.customerId, courseIds, planIds, now);
    const upsert = (cid: string, endAt: Date | null) => {
      if (endAt === null) {
        lifetimeByCourse.add(cid);
        endAtByCourse.set(cid, null);
        return;
      }
      if (lifetimeByCourse.has(cid)) return;
      const prev = endAtByCourse.get(cid);
      if (prev == null && !endAtByCourse.has(cid)) endAtByCourse.set(cid, endAt);
      else if (prev && endAt.getTime() > prev.getTime()) endAtByCourse.set(cid, endAt);
    };
    for (const s of subs) {
      const endAt = s.endAt ?? null;
      if (s.courseId) upsert(String(s.courseId), endAt);
      if (s.planId != null) {
        const viaPlan = planToCourse.get(String(s.planId));
        if (viaPlan) upsert(viaPlan, endAt);
      }
    }
  }

  const data: CourseListItemDto[] = rows.map((row) => {
    const cid = String(row.id);
    const isPurchased = endAtByCourse.has(cid);
    const endAt = lifetimeByCourse.has(cid) ? null : endAtByCourse.get(cid) ?? null;
    const buckets = plansByCourse.get(cid) ?? { withMaterial: [], withoutMaterial: [] };
    return toCourseListItemDto(row, {
      plans: buckets,
      isPurchased,
      daysLeft: isPurchased ? computeDaysLeft(endAt, now) : null,
    });
  });

  return {
    data,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};
