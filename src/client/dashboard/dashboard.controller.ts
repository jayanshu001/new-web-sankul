import { Request, Response } from "express";
import { BannerSlider } from "../../models/system/BannerSlider.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { Customer } from "../../models/customer/Customer.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Notification } from "../../models/system/Notification.model";

// GET /api/v1/client/dashboard — landing data for authenticated user
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const now = new Date();

    const [user, banners, activeCourseSubs, activeEbookSubs, recentCourses, recentEbooks, unreadCount] =
      await Promise.all([
        Customer.findById(userId).select("firstName lastName phoneNumber profilePicture referralCode rewardPoints").lean(),
        BannerSlider.find().sort({ orderBy: 1 }).lean(),
        PackageCourseSubscription.find({
          customerId: userId,
          status: true,
          endAt: { $gt: now },
        })
          .populate({ path: "courseId", model: Course, select: "name image" })
          .populate({ path: "packageId", model: PackageCourseEbookPrice })
          .sort({ endAt: 1 })
          .limit(10)
          .lean(),
        EbookSubscription.find({
          customerId: userId,
          status: true,
          endAt: { $gt: now },
        })
          .populate({ path: "ebookId", model: Ebook, select: "name thumbnail author" })
          .sort({ endAt: 1 })
          .limit(10)
          .lean(),
        Course.find({ status: true }).sort({ createdAt: -1 }).limit(5).lean(),
        Ebook.find({ status: true }).sort({ createdAt: -1 }).limit(5).lean(),
        Notification.countDocuments({ customerId: userId, isRead: false }),
      ]);

    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const sections: Array<{ title: string; type: string; data: unknown }> = [];

    if (banners.length) {
      sections.push({ title: "Banner", type: "banner", data: banners });
    }
    if (activeCourseSubs.length || activeEbookSubs.length) {
      sections.push({
        title: "My Subscriptions",
        type: "subscription",
        data: { courseSubscriptions: activeCourseSubs, ebookSubscriptions: activeEbookSubs },
      });
    }
    if (recentCourses.length) {
      sections.push({ title: "New Courses", type: "course", data: recentCourses });
    }
    if (recentEbooks.length) {
      sections.push({ title: "New E-Books", type: "ebook", data: recentEbooks });
    }

    return res.status(200).json({
      success: true,
      data: {
        user,
        unreadNotifications: unreadCount,
        sections,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
