import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Package } from "../../models/course/Package.model";
import { PackageType } from "../../models/course/PackageType.model";
import { Course } from "../../models/course/Course.model";

const parsePagination = (q: Record<string, string>) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "20", 10) || 20, 1), 100);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// GET /api/v1/client/my-subscriptions
// Drives the "My Subscriptions" library screen — shows only currently-active
// course/package subscriptions (verified payment AND endAt in the future).
// Sorted by endAt ascending so expiring-soonest cards surface first.
//
// Shares its data source with the purchase-history Subscriptions tab but
// diverges on filter (active-only), sort, and per-card payload (daysLeft +
// action target instead of amount + receiptUrl).
export const listMySubscriptions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const now = new Date();
    const filter = {
      customerId: new mongoose.Types.ObjectId(userId),
      paymentStatus: "verified",
      status: true,
      endAt: { $gt: now },
    };

    const [subs, total] = await Promise.all([
      PackageCourseSubscription.find(filter)
        .sort({ endAt: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PackageCourseSubscription.countDocuments(filter),
    ]);

    if (subs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total, page: pageNum, limit: limitNum, totalPages: 0 },
      });
    }

    const courseIds = [...new Set(subs.map((s: any) => s.courseId && String(s.courseId)).filter(Boolean) as string[])];
    const priceIds = [...new Set(subs.map((s: any) => s.packageId && String(s.packageId)).filter(Boolean) as string[])];
    // For package subscriptions the target Package id lives on the sub row
    // (targetPackageId) — separate from the plan's own packageId chain.
    const directPackageIds = [
      ...new Set(subs.map((s: any) => s.targetPackageId && String(s.targetPackageId)).filter(Boolean)),
    ] as string[];

    const [courses, prices] = await Promise.all([
      Course.find({ _id: { $in: courseIds } })
        .select("_id name author thumbnail image")
        .lean(),
      PackageCourseEbookPrice.find({ _id: { $in: priceIds } })
        .select("_id packageId duration")
        .lean(),
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

    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const data = subs.map((s: any) => {
      const price: any = priceById.get(String(s.packageId));
      // Resolve the target Package: prefer targetPackageId (package subs),
      // fall back to the plan's packageId (legacy/course-with-package chains).
      const targetPkgId = s.targetPackageId
        ? String(s.targetPackageId)
        : price?.packageId
        ? String(price.packageId)
        : null;
      const pkg: any = targetPkgId ? packageById.get(targetPkgId) : null;
      const type: any = pkg?.packageTypeId ? typeById.get(String(pkg.packageTypeId)) : null;
      const course: any = s.courseId ? courseById.get(String(s.courseId)) : null;

      const endAt: Date | null = s.endAt ? new Date(s.endAt) : null;
      // Ceiling-divide so a sub ending in 23h59m still reads "1 Day Left",
      // matching how the UI mockup phrases it.
      const daysLeft = endAt
        ? Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / MS_PER_DAY))
        : null;

      return {
        _id: s._id,
        title: course?.name || pkg?.name || "Subscription",
        author: course?.author || null,
        thumbnail: course?.thumbnail || course?.image || pkg?.image || null,
        badge: type?.name || null, // e.g. "Live Class" / "Recorded Class" / "Subject Course"
        daysLeft,
        startAt: s.startAt,
        endAt: s.endAt,
        action: {
          // Frontend builds the deep link / route from these. We deliberately
          // don't return a URL — the route lives in the app, not the API.
          // `kind` tells the FE whether to open a course player or a package
          // landing screen.
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
    return res.status(500).json({ success: false, message: e.message });
  }
};
