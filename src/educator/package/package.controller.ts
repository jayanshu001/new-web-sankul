import { Request, Response } from "express";
import mongoose from "mongoose";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/educator/packages
export const listMyPackages = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const packages = await Package.find({ educatorId })
      .sort({ order: 1 })
      .lean();

    const packageIds = packages.map((p) => p._id);

    const plans = await PackageCourseEbookPrice.find({
      packageId: { $in: packageIds },
      status: true,
    })
      .sort({ duration: 1 })
      .lean();

    const planIds = plans.map((p: any) => p._id);
    const subCounts = await PackageCourseSubscription.aggregate([
      { $match: { packageId: { $in: planIds } } },
      {
        $group: {
          _id: "$packageId",
          total: { $sum: 1 },
          active: { $sum: { $cond: ["$status", 1, 0] } },
        },
      },
    ]);

    // subCounts is keyed by plan id (PackageCourseSubscription.packageId is a plan id).
    // Rebuild a package->counts map by correlating plans to packages.
    const planToPackage: Record<string, string> = {};
    plans.forEach((p: any) => (planToPackage[String(p._id)] = String(p.packageId)));

    const countByPackage: Record<string, { total: number; active: number }> = {};
    subCounts.forEach((r: any) => {
      const pkgKey = planToPackage[String(r._id)];
      if (!pkgKey) return;
      countByPackage[pkgKey] ||= { total: 0, active: 0 };
      countByPackage[pkgKey].total += r.total;
      countByPackage[pkgKey].active += r.active;
    });

    const planByPackage: Record<string, any[]> = {};
    plans.forEach((p: any) => {
      const k = String(p.packageId);
      (planByPackage[k] ||= []).push(p);
    });

    const data = packages.map((p: any) => ({
      ...p,
      plans: planByPackage[String(p._id)] || [],
      subscriptionCount: countByPackage[String(p._id)]?.total || 0,
      activeSubscriptions: countByPackage[String(p._id)]?.active || 0,
    }));

    return res.status(200).json({ success: true, data: { packages: data } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/packages/:id
export const getMyPackageDetail = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const pkg = await Package.findOne({ _id: id, educatorId }).lean();
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found or not yours." });

    const plans = await PackageCourseEbookPrice.find({ packageId: id, status: true })
      .sort({ duration: 1 })
      .lean();

    return res.status(200).json({ success: true, data: { ...pkg, plans } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/packages/:id/dashboard
export const getPackageDashboard = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const pkg = await Package.findOne({ _id: id, educatorId });
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found or not yours." });

    const plans = await PackageCourseEbookPrice.find({ packageId: id }).select("_id").lean();
    const planIds = plans.map((p) => p._id);

    const now = new Date();
    const [totalSubs, activeSubs, expiredSubs, recentSubs] = await Promise.all([
      PackageCourseSubscription.countDocuments({ packageId: { $in: planIds } }),
      PackageCourseSubscription.countDocuments({
        packageId: { $in: planIds },
        status: true,
        endAt: { $gt: now },
      }),
      PackageCourseSubscription.countDocuments({
        packageId: { $in: planIds },
        endAt: { $lte: now },
      }),
      PackageCourseSubscription.find({ packageId: { $in: planIds } })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalSubscriptions: totalSubs,
        activeSubscriptions: activeSubs,
        expiredSubscriptions: expiredSubs,
        plansCount: planIds.length,
        recentSubscriptions: recentSubs,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/packages/:id/subscribers
export const getPackageSubscribers = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const pkg = await Package.findOne({ _id: id, educatorId }).select("_id");
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found or not yours." });

    const plans = await PackageCourseEbookPrice.find({ packageId: id }).select("_id").lean();
    const planIds = plans.map((p) => p._id);

    const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PackageCourseSubscription.find({ packageId: { $in: planIds } })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber emailAddress" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PackageCourseSubscription.countDocuments({ packageId: { $in: planIds } }),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
