/**
 * Client exam-countdown LISTINGS — SQL branch (gated behind
 * `isMysqlModule("exam-countdown")`). Backs four controller handlers in
 * src/client/categories/categories.controller.ts:
 *   - GET /client/exam-countdown-categories/:id/packages
 *   - GET /client/exam-countdown/:id/packages          (packages + live courses)
 *   - GET /client/exam-countdown-categories/:id/books-ebooks
 *   - GET /client/exam-countdown/:id/books-ebooks
 *
 * Membership is by the JSON int-array columns added 2026-06-25:
 *   ws_package / ws_live_course / ws_book / ws_ebook .exam_countdown_category_ids
 *   and .exam_countdown_ids  (matched via JSON_CONTAINS).
 *
 * Entitlement reuses the same building blocks as the live listings: book
 * ownership via book-order, ebook ownership via ws_ebook_subscription, package /
 * live ownership via the subscription tables. Shapes mirror the Mongo handlers'
 * isPaid / isPurchased / daysLeft contract; ids restringified to Mongo form.
 */
import { prisma } from "../../config/prisma";
import { getPurchasedBookIdSet } from "../book-order/book-order.service";
import { buildLikeTokens } from "../../utils/searchFilter";

const idStr = (v: number | null | undefined): string | null => (v != null ? String(v) : null);
const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

// ── id-membership lookups (JSON_CONTAINS on the countdown columns) ─────────────
// Returns the matching row ids (status-active) for a table, honoring an optional
// name search. skip/take are caller-controlled ints, inlined safely.
const matchingIds = async (
  table: string,
  jsonCol: string,
  id: number,
  search: string | null,
  // Ordering column differs per table: ws_package/ws_book/ws_ebook use
  // `order_by`, but ws_live_course uses `ordered` (it has no `order_by` column).
  // Caller-supplied fixed identifier (never user input) — safe to inline.
  orderCol: string = "order_by"
): Promise<number[]> => {
  const nameSearch = buildLikeTokens(search, ["name"]);
  const sql =
    `SELECT id FROM ${table} WHERE status = 1 ` +
    `AND JSON_CONTAINS(${jsonCol}, CAST(? AS JSON))` +
    (nameSearch ? ` AND ${nameSearch.sql}` : ``) +
    ` ORDER BY ${orderCol} ASC, created_at ASC`;
  const params: any[] = nameSearch ? [id, ...nameSearch.params] : [id];
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(sql, ...params);
  return rows.map((r) => Number(r.id));
};

// ── package DTO + plans + subscriber count ────────────────────────────────────
const packageDto = (p: any, plans: any[], subCount: number) => {
  const mine = plans.filter((pl) => pl.packageId === p.id);
  const planDto = (pl: any) => ({
    _id: String(pl.id),
    packageId: idStr(pl.packageId),
    name: pl.name ?? null,
    duration: pl.duration,
    price: pl.price,
    withMaterial: pl.withMaterial,
    materialPrice: pl.materialPrice ?? 0,
    isDefault: pl.isDefault,
  });
  return {
    _id: String(p.id),
    name: p.name,
    description: p.description,
    image: p.image ?? null,
    shareableLink: p.shareable_link ?? null,
    order: p.order_by,
    isPaid: p.isPaid,
    withMaterialText: p.withMaterial,
    withoutMaterialText: p.withoutMaterial,
    packageTypeId: idStr(p.packageTypeId),
    goalId: idStr(p.goalId),
    educatorId: idStr(p.educator_id),
    plans: {
      withMaterial: mine.filter((pl) => pl.withMaterial).map(planDto),
      withoutMaterial: mine.filter((pl) => !pl.withMaterial).map(planDto),
    },
    subscriberCount: subCount,
  };
};

