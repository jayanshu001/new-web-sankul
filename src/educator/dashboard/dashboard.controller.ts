import { Request, Response } from "express";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";

// GET /api/v1/educator/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const [courses, packages] = await Promise.all([
      Course.find({ courseEducatorId: educatorId }).select("_id name ordered").lean(),
      Package.find({ educatorId }).select("_id name order").lean(),
    ]);

    const courseIds = courses.map((c) => c._id);
    const packageIds = packages.map((p) => p._id);

    // Plan ids for the educator's packages (PackageCourseSubscription.packageId holds plan id)
    const packagePlans = packageIds.length
      ? await PackageCourseEbookPrice.find({ packageId: { $in: packageIds } })
          .select("_id packageId")
          .lean()
      : [];
    const packagePlanIds = packagePlans.map((p) => p._id);

    const now = new Date();

    const [
      courseTotalSubs,
      courseActiveSubs,
      packageTotalSubs,
      packageActiveSubs,
      topCourses,
      topPackages,
      recentSubs,
    ] = await Promise.all([
      PackageCourseSubscription.countDocuments({ courseId: { $in: courseIds } }),
      PackageCourseSubscription.countDocuments({
        courseId: { $in: courseIds },
        status: true,
        endAt: { $gt: now },
      }),
      PackageCourseSubscription.countDocuments({ packageId: { $in: packagePlanIds } }),
      PackageCourseSubscription.countDocuments({
        packageId: { $in: packagePlanIds },
        status: true,
        endAt: { $gt: now },
      }),
      PackageCourseSubscription.aggregate([
        { $match: { courseId: { $in: courseIds } } },
        { $group: { _id: "$courseId", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
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
        { $match: { packageId: { $in: packagePlanIds } } },
        { $group: { _id: "$packageId", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 5 },
      ]),
      PackageCourseSubscription.find({
        $or: [
          { courseId: { $in: courseIds } },
          { packageId: { $in: packagePlanIds } },
        ],
      })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .populate({ path: "courseId", model: Course, select: "name" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          coursesCount: courses.length,
          packagesCount: packages.length,
          courseTotalSubscriptions: courseTotalSubs,
          courseActiveSubscriptions: courseActiveSubs,
          packageTotalSubscriptions: packageTotalSubs,
          packageActiveSubscriptions: packageActiveSubs,
          totalSubscriptions: courseTotalSubs + packageTotalSubs,
          totalActiveSubscriptions: courseActiveSubs + packageActiveSubs,
        },
        topCourses,
        topPackages,
        recentSubscriptions: recentSubs,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
