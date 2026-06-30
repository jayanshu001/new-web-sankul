/**
 * Global search — SQL branch for GET /client/search. Gated behind
 * `isMysqlModule("client-search")`. Searches 5 entity types (courses, packages,
 * liveCourses, books, ebooks) by name + enabled flag, attaches isPaid / plans /
 * isNew / per-customer purchase state — mirroring search.controller exactly.
 *
 * Field drift handled: Package uses `active` (not status); Course isPaid =
 * purchase≠'0'; LiveCourse/Book/Ebook per their own flags (Book paid =
 * discounted_price>0; Ebook isPaid via price>0 fallback). Subscriptions:
 * ws_package_course_subscription has no payment_status col → status=true.
 */
import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import { isNewItem } from "../../utils/isNew";

export const CLIENT_SEARCH_MODULE = "client-search";
export const isClientSearchMysql = (): boolean => true;

export type SearchType = "courses" | "packages" | "liveCourses" | "books" | "ebooks";
export const SEARCH_TYPES: SearchType[] = ["courses", "packages", "liveCourses", "books", "ebooks"];

const parseId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── per-type fetch (name search + enabled flag) ──────────────────────────────
const fetchType = async (type: SearchType, q: string, skip: number, take: number) => {
  const name = (q || "").trim();
  const contains = name ? { contains: name } : undefined;
  switch (type) {
    case "courses": {
      const where: any = { status: true, ...(contains ? { name: contains } : {}) };
      const [rows, total] = await Promise.all([
        prisma.course.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
        prisma.course.count({ where }),
      ]);
      return { rows, total };
    }
    case "packages": {
      const where: any = { active: true, ...(contains ? { name: contains } : {}) };
      const [rows, total] = await Promise.all([
        prisma.package.findMany({ where, orderBy: { created_at: "desc" }, skip, take }),
        prisma.package.count({ where }),
      ]);
      return { rows, total };
    }
    case "liveCourses": {
      const where: any = { status: true, ...(contains ? { name: contains } : {}) };
      const [rows, total] = await Promise.all([
        prisma.liveCourse.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
        prisma.liveCourse.count({ where }),
      ]);
      return { rows, total };
    }
    case "books": {
      const where: any = { active: true, ...(contains ? { name: contains } : {}) };
      const [rows, total] = await Promise.all([
        prisma.book.findMany({ where, orderBy: { created_at: "desc" }, skip, take }),
        prisma.book.count({ where }),
      ]);
      return { rows, total };
    }
    case "ebooks": {
      const where: any = { active: true, ...(contains ? { name: contains } : {}) };
      const [rows, total] = await Promise.all([
        prisma.eBook.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
        prisma.eBook.count({ where }),
      ]);
      return { rows, total };
    }
  }
};

// ── isPaid per type ──────────────────────────────────────────────────────────
const isPaidMap = async (type: SearchType, rows: any[]): Promise<Map<number, boolean>> => {
  const m = new Map<number, boolean>();
  if (type === "courses") for (const r of rows) m.set(r.id, r.purchase != null ? r.purchase !== "0" : true);
  else if (type === "packages") for (const r of rows) m.set(r.id, true);
  else if (type === "liveCourses") for (const r of rows) m.set(r.id, r.isPaid ?? true);
  else if (type === "books") for (const r of rows) m.set(r.id, (r.discounted_price ?? 0) > 0);
  else if (type === "ebooks") {
    // No isPaid col on ws_ebook → price>0 fallback (active price plan).
    const ids = rows.map((r) => r.id);
    const paid = new Set<number>();
    if (ids.length) {
      const prices = await prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ids }, status: true }, select: { ebookId: true, price: true } });
      for (const p of prices) if ((Number(p.price) || 0) > 0 && p.ebookId != null) paid.add(p.ebookId);
    }
    for (const r of rows) m.set(r.id, paid.has(r.id));
  }
  return m;
};

