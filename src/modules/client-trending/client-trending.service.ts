/**
 * Client trending books/ebooks + free-category resolution — SQL branch for the
 * dashboard widgets and free dashboard. Gated behind `isMysqlModule("client-trending")`.
 *
 * Books: ws_book where is_trending=1 (+ language/search), paid = discounted_price>0.
 * Ebooks: ws_ebook where is_trending=1; price/free via ws_package_course_ebook_price
 * (ebookId; min plan price; free = min==0).
 * resolveFreeCategoryIds: free packages/courses → material/exam/video category ids
 * via the *_category_(course|package) pivots + PackageSpecificSubject + the
 * PackageVideoCategoryRelation→VideoCategoryRelation tree. ⚠ ws_package has no
 * isPaid col → no free packages on SQL (free-package branch yields none); Course
 * free = purchase='0'. (Documented catalog drift.)
 */
import { prisma } from "../../config/prisma";
import { isNewItem } from "../../utils/isNew";

export const isClientTrendingMysql = (): boolean => true;

type TrendingOpts = { type?: string; search?: string; language?: string; limit?: number; skip?: number };
const flags = (o: TrendingOpts) => ({
  wantFree: o.type === "free",
  wantPaid: o.type === "paid" || !o.type,
  limitNum: Math.min(Math.max(o.limit ?? 20, 1), 100),
});

export const fetchTrendingBooksOnly = async (opts: TrendingOpts = {}) => {
  const { wantFree, wantPaid, limitNum } = flags(opts);
  const skip = Math.max(opts.skip ?? 0, 0);
  const where: any = { active: true, isTrending: true };
  if (opts.language) where.language = opts.language;
  if (opts.search) where.OR = [{ name: { contains: opts.search } }, { author: { contains: opts.search } }];
  if (wantFree) where.discounted_price = 0;
  else if (wantPaid) where.discounted_price = { gt: 0 };

  // findMany + count over the IDENTICAL where — total drives the pagination envelope.
  const [books, total] = await Promise.all([
    prisma.book.findMany({ where, orderBy: [{ order_by: "asc" }, { created_at: "desc" }], skip, take: limitNum }),
    prisma.book.count({ where }),
  ]);
  const items = books.map((b: any) => ({
    type: "book" as const, _id: String(b.id), name: b.name, description: b.description ?? null, author: b.author ?? null,
    language: b.language, image: b.image ?? null, thumbnail: b.thumbnail ?? null, demoUrl: b.demoUrl ?? null,
    isTrending: b.isTrending, isCombo: b.isCombo ?? false, isMagazine: b.isMagazine ?? false,
    listPrice: b.list_price ?? b.listPrice ?? null, discountedPrice: b.discounted_price, shippingPrice: b.shipping_price ?? null,
    pages: b.pages ?? 0, price: b.discounted_price, isFree: b.discounted_price === 0, isNew: isNewItem(b.created_at), createdAt: b.created_at,
  }));
  return { type: wantFree ? "free" : "paid", items, total };
};

export const fetchTrendingEbooksOnly = async (opts: TrendingOpts = {}) => {
  const { wantFree, wantPaid, limitNum } = flags(opts);
  const skip = Math.max(opts.skip ?? 0, 0);
  const where: any = { active: true, isTrending: true };
  if (opts.language) where.language = opts.language;
  if (opts.search) where.OR = [{ name: { contains: opts.search } }, { author: { contains: opts.search } }];

  const ebooks = await prisma.eBook.findMany({ where, orderBy: [{ orderby: "asc" }, { createdAt: "desc" }] });
  const ids = ebooks.map((e) => e.id);
  const plans = ids.length ? await prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ids }, status: true }, orderBy: { duration: "asc" } }) : [];
  const plansByEbook = new Map<number, any[]>();
  for (const p of plans) { if (p.ebookId == null) continue; (plansByEbook.get(p.ebookId) ?? plansByEbook.set(p.ebookId, []).get(p.ebookId)!).push(p); }

  // free/paid is a post-query (in-memory) filter over the plan price, so the
  // total for pagination is the FULL filtered length; window it via skip/take.
  const filtered = ebooks.map((e: any) => {
    const ePlans = plansByEbook.get(e.id) ?? [];
    const minPrice = ePlans.length ? Math.min(...ePlans.map((p) => Number(p.price) || 0)) : 0;
    const isFree = minPrice === 0;
    if (wantFree && !isFree) return null;
    if (wantPaid && isFree) return null;
    return {
      type: "ebook" as const, _id: String(e.id), name: e.name, description: e.description ?? null, author: e.author ?? null,
      publisher: e.publisher ?? null, language: e.language, image: e.image ?? null, thumbnail: e.thumbnail ?? null, demoUrl: e.demoUrl ?? null,
      isTrending: e.isTrending, price: minPrice, isFree, isNew: isNewItem(e.createdAt), plans: ePlans, createdAt: e.createdAt,
    };
  }).filter(Boolean) as any[];
  const total = filtered.length;
  const items = filtered.slice(skip, skip + limitNum);
  return { type: wantFree ? "free" : "paid", items, total };
};

