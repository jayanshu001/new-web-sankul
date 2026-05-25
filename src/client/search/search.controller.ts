import { Request, Response } from "express";
import { Model } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Book } from "../../models/book/Book.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";

// Resolves daysLeft for search hits of a single entity type. Books are
// excluded — they're one-off purchases, not time-bound subscriptions.
async function attachDaysLeft(
  type: string,
  items: any[],
  customerId: string | undefined
): Promise<any[]> {
  if (!customerId || !items.length || type === "books") {
    return items.map((it) => ({ ...it, daysLeft: null }));
  }
  const ids = items.map((i: any) => i._id);
  const now = new Date();

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
    return items.map((it: any) => ({
      ...it,
      daysLeft: latest.has(String(it._id)) ? computeDaysLeft(latest.get(String(it._id))!, now) : null,
    }));
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
    return items.map((it: any) => {
      const k = String(it._id);
      if (life.has(k)) return { ...it, daysLeft: null };
      const endAt = latest.get(k);
      return { ...it, daysLeft: endAt ? computeDaysLeft(endAt, now) : null };
    });
  }

  return items.map((it) => ({ ...it, daysLeft: null }));
}

const TYPE_TO_MODEL: Record<string, Model<any>> = {
  courses: Course,
  packages: Package,
  books: Book,
  ebooks: Ebook,
};

// Escape user input so a query like "C++" or "(2024)" doesn't blow up the regex.
function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/v1/client/search?q=&type=courses|packages|books|ebooks&page=&limit=
export const globalSearch = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("globalSearch invoked", { traceId, path: req.originalUrl, userId: req.user?.id, q: req.query.q, type: req.query.type });

  try {
    const { q, type } = req.query as Record<string, string>;
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);

    const filter = {
      status: true,
      name: { $regex: escapeRegex((q || "").trim()), $options: "i" },
    };
    const skip = (page - 1) * limit;

    if (!type || !TYPE_TO_MODEL[type]) {
      const entries = Object.entries(TYPE_TO_MODEL);
      const customerId = req.user?.id;
      const results = await Promise.all(
        entries.map(async ([key, M]) => {
          const [rawItems, total] = await Promise.all([
            M.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            M.countDocuments(filter),
          ]);
          const items = await attachDaysLeft(key, rawItems, customerId);
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

    const [rawItems, total] = await Promise.all([
      M.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      M.countDocuments(filter),
    ]);
    const items = await attachDaysLeft(type, rawItems, req.user?.id);

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
