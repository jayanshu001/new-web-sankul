import { Request, Response } from "express";
import { Model } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { Book } from "../../models/book/Book.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { BookOrderStatus } from "../../models/enums";
import { isNewItem } from "../../utils/isNew";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";

// Derives `isPaid` per entity type using the same rules the dedicated
// catalog endpoints use, so a search hit and its detail page agree:
//   - courses / packages / liveCourses → the model's own `isPaid` flag (default true)
//   - ebooks → admin-controlled `isPaid` field (default true); falls back to
//              the old price-derived rule only when the field is absent
//   - books  → paid when discountedPrice > 0
async function attachIsPaid(type: string, items: any[]): Promise<Map<string, boolean>> {
  const paidByid = new Map<string, boolean>();
  if (type === "ebooks") {
    // The admin `isPaid` field is the source of truth. Only fetch price plans
    // for the (legacy) rows that don't carry the field yet.
    const needPlanFallback = items.filter((i: any) => typeof i.isPaid !== "boolean");
    const hasPaidPlan = new Map<string, boolean>();
    if (needPlanFallback.length) {
      const ids = needPlanFallback.map((i: any) => i._id);
      const plans = await EbookPrice.find({ ebookId: { $in: ids }, status: true })
        .select("ebookId price")
        .lean();
      for (const p of plans as any[]) {
        if ((p.price ?? 0) > 0) hasPaidPlan.set(String(p.ebookId), true);
      }
    }
    for (const it of items) {
      const paid =
        typeof it.isPaid === "boolean" ? it.isPaid : hasPaidPlan.get(String(it._id)) ?? false;
      paidByid.set(String(it._id), paid);
    }
  } else if (type === "books") {
    for (const it of items) paidByid.set(String(it._id), (it.discountedPrice ?? 0) > 0);
  } else {
    // courses / packages / liveCourses carry the flag on the document itself.
    for (const it of items) paidByid.set(String(it._id), it.isPaid ?? true);
  }
  return paidByid;
}