// ── plans per type (same shape the catalog endpoints use) ────────────────────
const plansMap = async (type: SearchType, rows: any[]): Promise<Map<number, any>> => {
  const out = new Map<number, any>();
  const ids = rows.map((r) => r.id);
  if (!ids.length) return out;
  if (type === "courses" || type === "packages") {
    const where = type === "courses" ? { courseId: { in: ids }, status: true } : { packageId: { in: ids }, status: true };
    const plans = await prisma.packageCourseEbookPrice.findMany({ where, orderBy: { duration: "asc" } });
    for (const r of rows) out.set(r.id, { withMaterial: [], withoutMaterial: [] });
    for (const p of plans as any[]) {
      const key = type === "courses" ? p.courseId : p.packageId;
      const bucket = out.get(key); if (!bucket) continue;
      (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
    }
  } else if (type === "liveCourses") {
    const plans = await prisma.liveCoursePlan.findMany({ where: { liveCourseId: { in: ids }, status: true }, orderBy: { price: "asc" } });
    for (const r of rows) out.set(r.id, []);
    for (const p of plans as any[]) out.get(p.liveCourseId)?.push(p);
  } else if (type === "ebooks") {
    const plans = await prisma.packageCourseEbookPrice.findMany({ where: { ebookId: { in: ids }, status: true }, orderBy: { duration: "asc" } });
    for (const r of rows) out.set(r.id, []);
    for (const p of plans as any[]) out.get(p.ebookId)?.push(p);
  } else {
    for (const r of rows) out.set(r.id, []); // books: price inline
  }
  return out;
};

// ── purchase state per type ──────────────────────────────────────────────────
const attachPurchaseState = async (type: SearchType, rows: any[], customerId: number | null) => {
  const now = new Date();
  const [paidBy, plansBy] = await Promise.all([isPaidMap(type, rows), plansMap(type, rows)]);
  const base = rows.map((r) => ({
    ...r, _id: String(r.id),
    isPaid: paidBy.get(r.id) ?? true,
    isNew: isNewItem(r.createdAt ?? r.created_at ?? null, now),
    plans: plansBy.get(r.id) ?? (type === "courses" || type === "packages" ? { withMaterial: [], withoutMaterial: [] } : []),
  }));
  if (!customerId || !base.length) return base.map((it) => ({ ...it, isPurchased: false, daysLeft: null }));

  const ids = rows.map((r) => r.id);

  if (type === "books") {
    const orders = await prisma.bookOrder.findMany({ where: { userId: customerId, status: { in: ["verified", "shipped", "delivered"] } }, select: { id: true } });
    const orderIds = orders.map((o) => String(o.id)); // ws_book_order_item.order_id is a string
    const owned = new Set<number>();
    if (orderIds.length) {
      const items = await prisma.bookOrderItem.findMany({ where: { order_id: { in: orderIds }, bookId: { in: ids } }, select: { bookId: true } });
      for (const it of items) if (it.bookId != null) owned.add(it.bookId);
    }
    return base.map((it) => ({ ...it, isPurchased: owned.has(it.id), daysLeft: null }));
  }

  if (type === "ebooks") {
    const subs = await prisma.eBookSubscription.findMany({ where: { customerId, ebookId: { in: ids }, status: true, endAt: { gt: now } }, select: { ebookId: true, endAt: true }, orderBy: { endAt: "desc" } });
    const latest = new Map<number, Date>();
    for (const s of subs) if (s.ebookId != null && !latest.has(s.ebookId)) latest.set(s.ebookId, s.endAt!);
    return base.map((it) => { const e = latest.get(it.id) ?? null; return { ...it, isPurchased: !!e, daysLeft: e ? computeDaysLeft(e, now) : null }; });
  }

  if (type === "liveCourses") {
    const subs = await prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: ids }, status: true, paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gt: now } }] }, select: { liveCourseId: true, endAt: true } });
    const life = new Set<number>(); const latest = new Map<number, Date>();
    for (const s of subs) { const e = s.endAt ?? null; if (e === null) { life.add(s.liveCourseId); continue; } if (life.has(s.liveCourseId)) continue; const prev = latest.get(s.liveCourseId); if (!prev || e > prev) latest.set(s.liveCourseId, e); }
    return base.map((it) => { if (life.has(it.id)) return { ...it, isPurchased: true, daysLeft: null }; const e = latest.get(it.id); return { ...it, isPurchased: !!e, daysLeft: e ? computeDaysLeft(e, now) : null }; });
  }

  // courses / packages — sub via direct id OR via a plan (packageId) whose course/package matches
  const isCourse = type === "courses";
  const planRows = await prisma.packageCourseEbookPrice.findMany({ where: isCourse ? { courseId: { in: ids } } : { packageId: { in: ids } }, select: { id: true, courseId: true, packageId: true } });
  const planToOwner = new Map<number, number>();
  for (const p of planRows) { const owner = isCourse ? p.courseId : p.packageId; if (owner != null) planToOwner.set(p.id, owner); }
  const planIds = planRows.map((p) => p.id);

  const subs = await prisma.packageCourseSubscription.findMany({
    where: {
      customerId, status: true,
      AND: [
        { OR: [{ endAt: null }, { endAt: { gt: now } }] },
        { OR: [ isCourse ? { courseId: { in: ids } } : { packageId: { in: ids } }, ...(planIds.length ? [{ packageId: { in: planIds } }] : []) ] },
      ],
    },
    select: { courseId: true, packageId: true, endAt: true },
  });
  const life = new Set<number>(); const latest = new Map<number, Date>();
  const upsert = (k: number | null, e: Date | null) => { if (k == null) return; if (e === null) { life.add(k); return; } if (life.has(k)) return; const prev = latest.get(k); if (!prev || e > prev) latest.set(k, e); };
  for (const s of subs) {
    const e = s.endAt ?? null;
    if (isCourse) { upsert(s.courseId, e); const via = s.packageId != null ? planToOwner.get(s.packageId) : null; if (via != null) upsert(via, e); }
    else { upsert(s.packageId, e); /* package: packageId column IS the package; plan-derived owner also packageId */ const via = s.packageId != null ? planToOwner.get(s.packageId) : null; if (via != null) upsert(via, e); }
  }
  return base.map((it) => { if (life.has(it.id)) return { ...it, isPurchased: true, daysLeft: null }; const e = latest.get(it.id); return { ...it, isPurchased: !!e, daysLeft: e ? computeDaysLeft(e, now) : null }; });
};

// ── public API ────────────────────────────────────────────────────────────────
export const searchType = async (type: SearchType, q: string, customerId: number | null, skip: number, take: number) => {
  const { rows, total } = await fetchType(type, q, skip, take);
  const items = await attachPurchaseState(type, rows, customerId);
  return { items, total };
};