const loadPackages = async (ids: number[]) => {
  if (!ids.length) return [];
  const [packages, plans, subAgg] = await Promise.all([
    prisma.package.findMany({ where: { id: { in: ids } } }),
    prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: ids }, status: true }, orderBy: { duration: "asc" } }),
    prisma.packageCourseSubscription.groupBy({ by: ["packageId"], where: { packageId: { in: ids }, status: true }, _count: { _all: true } }),
  ]);
  const subByPkg = new Map<number, number>();
  for (const r of subAgg as any[]) if (r.packageId != null) subByPkg.set(r.packageId, r._count._all);
  const byId = new Map(packages.map((p) => [p.id, p]));
  // preserve the matchingIds order (order_by asc)
  return ids.map((id) => byId.get(id)).filter(Boolean).map((p: any) => packageDto(p, plans, subByPkg.get(p.id) ?? 0));
};

// ── live-course DTO + plans + subscriber count + ownership ─────────────────────
const liveDto = (c: any, plans: any[], subCount: number, endAt: Date | null, now: Date) => ({
  _id: String(c.id),
  name: c.name,
  description: c.description ?? null,
  image: c.image ?? null,
  shareableLink: c.shareableLink ?? null,
  ordered: c.ordered,
  isPaid: c.isPaid,
  isPopular: c.isPopular,
  classType: c.classType,
  withMaterial: c.withMaterial ?? null,
  withoutMaterial: c.withoutMaterial ?? null,
  courseEducatorId: idStr(c.educatorId),
  plans: plans
    .filter((pl) => pl.liveCourseId === c.id)
    .map((pl) => ({ _id: String(pl.id), liveCourseId: idStr(pl.liveCourseId), name: pl.name ?? null, duration: pl.duration, price: pl.price, isDefault: pl.isDefault })),
  subscriberCount: subCount,
  isPurchased: !!endAt,
  daysLeft: endAt ? daysBetween(now, endAt) : null,
});

const loadLiveCourses = async (ids: number[], customerId: number | null) => {
  if (!ids.length) return [];
  const now = new Date();
  const [courses, plans, subAgg, ownedSubs] = await Promise.all([
    prisma.liveCourse.findMany({ where: { id: { in: ids } } }),
    prisma.liveCoursePlan.findMany({ where: { liveCourseId: { in: ids }, status: true }, orderBy: { price: "asc" } }),
    prisma.liveCourseSubscription.groupBy({ by: ["liveCourseId"], where: { liveCourseId: { in: ids }, status: true, paymentStatus: "verified" }, _count: { _all: true } }),
    customerId
      ? prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: ids }, status: true, paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gt: now } }] }, select: { liveCourseId: true, endAt: true } })
      : Promise.resolve([] as any[]),
  ]);
  const subByCourse = new Map<number, number>();
  for (const r of subAgg as any[]) if (r.liveCourseId != null) subByCourse.set(r.liveCourseId, r._count._all);
  // longest-lived active sub per course (null endAt = lifetime, wins)
  const endByCourse = new Map<number, Date | null>();
  for (const s of ownedSubs as any[]) {
    if (s.liveCourseId == null) continue;
    if (!endByCourse.has(s.liveCourseId)) { endByCourse.set(s.liveCourseId, s.endAt ?? null); continue; }
    const prev = endByCourse.get(s.liveCourseId)!;
    if (prev !== null && (s.endAt === null || s.endAt > prev)) endByCourse.set(s.liveCourseId, s.endAt ?? null);
  }
  const byId = new Map(courses.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((c: any) => {
    const endAt = endByCourse.has(c.id) ? endByCourse.get(c.id)! : null;
    return liveDto(c, plans, subByCourse.get(c.id) ?? 0, endByCourse.has(c.id) ? endAt : null, now);
  });
};