export const resolveFreeCategoryIds = async () => {
  const materialCategoryIds = new Set<number>();
  const examCategoryIds = new Set<number>();
  const videoCategoryIds = new Set<number>();

  // Free courses: purchase='0'. (Free packages: ws_package has no isPaid → none.)
  // CourseFlag01 enum: `no`@map("0") = free, `yes`@map("1") = paid.
  const freeCourses = await prisma.course.findMany({ where: { status: true, purchase: "no" as any }, select: { id: true, videoCategoryId: true } });
  const freeCourseIds = freeCourses.map((c) => c.id);
  for (const c of freeCourses) if (c.videoCategoryId) videoCategoryIds.add(c.videoCategoryId);

  if (freeCourseIds.length) {
    const [matRefs, examRefs] = await Promise.all([
      prisma.materialCategoryCourse.findMany({ where: { courseId: { in: freeCourseIds } }, select: { materialCategoryId: true } }),
      prisma.examCategoryCourse.findMany({ where: { courseId: { in: freeCourseIds } }, select: { examCategoryId: true } }),
    ]);
    for (const r of matRefs) if (r.materialCategoryId != null) materialCategoryIds.add(r.materialCategoryId);
    for (const r of examRefs) if (r.examCategoryId != null) examCategoryIds.add(r.examCategoryId);
  }

  return {
    materialCategoryIds: [...materialCategoryIds],
    examCategoryIds: [...examCategoryIds],
    videoCategoryIds: [...videoCategoryIds],
  };
};

const FREE_LIMIT = 10;
const computeDaysLeft = (endAt: Date, now: Date) => Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / 86_400_000));

/**
 * getFreeDashboard sections on SQL. Free ebooks = min plan price 0 (ws_ebook has
 * no isPaid col); free videos = in a free video-category OR priceType=free.
 */
export const buildFreeDashboard = async (customerId: number | null) => {
  const [trendingFreeBooks, trendingFreeEbooks, freeCats] = await Promise.all([
    fetchTrendingBooksOnly({ type: "free", limit: FREE_LIMIT }),
    fetchTrendingEbooksOnly({ type: "free", limit: FREE_LIMIT }),
    resolveFreeCategoryIds(),
  ]);

  // Free ebooks: those whose min active plan price is 0 (price-derived, since
  // ws_ebook has no isPaid). Reuse the trending-free-ebook items? No — this is
  // the full free-ebook section, not trending-only. Resolve directly.
  const allEbooks = await prisma.eBook.findMany({ where: { active: true }, orderBy: [{ orderby: "asc" }, { createdAt: "desc" }], take: 100 });
  const ebookIds = allEbooks.map((e) => e.id);
  const plans = ebookIds.length ? await prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ebookIds }, status: true }, orderBy: { duration: "asc" } }) : [];
  const plansByEbook = new Map<number, any[]>();
  for (const p of plans) { if (p.ebookId == null) continue; (plansByEbook.get(p.ebookId) ?? plansByEbook.set(p.ebookId, []).get(p.ebookId)!).push(p); }
  const now = new Date();
  let subEndByEbook = new Map<number, Date>();
  if (customerId) {
    const subs = await prisma.eBookSubscription.findMany({ where: { customerId, ebookId: { in: ebookIds }, status: true, endAt: { gt: now } }, select: { ebookId: true, endAt: true } });
    for (const s of subs) { if (s.ebookId == null || s.endAt == null) continue; const prev = subEndByEbook.get(s.ebookId); if (!prev || s.endAt > prev) subEndByEbook.set(s.ebookId, s.endAt); }
  }
  const freeEbookData = allEbooks.filter((e) => {
    const ep = plansByEbook.get(e.id) ?? [];
    const min = ep.length ? Math.min(...ep.map((p) => Number(p.price) || 0)) : 0;
    return min === 0;
  }).slice(0, FREE_LIMIT).map((e: any) => {
    const endAt = subEndByEbook.get(e.id) ?? null;
    return { ...e, _id: String(e.id), plans: plansByEbook.get(e.id) ?? [], isPaid: false, isPurchased: !!endAt, daysLeft: endAt ? computeDaysLeft(endAt, now) : null };
  });

  // Free videos: in a free video-category OR priceType=free.
  const videoWhere: any = { status: true, OR: [{ priceType: "free" as any }] };
  if (freeCats.videoCategoryIds.length) videoWhere.OR.push({ videoCategoryId: { in: freeCats.videoCategoryIds } });
  const freeVideos = (await prisma.video.findMany({ where: videoWhere, orderBy: { order: "asc" }, take: FREE_LIMIT, select: { id: true, title: true, topic: true, priceType: true, videoCategoryId: true, VideoCategory: { select: { id: true, title: true, image: true } } } }))
    .map((v) => ({ _id: String(v.id), title: v.title, topic: v.topic, priceType: v.priceType, videoCategoryId: v.VideoCategory ? { _id: String(v.VideoCategory.id), title: v.VideoCategory.title, image: v.VideoCategory.image } : null }));

  // Every section is always present; empty array as `data` when unavailable so
  // the response shape stays stable for the client.
  const dashboard: Array<{ title: string; type: string; data: unknown }> = [
    { title: "Trending Free Books", type: "trending-book", data: trendingFreeBooks.items.slice(0, FREE_LIMIT) },
    { title: "Trending Free Ebooks", type: "trending-ebook", data: trendingFreeEbooks.items.slice(0, FREE_LIMIT) },
    { title: "Free Ebooks", type: "free-ebook", data: freeEbookData },
    { title: "Free Videos", type: "video", data: freeVideos },
  ];
  return dashboard;
};