// Returns a map of entityId -> its pricing plans, in the SAME shape the
// dedicated catalog endpoints use so a search hit and its listing/detail agree:
//   - courses / packages → { withMaterial: [], withoutMaterial: [] } (PackageCourseEbookPrice)
//   - liveCourses        → flat plan array (LiveCoursePlan)
//   - ebooks             → flat plan array (EbookPrice)
//   - books              → [] (books carry price inline, no plan collection)
async function attachPlans(type: string, items: any[]): Promise<Map<string, any>> {
  const plansById = new Map<string, any>();
  const ids = items.map((i: any) => i._id);
  if (!ids.length) return plansById;

  if (type === "courses" || type === "packages") {
    const key = type === "courses" ? "courseId" : "packageId";
    const plans = await PackageCourseEbookPrice.find({ [key]: { $in: ids }, status: true })
      .sort({ duration: 1 })
      .lean();
    for (const it of items) plansById.set(String(it._id), { withMaterial: [], withoutMaterial: [] });
    for (const p of plans as any[]) {
      const bucket = plansById.get(String(p[key]));
      if (!bucket) continue;
      (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
    }
  } else if (type === "liveCourses") {
    const plans = await LiveCoursePlan.find({ liveCourseId: { $in: ids }, status: true })
      .sort({ price: 1 })
      .lean();
    for (const it of items) plansById.set(String(it._id), []);
    for (const p of plans as any[]) plansById.get(String(p.liveCourseId))?.push(p);
  } else if (type === "ebooks") {
    const plans = await EbookPrice.find({ ebookId: { $in: ids }, status: true })
      .sort({ duration: 1 })
      .lean();
    for (const it of items) plansById.set(String(it._id), []);
    for (const p of plans as any[]) plansById.get(String(p.ebookId))?.push(p);
  } else {
    // books — price lives inline on the document; no separate plan collection.
    for (const it of items) plansById.set(String(it._id), []);
  }
  return plansById;
}

// Stamps `isPaid`, `plans`, `isPurchased`, and `daysLeft` on search hits of a
// single entity type. Books are one-off purchases (no expiry → daysLeft always
// null), everything else is a time-bound subscription.
async function attachPurchaseState(
  type: string,
  items: any[],
  customerId: string | undefined
): Promise<any[]> {
  const [paidByid, plansById] = await Promise.all([
    attachIsPaid(type, items),
    attachPlans(type, items),
  ]);
  const nowNew = new Date();
  const withPaid = items.map((it: any) => ({
    ...it,
    isPaid: paidByid.get(String(it._id)) ?? true,
    // Derived catalog flag — "new" for NEW_WINDOW_DAYS after creation. Matches
    // the book/ebook listings so a search hit and its listing agree.
    isNew: isNewItem(it.createdAt, nowNew),
    plans: plansById.get(String(it._id)) ?? (type === "courses" || type === "packages" ? { withMaterial: [], withoutMaterial: [] } : []),
  }));

  if (!customerId || !withPaid.length) {
    return withPaid.map((it) => ({ ...it, isPurchased: false, daysLeft: null }));
  }
  const ids = withPaid.map((i: any) => i._id);
  const now = new Date();

  if (type === "books") {
    // Books are permanent once a successful order exists — no expiry window.
    const purchasedIds = await BookOrder.distinct("items.bookId", {
      customerId,
      status: { $in: [BookOrderStatus.VERIFIED, BookOrderStatus.SHIPPED, BookOrderStatus.DELIVERED] },
    });
    const owned = new Set(purchasedIds.map((id: any) => String(id)));
    return withPaid.map((it: any) => ({
      ...it,
      isPurchased: owned.has(String(it._id)),
      daysLeft: null,
    }));
  }

  if (type === "ebooks") {
    const subs = await EbookSubscription.find({
      customerId,
      ebookId: { $in: ids },
      status: true,
      endAt: { $gt: now },
    }).select("ebookId endAt").sort({ endAt: -1 }).lean();
    const latest = new Map<string, Date>();
    for (const s of subs as any[]) {
      const k = String(s.ebookId);
      if (!latest.has(k)) latest.set(k, s.endAt as Date);
    }
    return withPaid.map((it: any) => {
      const endAt = latest.get(String(it._id)) ?? null;
      return {
        ...it,
        isPurchased: !!endAt,
        daysLeft: endAt ? computeDaysLeft(endAt, now) : null,
      };
    });
  }

  if (type === "liveCourses") {
    // Live courses are time-bound subscriptions: an active (or lifetime) row
    // with paymentStatus "verified" = owned. Mirrors /client/live-courses.
    const subs = await LiveCourseSubscription.find({
      customerId,
      liveCourseId: { $in: ids },
      status: true,
      paymentStatus: "verified",
      $or: [{ endAt: null }, { endAt: { $gt: now } }],
    }).select("liveCourseId endAt").lean();
    const life = new Set<string>();
    const latest = new Map<string, Date>();
    for (const s of subs as any[]) {
      const k = String(s.liveCourseId);
      const endAt: Date | null = s.endAt ?? null;
      if (endAt === null) { life.add(k); continue; }
      if (life.has(k)) continue;
      const prev = latest.get(k);
      if (!prev || endAt.getTime() > prev.getTime()) latest.set(k, endAt);
    }
    return withPaid.map((it: any) => {
      const k = String(it._id);
      if (life.has(k)) return { ...it, isPurchased: true, daysLeft: null };
      const endAt = latest.get(k);
      return { ...it, isPurchased: !!endAt, daysLeft: endAt ? computeDaysLeft(endAt, now) : null };
    });
  }

  if (type === "courses" || type === "packages") {
    const isCourse = type === "courses";
    const planIds = await PackageCourseEbookPrice.find(
      isCourse ? { courseId: { $in: ids } } : { packageId: { $in: ids } }
    ).select("_id courseId packageId").lean();
    const planToCourse = new Map<string, string>(
      (planIds as any[]).map((p) => [String(p._id), String(p.courseId ?? "")])
    );
    const planToPackage = new Map<string, string>(
      (planIds as any[]).map((p) => [String(p._id), String(p.packageId ?? "")])
    );
    const subs = await PackageCourseSubscription.find({
      customerId,
      paymentStatus: "verified",
      status: true,
      $and: [
        { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
        isCourse
          ? { $or: [{ courseId: { $in: ids } }, { packageId: { $in: (planIds as any[]).map((p) => p._id) } }] }
          : { $or: [{ targetPackageId: { $in: ids } }, { packageId: { $in: (planIds as any[]).map((p) => p._id) } }] },
      ],
    }).select("courseId packageId targetPackageId endAt").lean();

    const life = new Set<string>();
    const latest = new Map<string, Date>();
    const upsert = (key: string, endAt: Date | null) => {
      if (endAt === null) { life.add(key); return; }
      if (life.has(key)) return;
      const prev = latest.get(key);
      if (!prev || endAt.getTime() > prev.getTime()) latest.set(key, endAt);
    };
    for (const s of subs as any[]) {
      const endAt: Date | null = s.endAt ?? null;
      if (isCourse) {
        if (s.courseId) upsert(String(s.courseId), endAt);
        const viaPlan = planToCourse.get(String(s.packageId));
        if (viaPlan) upsert(viaPlan, endAt);
      } else {
        if (s.targetPackageId) upsert(String(s.targetPackageId), endAt);
        const viaPlan = planToPackage.get(String(s.packageId));
        if (viaPlan) upsert(viaPlan, endAt);
      }
    }
    return withPaid.map((it: any) => {
      const k = String(it._id);
      // Lifetime (life) or a future-dated sub (latest) both mean purchased.
      if (life.has(k)) return { ...it, isPurchased: true, daysLeft: null };
      const endAt = latest.get(k);
      return { ...it, isPurchased: !!endAt, daysLeft: endAt ? computeDaysLeft(endAt, now) : null };
    });
  }

  return withPaid.map((it) => ({ ...it, isPurchased: false, daysLeft: null }));
}

const TYPE_TO_MODEL: Record<string, Model<any>> = {
  courses: Course,
  packages: Package,
  liveCourses: LiveCourse,
  books: Book,
  ebooks: Ebook,
};

// The "is this row enabled" flag is NOT uniform across models: Package uses
// `active`, everything else uses `status`. A single { status: true } filter
// silently matched ZERO packages (they have no top-level `status` field), so
// packages never appeared in search. Resolve the right field per type.
const ENABLED_FIELD_BY_TYPE: Record<string, "status" | "active"> = {
  courses: "status",
  packages: "active",
  liveCourses: "status",
  books: "status",
  ebooks: "status",
};

// Escape user input so a query like "C++" or "(2024)" doesn't blow up the regex.
function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Per-type search filter: name regex + the correct enabled flag for that model.
function buildSearchFilter(type: string, q: string) {
  const enabledField = ENABLED_FIELD_BY_TYPE[type] ?? "status";
  return {
    [enabledField]: true,
    name: { $regex: escapeRegex((q || "").trim()), $options: "i" },
  };
}

// GET /api/v1/client/search?q=&type=courses|packages|liveCourses|books|ebooks&page=&limit=
// Omit `type` (or pass an unknown one) to search ALL five entity types at once.
export const globalSearch = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("globalSearch invoked", { traceId, path: req.originalUrl, userId: req.user?.id, q: req.query.q, type: req.query.type });

  try {
    const { q, type } = req.query as Record<string, string>;
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);

    const skip = (page - 1) * limit;

    if (!type || !TYPE_TO_MODEL[type]) {
      const entries = Object.entries(TYPE_TO_MODEL);
      const customerId = req.user?.id;
      const results = await Promise.all(
        entries.map(async ([key, M]) => {
          const filter = buildSearchFilter(key, q);
          const [rawItems, total] = await Promise.all([
            M.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            M.countDocuments(filter),
          ]);
          const items = await attachPurchaseState(key, rawItems, customerId);
          return [key, { items, total, hasMore: skip + items.length < total }] as const;
        })
      );

      const data = Object.fromEntries(results);
      const grandTotal = results.reduce((sum, [, v]) => sum + v.total, 0);

      logger.info("globalSearch success (all)", { traceId, q, total: grandTotal });
      return res.status(200).json({
        success: true,
        data: {
          type: "all",
          page,
          limit,
          total: grandTotal,
          results: data,
        },
      });
    }

    const M = TYPE_TO_MODEL[type];
    const filter = buildSearchFilter(type, q);

    const [rawItems, total] = await Promise.all([
      M.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      M.countDocuments(filter),
    ]);
    const items = await attachPurchaseState(type, rawItems, req.user?.id);

    logger.info("globalSearch success", { traceId, type, q, total, returned: items.length });
    return res.status(200).json({
      success: true,
      data: {
        type,
        items,
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      },
    });
  } catch (error: any) {
    logger.error("globalSearch failed", { traceId, q: req.query.q, type: req.query.type, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