// ── book + ebook DTOs (merged listing) ────────────────────────────────────────
const bookDto = (b: any, ownedBookIds: Set<string>) => ({
  _id: String(b.id),
  type: "book" as const,
  name: b.name,
  author: b.author ?? null,
  image: b.image ?? null,
  thumbnail: b.thumbnail ?? null,
  language: b.language ?? null,
  // FE renders a strike-through original price → needs listPrice alongside the
  // discounted one (same column the trending book card reads). FE↔BE mismatch fix.
  listPrice: b.list_price ?? b.listPrice ?? null,
  discountedPrice: b.discounted_price ?? null,
  isCombo: b.isCombo,
  isTrending: b.isTrending,
  order: b.order_by ?? null,
  createdAt: b.created_at ?? null,
  isPaid: true,
  isPurchased: ownedBookIds.has(String(b.id)),
  daysLeft: null as number | null,
});

const ebookDto = (e: any, plans: any[], endAt: Date | null, now: Date) => {
  const ePlans = plans.filter((pl) => pl.ebookId === e.id);
  const isPaid = ePlans.some((pl) => (pl.price ?? 0) > 0);
  return {
    _id: String(e.id),
    type: "ebook" as const,
    name: e.name,
    image: e.image ?? null,
    thumbnail: e.thumbnail ?? null,
    language: e.language ?? null,
    order: e.orderby ?? null,
    createdAt: e.createdAt ?? null,
    plans: ePlans.map((pl) => ({ _id: String(pl.id), ebookId: idStr(pl.ebookId), name: pl.name ?? null, duration: pl.duration, price: pl.price, isDefault: pl.isDefault })),
    isPaid,
    isPurchased: !!endAt,
    subscriptionEndAt: endAt,
    daysLeft: endAt ? daysBetween(now, endAt) : null,
  };
};

const loadBooksAndEbooks = async (bookIds: number[], ebookIds: number[], customerId: number | null) => {
  const now = new Date();
  const [books, ebooks, ebookPlans, ebookSubs, ownedBookIds] = await Promise.all([
    bookIds.length ? prisma.book.findMany({ where: { id: { in: bookIds } } }) : Promise.resolve([] as any[]),
    ebookIds.length ? prisma.eBook.findMany({ where: { id: { in: ebookIds } } }) : Promise.resolve([] as any[]),
    ebookIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ebookIds }, status: true }, orderBy: { duration: "asc" } }) : Promise.resolve([] as any[]),
    customerId && ebookIds.length
      ? prisma.eBookSubscription.findMany({ where: { customerId, ebookId: { in: ebookIds }, status: true, OR: [{ endAt: null }, { endAt: { gt: now } }] }, select: { ebookId: true, endAt: true } })
      : Promise.resolve([] as any[]),
    customerId ? getPurchasedBookIdSet(customerId) : Promise.resolve(new Set<string>()),
  ]);
  const endByEbook = new Map<number, Date | null>();
  for (const s of ebookSubs as any[]) {
    if (s.ebookId == null) continue;
    if (!endByEbook.has(s.ebookId)) { endByEbook.set(s.ebookId, s.endAt ?? null); continue; }
    const prev = endByEbook.get(s.ebookId)!;
    if (prev !== null && (s.endAt === null || s.endAt > prev)) endByEbook.set(s.ebookId, s.endAt ?? null);
  }
  const booksShaped = books.map((b) => bookDto(b, ownedBookIds));
  const ebooksShaped = ebooks.map((e) => ebookDto(e, ebookPlans, endByEbook.has(e.id) ? endByEbook.get(e.id)! : null, now));
  return [...booksShaped, ...ebooksShaped].sort(
    (a, b) => new Date((b as any).createdAt ?? 0).getTime() - new Date((a as any).createdAt ?? 0).getTime()
  );
};

// ── handler-facing functions ──────────────────────────────────────────────────
const page = <T>(arr: T[], skip: number, take: number) => ({ list: arr.slice(skip, skip + take), total: arr.length });

