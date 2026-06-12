/**
 * Catalog · Course service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Gated behind `isMysqlModule("catalog-course")` — currently **flag OFF**.
 *
 * Built dual-path but NOT enabled: like package, every client course LISTING
 * endpoint joins commerce-wave tables (PackageCourseEbookPrice plans,
 * PackageCourseSubscription ownership) and embeds Mongo-only category groups, so
 * the full `/client/courses` contract cannot be reproduced from `ws_course`
 * alone this wave. And the subject-category / course id-space is int (MySQL) vs
 * ObjectId (Mongo) — flipping any single course read while its still-Mongo
 * consumers join those ids would split the id space → broken FE. So
 * `catalog-course` flips WITH the commerce/dashboard wave (D3, mirrors package).
 * See docs/migration/CATALOG_MODULE_SCOPE.md.
 */
import { isMysqlModule } from "../../config/migration";
import { computeDaysLeft } from "../../utils/planDuration";
import { catalogCourseRepository as repo } from "./catalog-course.repository";
import { listActivePricesByCourses } from "../commerce-price/commerce-price.service";
import { listActiveForCoursesOrPlans } from "../commerce-subscription/commerce-subscription.service";
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

export const COURSE_MODULE = "catalog-course";
export const isCourseMysql = (): boolean => isMysqlModule(COURSE_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseCourseId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── subject categories ──────────────────────────────────────────────────────

/**
 * Active subject categories each with their active-course count — matches the
 * Mongo `listCourseCategories` contract (`{...category, courseCount}`).
 */
export const listCourseCategoriesWithCounts = async (): Promise<
  CourseSubjectCategoryWithCountDto[]
> => {
  const categories = await repo.listActiveCategories();
  if (categories.length === 0) return [];

  const counts = await repo.countActiveCoursesByCategory(categories.map((c) => c.id));
  const countById = new Map<number, number>();
  for (const row of counts) {
    if (row.courseSubjectCategoryId != null) {
      countById.set(row.courseSubjectCategoryId, row._count._all);
    }
  }
  return categories.map((c) => toCourseCategoryWithCountDto(c, countById.get(c.id) ?? 0));
};

// ── courses ─────────────────────────────────────────────────────────────────

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

// ── composed course listing (catalog-course + commerce-price + -subscription) ─

const SORT_FIELD: Record<NonNullable<ListCoursesOptions["sortBy"]>, "createdAt" | "ordered" | "name"> = {
  createdAt: "createdAt",
  ordered: "ordered",
  name: "name",
};

/**
 * The MySQL equivalent of the Mongo `paginateCoursesWithPlans`: paginated active
 * courses, each enriched with its active plans (split by material) and the
 * per-customer purchase state (isPurchased + daysLeft). Spans three migrated
 * modules — catalog-course (rows), commerce-price (plans), commerce-subscription
 * (ownership). Response shape mirrors the Mongo handler exactly.
 *
 * `daysLeft` rule (identical to Mongo): the longest-lived active sub for the
 * course wins; a lifetime grant (endAt null) beats any dated sub. A sub matches
 * a course directly (`courseId`) or via one of the course's plans (`planId`).
 */
export const listCoursesWithPlans = async (
  opts: ListCoursesOptions = {}
): Promise<PaginatedCourses> => {
  const page = Math.max(opts.page ?? 1, 1);
  const limit = Math.max(opts.limit ?? 10, 1);
  const skip = (page - 1) * limit;
  const sortField = SORT_FIELD[opts.sortBy ?? "createdAt"];
  const dir = opts.sortOrder === "asc" ? "asc" : "desc";

  const [rows, total] = await repo.paginateActiveCourses({
    where: { isPopular: opts.isPopular, search: opts.search, categoryId: opts.categoryId },
    orderBy: { field: sortField, dir },
    skip,
    take: limit,
  });

  const courseIds = rows.map((r) => r.id);

  // Active plans for the page's courses, bucketed by course then by material.
  const plans = courseIds.length ? await listActivePricesByCourses(courseIds) : [];
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

  // Per-course endAt / lifetime from the customer's active subs (course OR plan).
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
