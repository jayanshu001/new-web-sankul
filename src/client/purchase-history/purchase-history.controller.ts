import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Package } from "../../models/course/Package.model";
import { PackageType } from "../../models/course/PackageType.model";
import { Course } from "../../models/course/Course.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Book } from "../../models/book/Book.model";
import {
  BookOrderStatus,
  PackageCourseEbookOrderStatus,
} from "../../models/enums";

const parsePagination = (q: Record<string, string>) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "20", 10) || 20, 1), 100);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// GET /api/v1/client/purchase-history/subscriptions
// Drives the "Subscriptions" tab. Returns paid course/package subscriptions
// only (paymentStatus === "verified"); pending/failed payments are intentionally
// hidden — the user only wants to see their actual purchases here.
//
// Each row carries the package-type badge ("Live" / "Recorded" / "Test Series")
// resolved through PackageCourseEbookPrice → Package → PackageType.
export const listSubscriptionsHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const filter = {
      customerId: new mongoose.Types.ObjectId(userId),
      paymentStatus: "verified",
    };

    const [subs, total] = await Promise.all([
      PackageCourseSubscription.find(filter)
        .sort({ createdAt: -1 })
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

    // Resolve the title + badge in three small parallel reads. The chain is
    // sub.packageId → PackageCourseEbookPrice → Package.packageTypeId → PackageType.
    // (Yes, the field on the subscription is misleadingly named `packageId` but
    // refs PackageCourseEbookPrice — that's the existing schema, not changing it here.)
    const courseIds = [...new Set(subs.map((s: any) => s.courseId && String(s.courseId)).filter(Boolean) as string[])];
    const priceIds = [...new Set(subs.map((s: any) => s.packageId && String(s.packageId)).filter(Boolean) as string[])];
    const directPackageIds = [
      ...new Set(subs.map((s: any) => s.targetPackageId && String(s.targetPackageId)).filter(Boolean)),
    ] as string[];

    const [courses, prices] = await Promise.all([
      Course.find({ _id: { $in: courseIds } }).select("_id name author thumbnail image").lean(),
      PackageCourseEbookPrice.find({ _id: { $in: priceIds } }).select("_id packageId").lean(),
    ]);

    const planPackageIds = prices.map((p) => p.packageId && String(p.packageId)).filter(Boolean) as string[];
    const packageIds = [...new Set([...planPackageIds, ...directPackageIds])];
    const packages = packageIds.length
      ? await Package.find({ _id: { $in: packageIds } }).select("_id name image packageTypeId").lean()
      : [];

    const typeIds = [
      ...new Set(packages.map((p) => p.packageTypeId && String(p.packageTypeId)).filter(Boolean)),
    ] as string[];
    const types = typeIds.length
      ? await PackageType.find({ _id: { $in: typeIds } }).select("_id name").lean()
      : [];

    const courseById = new Map(courses.map((c: any) => [String(c._id), c]));
    const priceById = new Map(prices.map((p: any) => [String(p._id), p]));
    const packageById = new Map(packages.map((p: any) => [String(p._id), p]));
    const typeById = new Map(types.map((t: any) => [String(t._id), t]));

    const data = subs.map((s: any) => {
      const price: any = priceById.get(String(s.packageId));
      const targetPkgId = s.targetPackageId
        ? String(s.targetPackageId)
        : price?.packageId
        ? String(price.packageId)
        : null;
      const pkg: any = targetPkgId ? packageById.get(targetPkgId) : null;
      const type: any = pkg?.packageTypeId ? typeById.get(String(pkg.packageTypeId)) : null;
      const course: any = s.courseId ? courseById.get(String(s.courseId)) : null;
      return {
        _id: s._id,
        kind: s.courseId ? "course" : "package",
        title: course?.name || pkg?.name || "Subscription",
        author: course?.author || null,
        thumbnail: course?.thumbnail || course?.image || pkg?.image || null,
        badge: type?.name || null, // "Live" / "Recorded" / "Test Series"
        amount: s.paidAmount ?? null,
        purchasedAt: s.createdAt,
        startAt: s.startAt,
        endAt: s.endAt,
        receiptUrl: `/api/v1/client/purchase-history/subscriptions/${s._id}/receipt`,
        meta: {
          courseId: s.courseId ?? null,
          targetPackageId: s.targetPackageId ?? null,
          planId: s.packageId, // PackageCourseEbookPrice id
          razorpayOrderId: s.razorpayOrderId ?? null,
          razorpayPaymentId: s.razorpayPaymentId ?? null,
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

// GET /api/v1/client/purchase-history/books
// Drives the "Books" tab. Returns BookOrders in success states only
// (verified / shipped / delivered) — pending/failed/cancelled are hidden
// because the screen is "what I bought", not "every order I ever started".
const BOOK_SUCCESS_STATUSES = [
  BookOrderStatus.VERIFIED,
  BookOrderStatus.SHIPPED,
  BookOrderStatus.DELIVERED,
];

export const listBooksHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const filter = {
      customerId: new mongoose.Types.ObjectId(userId),
      status: { $in: BOOK_SUCCESS_STATUSES },
    };

    const [orders, total] = await Promise.all([
      BookOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      BookOrder.countDocuments(filter),
    ]);

    // Resolve thumbnails from Book for the first line item of each order.
    // BookOrder.items[] doesn't carry a thumbnail, so we look it up here to
    // keep parity with the ebook tab.
    const firstBookIds = [
      ...new Set(
        orders
          .map((o: any) => o.items?.[0]?.bookId && String(o.items[0].bookId))
          .filter(Boolean) as string[]
      ),
    ];
    const books = firstBookIds.length
      ? await Book.find({ _id: { $in: firstBookIds } }).select("_id thumbnail image").lean()
      : [];
    const thumbById = new Map<string, string | null>(
      books.map((b: any) => [String(b._id), b.thumbnail || b.image || null])
    );

    const data = orders.map((o: any) => {
      // Title shows the first item ("Book: Vartaman Vishesh March 2026").
      // If it's a multi-line order, suffix with "+N more".
      const first = o.items?.[0];
      const more = (o.items?.length ?? 0) - 1;
      const title = first
        ? more > 0
          ? `${first.name} +${more} more`
          : first.name
        : "Books order";
      return {
        _id: o._id,
        title,
        thumbnail: first?.bookId ? thumbById.get(String(first.bookId)) ?? null : null,
        amount: o.amount,
        purchasedAt: o.createdAt,
        status: o.status,
        receiptUrl: `/api/v1/client/purchase-history/books/${o._id}/receipt`,
        meta: {
          receiptId: o.receiptId,
          itemsCount: o.items?.length ?? 0,
          razorpayOrderId: o.razorpayOrderId ?? null,
          razorpayPaymentId: o.razorpayPaymentId ?? null,
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

// GET /api/v1/client/purchase-history/ebooks
// Drives the "E-Book" tab. Returns EbookOrders in COMPLETE status only.
export const listEbooksHistory = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const filter = {
      customerId: new mongoose.Types.ObjectId(userId),
      status: PackageCourseEbookOrderStatus.COMPLETE,
    };

    const [orders, total] = await Promise.all([
      EbookOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      EbookOrder.countDocuments(filter),
    ]);

    const ebookIds = [...new Set(orders.map((o: any) => String(o.ebookId)).filter(Boolean))];
    const ebooks = ebookIds.length
      ? await Ebook.find({ _id: { $in: ebookIds } }).select("_id name thumbnail author").lean()
      : [];
    const ebookById = new Map(ebooks.map((e: any) => [String(e._id), e]));

    const data = orders.map((o: any) => {
      const ebook: any = ebookById.get(String(o.ebookId));
      return {
        _id: o._id,
        title: ebook?.name ? `E-Book: ${ebook.name}` : "E-Book purchase",
        author: ebook?.author || null,
        thumbnail: ebook?.thumbnail || null,
        amount: o.orderPrice,
        purchasedAt: o.createdAt,
        status: o.status,
        receiptUrl: `/api/v1/client/purchase-history/ebooks/${o._id}/receipt`,
        meta: {
          ebookId: o.ebookId,
          razorpayOrderId: o.razorpayOrderId ?? null,
          razorpayPaymentId: o.razorpayPaymentId ?? null,
          transactionId: o.transactionId ?? null,
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