const findCategory = (id: number) => prisma.examCountdownCategory.findUnique({ where: { id } });
const catDto = (c: any) => ({ _id: String(c.id), name: c.name, colorHex: c.colorHex, order: c.order, status: c.status, createdAt: c.createdAt ?? null, updatedAt: c.updatedAt ?? null });
// ExamCountdown has no `category` relation (just categoryId) → resolve the
// category row separately and attach it in the populated {_id,name,colorHex} shape.
const findCountdown = async (id: number) => {
  const e = await prisma.examCountdown.findUnique({ where: { id } });
  if (!e) return null;
  const category = e.categoryId != null
    ? await prisma.examCountdownCategory.findUnique({ where: { id: e.categoryId }, select: { id: true, name: true, colorHex: true } })
    : null;
  return { ...e, category };
};
const countdownDto = (e: any) => ({ _id: String(e.id), title: e.title, categoryId: e.category ? { _id: String(e.category.id), name: e.category.name, colorHex: e.category.colorHex } : null, examDate: e.examDate, status: e.status, createdAt: e.createdAt ?? null, updatedAt: e.updatedAt ?? null });

/** GET /client/exam-countdown-categories/:id/packages */
export const listPackagesByCountdownCategory = async (
  categoryId: number,
  _customerId: number | null,
  opts: { skip: number; take: number; search?: string | null }
) => {
  const category = await findCategory(categoryId);
  if (!category) return null;
  const ids = await matchingIds("ws_package", "exam_countdown_category_ids", categoryId, opts.search ?? null);
  const all = await loadPackages(ids);
  const { list, total } = page(all, opts.skip, opts.take);
  return { category: catDto(category), list, total };
};

/** GET /client/exam-countdown/:id/packages — packages + live courses, tagged. */
export const listProductsByCountdown = async (
  countdownId: number,
  customerId: number | null,
  opts: { skip: number; take: number; search?: string | null }
) => {
  const examCountdown = await findCountdown(countdownId);
  if (!examCountdown) return null;
  const [pkgIds, liveIds] = await Promise.all([
    matchingIds("ws_package", "exam_countdown_ids", countdownId, opts.search ?? null),
    matchingIds("ws_live_course", "exam_countdown_ids", countdownId, opts.search ?? null, "ordered"),
  ]);
  const [packages, live] = await Promise.all([loadPackages(pkgIds), loadLiveCourses(liveIds, customerId)]);
  const merged = [
    ...packages.map((p) => ({ ...p, type: "package" as const })),
    ...live.map((c) => ({ ...c, type: "live-course" as const })),
  ];
  const { list, total } = page(merged, opts.skip, opts.take);
  return { examCountdown: countdownDto(examCountdown), list, total };
};

/** GET /client/exam-countdown-categories/:id/books-ebooks */
export const listBooksEbooksByCountdownCategory = async (
  categoryId: number,
  customerId: number | null,
  opts: { skip: number; take: number; search?: string | null }
) => {
  const category = await findCategory(categoryId);
  if (!category) return null;
  const [bookIds, ebookIds] = await Promise.all([
    matchingIds("ws_book", "exam_countdown_category_ids", categoryId, opts.search ?? null),
    matchingIds("ws_ebook", "exam_countdown_category_ids", categoryId, opts.search ?? null),
  ]);
  const merged = await loadBooksAndEbooks(bookIds, ebookIds, customerId);
  const { list, total } = page(merged, opts.skip, opts.take);
  return { category: catDto(category), list, total };
};

/** GET /client/exam-countdown/:id/books-ebooks */
export const listBooksEbooksByCountdown = async (
  countdownId: number,
  customerId: number | null,
  opts: { skip: number; take: number; search?: string | null }
) => {
  const examCountdown = await findCountdown(countdownId);
  if (!examCountdown) return null;
  const [bookIds, ebookIds] = await Promise.all([
    matchingIds("ws_book", "exam_countdown_ids", countdownId, opts.search ?? null),
    matchingIds("ws_ebook", "exam_countdown_ids", countdownId, opts.search ?? null),
  ]);
  const merged = await loadBooksAndEbooks(bookIds, ebookIds, customerId);
  const { list, total } = page(merged, opts.skip, opts.take);
  return { examCountdown: countdownDto(examCountdown), list, total };
};
