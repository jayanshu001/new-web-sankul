import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Package } from "../../models/course/Package.model";
import { PackageType } from "../../models/course/PackageType.model";
import { Course } from "../../models/course/Course.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// `type` selects which subscription library to return. Defaults to "course",
// which preserves the original behaviour (course + package together) for
// callers that don't send the param.
//   - course      → course AND package subscriptions, each tagged with its own
//                   `action.kind` ("course" | "package")
//   - test_series → test-series subscriptions
//   - ebook       → ebook subscriptions
const querySchema = z.object({
  type: z.enum(["course", "test_series", "ebook"]).default("course"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Ceiling-divide so a sub ending in 23h59m still reads "1 Day Left", matching
// how the UI phrases it.
const daysLeftOf = (endAt: Date | null, now: Date) =>
  endAt ? Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / MS_PER_DAY)) : null;

// Every type returns this same card envelope so the FE renders one list and
// switches only on `action.kind`.
type Card = {
  _id: any;
  title: string;
  author: string | null;
  thumbnail: string | null;
  badge: string | null;
  daysLeft: number | null;
  startAt: Date | null;
  endAt: Date | null;
  action: {
    kind: "course" | "package" | "test_series" | "ebook";
    courseId: any;
    packageId: any;
    planId: any;
    testSeriesId: any;
    ebookId: any;
  };
  meta: Record<string, any>;
};

const emptyAction = {
  courseId: null,
  packageId: null,
  planId: null,
  testSeriesId: null,
  ebookId: null,
};

// GET /api/v1/client/my-subscriptions?type=course|test_series|ebook
// Drives the "My Subscriptions" library screen — shows only currently-active
// subscriptions (verified payment AND endAt in the future) for the requested
// type. Sorted by endAt ascending so expiring-soonest cards surface first.
export const listMySubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMySubscriptions invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMySubscriptions unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) { logger.warn("listMySubscriptions validation failed", { traceId, customerId: userId, issues: parsed.error.issues }); return res.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid query", errors: parsed.error.issues }); }
    const { type, page: pageNum, limit: limitNum } = parsed.data;
    const skip = (pageNum - 1) * limitNum;

    const now = new Date();
    const cid = new mongoose.Types.ObjectId(userId);

    // Each builder returns the FULL deduped+sorted card list for its type; the
    // shared tail paginates and shapes the response identically.
    let cards: Card[];
    if (type === "test_series") {
      cards = await buildTestSeriesCards(cid, now);
    } else if (type === "ebook") {
      cards = await buildEbookCards(cid, now);
    } else {
      cards = await buildCourseAndPackageCards(cid, now);
    }

    const total = cards.length;
    const data = cards.slice(skip, skip + limitNum);

    logger.info("listMySubscriptions success", { traceId, customerId: userId, type, total, returned: data.length });
    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (e: any) {
    logger.error("listMySubscriptions failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── course + package ────────────────────────────────────────────────────────
// Unchanged behaviour from the original endpoint: active course/package rows,
// deduped to the furthest-out endAt per target, each card carrying its own
// action.kind ("course" | "package").
async function buildCourseAndPackageCards(
  cid: mongoose.Types.ObjectId,
  now: Date
): Promise<Card[]> {
  const filter = {
    customerId: cid,
    paymentStatus: "verified",
    status: true,
    endAt: { $gt: now },
  };

  // Fetch ALL active rows (latest-expiring first) so we can collapse duplicates
  // BEFORE paginating. A customer can end up with more than one active row per
  // course/package target (legacy data, or an extend that landed as a new row);
  // we keep only the furthest-out endAt per target.
  const allActive = await PackageCourseSubscription.find(filter).sort({ endAt: -1 }).lean();

  const seen = new Set<string>();
  const deduped = allActive.filter((s: any) => {
    const key = s.courseId
      ? `c:${String(s.courseId)}`
      : s.targetPackageId
      ? `p:${String(s.targetPackageId)}`
      : `s:${String(s._id)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort to the screen's contract (expiring-soonest first).
  const subs = deduped.sort(
    (a: any, b: any) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime()
  );
  if (subs.length === 0) return [];

  const courseIds = [...new Set(subs.map((s: any) => s.courseId && String(s.courseId)).filter(Boolean) as string[])];
  const priceIds = [...new Set(subs.map((s: any) => s.packageId && String(s.packageId)).filter(Boolean) as string[])];
  const directPackageIds = [
    ...new Set(subs.map((s: any) => s.targetPackageId && String(s.targetPackageId)).filter(Boolean)),
  ] as string[];

  const [courses, prices] = await Promise.all([
    Course.find({ _id: { $in: courseIds } }).select("_id name author thumbnail image").lean(),
    PackageCourseEbookPrice.find({ _id: { $in: priceIds } }).select("_id packageId duration").lean(),
  ]);

  const planPackageIds = prices.map((p: any) => p.packageId && String(p.packageId)).filter(Boolean) as string[];
  const packageIds = [...new Set([...planPackageIds, ...directPackageIds])];
  const packages = packageIds.length
    ? await Package.find({ _id: { $in: packageIds } }).select("_id name image packageTypeId").lean()
    : [];

  const typeIds = [
    ...new Set(packages.map((p: any) => p.packageTypeId && String(p.packageTypeId)).filter(Boolean)),
  ] as string[];
  const types = typeIds.length
    ? await PackageType.find({ _id: { $in: typeIds } }).select("_id name").lean()
    : [];

  const courseById = new Map(courses.map((c: any) => [String(c._id), c]));
  const priceById = new Map(prices.map((p: any) => [String(p._id), p]));
  const packageById = new Map(packages.map((p: any) => [String(p._id), p]));
  const typeById = new Map(types.map((t: any) => [String(t._id), t]));

  return subs.map((s: any): Card => {
    const price: any = priceById.get(String(s.packageId));
    const targetPkgId = s.targetPackageId
      ? String(s.targetPackageId)
      : price?.packageId
      ? String(price.packageId)
      : null;
    const pkg: any = targetPkgId ? packageById.get(targetPkgId) : null;
    const type: any = pkg?.packageTypeId ? typeById.get(String(pkg.packageTypeId)) : null;
    const course: any = s.courseId ? courseById.get(String(s.courseId)) : null;

    const endAt: Date | null = s.endAt ? new Date(s.endAt) : null;

    return {
      _id: s._id,
      title: course?.name || pkg?.name || "Subscription",
      author: course?.author || null,
      thumbnail: course?.thumbnail || course?.image || pkg?.image || null,
      badge: type?.name || null, // e.g. "Live Class" / "Recorded Class" / "Subject Course"
      daysLeft: daysLeftOf(endAt, now),
      startAt: s.startAt,
      endAt: s.endAt,
      action: {
        ...emptyAction,
        kind: s.courseId ? "course" : "package",
        courseId: s.courseId ?? null,
        packageId: s.targetPackageId ?? null,
        planId: s.packageId,
      },
      meta: {
        duration: price?.duration ?? null,
        packageName: pkg?.name ?? null,
      },
    };
  });
}

// ── test series ─────────────────────────────────────────────────────────────
// Test-series subs have no paymentStatus column — the row existing means access
// was granted (verify/free-grant). Active = status:true && endAt > now. Deduped
// to the furthest-out endAt per testSeriesId.
async function buildTestSeriesCards(
  cid: mongoose.Types.ObjectId,
  now: Date
): Promise<Card[]> {
  const allActive = await TestSeriesSubscription.find({
    customerId: cid,
    status: true,
    endAt: { $gt: now },
  })
    .sort({ endAt: -1 })
    .lean();

  const seen = new Set<string>();
  const deduped = allActive.filter((s: any) => {
    const key = `t:${String(s.testSeriesId)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const subs = deduped.sort(
    (a: any, b: any) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime()
  );
  if (subs.length === 0) return [];

  const tsIds = [...new Set(subs.map((s: any) => String(s.testSeriesId)))];
  const seriesDocs = await TestSeries.find({ _id: { $in: tsIds } })
    .select("_id title thumbnail")
    .lean();
  const seriesById = new Map(seriesDocs.map((t: any) => [String(t._id), t]));

  return subs.map((s: any): Card => {
    const ts: any = seriesById.get(String(s.testSeriesId));
    const endAt: Date | null = s.endAt ? new Date(s.endAt) : null;
    return {
      _id: s._id,
      title: ts?.title || "Test Series",
      author: null,
      thumbnail: ts?.thumbnail || null,
      badge: "Test Series",
      daysLeft: daysLeftOf(endAt, now),
      startAt: s.startAt,
      endAt: s.endAt,
      action: {
        ...emptyAction,
        kind: "test_series",
        testSeriesId: s.testSeriesId ?? null,
        planId: s.planId ?? null,
      },
      meta: {},
    };
  });
}

// ── ebook ───────────────────────────────────────────────────────────────────
// Ebook subs have no paymentStatus column either; active = status:true &&
// endAt > now. Deduped to the furthest-out endAt per ebookId.
async function buildEbookCards(
  cid: mongoose.Types.ObjectId,
  now: Date
): Promise<Card[]> {
  const allActive = await EbookSubscription.find({
    customerId: cid,
    status: true,
    endAt: { $gt: now },
  })
    .sort({ endAt: -1 })
    .lean();

  const seen = new Set<string>();
  const deduped = allActive.filter((s: any) => {
    const key = `e:${String(s.ebookId)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const subs = deduped.sort(
    (a: any, b: any) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime()
  );
  if (subs.length === 0) return [];

  const ebookIds = [...new Set(subs.map((s: any) => String(s.ebookId)))];
  const ebookDocs = await Ebook.find({ _id: { $in: ebookIds } })
    .select("_id name author image thumbnail")
    .lean();
  const ebookById = new Map(ebookDocs.map((e: any) => [String(e._id), e]));

  return subs.map((s: any): Card => {
    const eb: any = ebookById.get(String(s.ebookId));
    const endAt: Date | null = s.endAt ? new Date(s.endAt) : null;
    return {
      _id: s._id,
      title: eb?.name || "eBook",
      author: eb?.author || null,
      thumbnail: eb?.thumbnail || eb?.image || null,
      badge: "eBook",
      daysLeft: daysLeftOf(endAt, now),
      startAt: s.startAt,
      endAt: s.endAt,
      action: {
        ...emptyAction,
        kind: "ebook",
        ebookId: s.ebookId ?? null,
      },
      meta: {},
    };
  });
}
