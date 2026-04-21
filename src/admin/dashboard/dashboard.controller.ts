import { Request, Response } from "express";
import { Customer } from "../../models/customer/Customer.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { BookOrder } from "../../models/book/BookOrder.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Book } from "../../models/book/Book.model";
import { Promoter } from "../../models/promoter/Promoter.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { OfflineEnquiry } from "../../models/offline/OfflineEnquiry.model";
import { Inquiry } from "../../models/system/Inquiry.model";
import { PackageCourseEbookOrderStatus } from "../../models/enums";

// GET /api/v1/admin/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    const dateFilter: any = {};
    if (fromDate) dateFilter.$gte = new Date(fromDate);
    if (toDate) dateFilter.$lte = new Date(toDate);
    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const rangeMatch: any = hasDateFilter ? { createdAt: dateFilter } : {};

    const now = new Date();
    const startOf30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalCustomers,
      activeCustomers,
      newCustomersThisMonth,
      totalCourses,
      totalPackages,
      totalEbooks,
      totalBooks,
      totalPromoters,
      totalEducators,
      totalCourseSubscriptions,
      activeCourseSubscriptions,
      totalEbookSubscriptions,
      ebookRevenueAgg,
      courseRevenueAgg,
      bookRevenueAgg,
      topCourses,
      topPackages,
      recentCustomerSubs,
      pendingOfflineEnquiries,
      pendingInquiries,
    ] = await Promise.all([
      Customer.countDocuments({ isAccountDeleted: false }),
      Customer.countDocuments({ isAccountDeleted: false, status: true }),
      Customer.countDocuments({
        isAccountDeleted: false,
        createdAt: { $gte: startOf30 },
      }),
      Course.countDocuments({ status: true }),
      Package.countDocuments({ active: true }),
      Ebook.countDocuments({ status: true }),
      Book.countDocuments({ status: true }),
      Promoter.countDocuments({ isDelete: false, status: true }),
      CourseEducator.countDocuments({ status: true }),
      PackageCourseSubscription.countDocuments(rangeMatch),
      PackageCourseSubscription.countDocuments({
        ...rangeMatch,
        status: true,
        endAt: { $gt: now },
      }),
      EbookSubscription.countDocuments(rangeMatch),
      EbookOrder.aggregate([
        {
          $match: {
            status: PackageCourseEbookOrderStatus.COMPLETE,
            ...(hasDateFilter ? { createdAt: dateFilter } : {}),
          },
        },
        { $group: { _id: null, revenue: { $sum: "$orderPrice" }, count: { $sum: 1 } } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: rangeMatch },
        { $group: { _id: null, revenue: { $sum: "$paidAmount" }, count: { $sum: 1 } } },
      ]),
      BookOrder.aggregate([
        {
          $match: {
            status: "verified",
            ...(hasDateFilter ? { createdAt: dateFilter } : {}),
          },
        },
        { $group: { _id: null, revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: { ...rangeMatch, courseId: { $ne: null } } },
        {
          $group: {
            _id: "$courseId",
            count: { $sum: 1 },
            revenue: { $sum: "$paidAmount" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "ws_courses",
            localField: "_id",
            foreignField: "_id",
            as: "course",
          },
        },
        { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: rangeMatch },
        {
          $group: {
            _id: "$packageId",
            count: { $sum: 1 },
            revenue: { $sum: "$paidAmount" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      PackageCourseSubscription.find(rangeMatch)
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .populate({ path: "courseId", model: Course, select: "name" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      OfflineEnquiry.countDocuments(rangeMatch),
      Inquiry.countDocuments(rangeMatch),
    ]);

    const courseRevenue = courseRevenueAgg[0]?.revenue || 0;
    const ebookRevenue = ebookRevenueAgg[0]?.revenue || 0;
    const bookRevenue = bookRevenueAgg[0]?.revenue || 0;

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          customers: {
            total: totalCustomers,
            active: activeCustomers,
            newLast30Days: newCustomersThisMonth,
          },
          catalog: {
            courses: totalCourses,
            packages: totalPackages,
            ebooks: totalEbooks,
            books: totalBooks,
          },
          team: {
            promoters: totalPromoters,
            educators: totalEducators,
          },
          subscriptions: {
            totalCourse: totalCourseSubscriptions,
            activeCourse: activeCourseSubscriptions,
            totalEbook: totalEbookSubscriptions,
          },
          revenue: {
            courseSubscriptions: courseRevenue,
            ebookOrders: ebookRevenue,
            bookOrders: bookRevenue,
            total: courseRevenue + ebookRevenue + bookRevenue,
          },
          enquiries: {
            offline: pendingOfflineEnquiries,
            website: pendingInquiries,
          },
        },
        topCourses,
        topPackages,
        recentSubscriptions: recentCustomerSubs,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
