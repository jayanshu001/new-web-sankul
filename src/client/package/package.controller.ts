import { Request, Response } from "express";
import mongoose from "mongoose";
import { Package } from "../../models/course/Package.model";
import { PackageType } from "../../models/course/PackageType.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageChat } from "../../models/course/PackageChat.model";
import { Video } from "../../models/course/Video.model";
import { Material } from "../../models/course/Material.model";
import { Exam } from "../../models/exam/Exam.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Goal } from "../../models/Goal.model";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildVideoCategoryGroup(cat: any) {
  if (!cat) return null;
  const count = await Video.countDocuments({ videoCategoryId: cat._id, status: true });
  return {
    category: {
      ...cat,
      title: cat.title,
      havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
      count,
    },
  };
}

async function buildMaterialCategoryGroup(cat: any) {
  if (!cat) return null;
  const count = await Material.countDocuments({ materialCategoryId: cat._id, status: true });
  return {
    category: {
      ...cat,
      title: cat.title,
      havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
      count,
    },
  };
}

async function buildExamCategoryEntry(cat: any) {
  if (!cat) return null;
  const count = await Exam.countDocuments({ categoryId: cat._id });
  return {
    category: {
      ...cat,
      title: cat.name,
      havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
      count,
    },
  };
}

async function buildPackageDetail(packageId: string, customerId?: string) {
  const pkg = await Package.findOne({ _id: packageId, active: true })
    .populate("packageTypeId", "_id name")
    .populate("goalId", "_id title")
    .populate({ path: "specificSubjects.category", model: "VideoCategory" })
    .populate({ path: "materialCategories.category", model: "MaterialCategory" })
    .populate({ path: "examCategories.category", model: "ExamCategory" })
    .lean();
  if (!pkg) return null;

  const videoRefs = (pkg.specificSubjects ?? [])
    .filter((r: any) => r.status !== false)
    .sort((a: any, b: any) => a.order - b.order);
  const materialRefs = (pkg.materialCategories ?? [])
    .filter((r: any) => r.status !== false)
    .sort((a: any, b: any) => a.order - b.order);
  const examRefs = (pkg.examCategories ?? [])
    .filter((r: any) => r.status !== false)
    .sort((a: any, b: any) => a.order - b.order);

  const [videos, materials, tests] = await Promise.all([
    Promise.all(videoRefs.map((r: any) => buildVideoCategoryGroup(r.category))),
    Promise.all(materialRefs.map((r: any) => buildMaterialCategoryGroup(r.category))),
    Promise.all(examRefs.map((r: any) => buildExamCategoryEntry(r.category))),
  ]);

  const plans = await PackageCourseEbookPrice.find({ packageId, status: true }).sort({ duration: 1 });
  const splitPlans = {
    withMaterial: plans.filter((p) => p.withMaterial),
    withoutMaterial: plans.filter((p) => !p.withMaterial),
  };

  // Available public promo codes that target this package directly.
  const now = new Date();
  const codes = await PromoCode.find({
    type: "public",
    status: true,
    promo_start_at: { $lte: now },
    promo_expire_at: { $gte: now },
    "appliesTo.type": "package",
    "appliesTo.ids": pkg._id,
  })
    .select("promocode title description")
    .lean();
  const availablePromoCode: any[] = codes.map((c: any) => ({
    title: c.title ?? "",
    promocode: c.promocode,
    description: c.description ?? "",
  }));

  const isPurchased = customerId
    ? await hasActiveSubscription(customerId, String(pkg._id))
    : false;

  return {
    package: {
      _id: pkg._id,
      name: pkg.name,
      description: pkg.description,
      image: pkg.image,
      shareableLink: pkg.shareableLink,
      withMaterialText: pkg.withMaterialText,
      withoutMaterialText: pkg.withoutMaterialText,
      packageType: pkg.packageTypeId,
      goal: pkg.goalId,
      isPaid: pkg.isPaid,
      isPurchased,
    },
    videos: videos.filter(Boolean),
    materials: materials.filter(Boolean),
    tests: tests.filter(Boolean),
    plans: splitPlans,
    availablePromoCode,
  };
}

async function hasActiveSubscription(customerId: string, packageId: string): Promise<boolean> {
  const now = new Date();
  // Subscriptions can reference the Package directly via `targetPackageId`
  // (admin-created flow) or transitively via the plan row stored in `packageId`
  // whose own `packageId` points to the Package.
  const planIds = await PackageCourseEbookPrice.find({ packageId }).distinct("_id");
  const sub = await PackageCourseSubscription.findOne({
    customerId,
    status: true,
    paymentStatus: "verified",
    $and: [
      { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
      { $or: [{ targetPackageId: packageId }, { packageId: { $in: planIds } }] },
    ],
  });
  return !!sub;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const getPackageDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const detail = await buildPackageDetail(id, req.user?.id);
    if (!detail) return res.status(404).json({ success: false, message: "Package not found." });

    return res.status(200).json({ success: true, data: detail });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/packages
// Flat paginated listing of active packages, with optional filters.
export const listPackages = async (req: Request, res: Response) => {
  try {
    const {
      search,
      isMagazine,
      packageTypeId,
      goalId,
      isSmartCourse,
      isPlannerCourse,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = { active: true };
    if (search) filter.name = { $regex: search, $options: "i" };
    if (isMagazine === "true" || isMagazine === "false") filter.isMagazine = isMagazine === "true";
    if (packageTypeId && mongoose.Types.ObjectId.isValid(packageTypeId))
      filter.packageTypeId = packageTypeId;
    if (goalId && mongoose.Types.ObjectId.isValid(goalId)) filter.goalId = goalId;
    if (isSmartCourse === "true" || isSmartCourse === "false")
      filter.isSmartCourse = isSmartCourse === "true";
    if (isPlannerCourse === "true" || isPlannerCourse === "false")
      filter.isPlannerCourse = isPlannerCourse === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [packages, total] = await Promise.all([
      Package.find(filter)
        .populate("packageTypeId", "_id name")
        .populate("goalId", "_id title")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Package.countDocuments(filter),
    ]);

    const data = await enrichPackages(packages, req.user?.id);

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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackagesByType = async (req: Request, res: Response) => {
  try {
    const typeId = req.params.typeId as string;
    if (!mongoose.Types.ObjectId.isValid(typeId))
      return res.status(400).json({ success: false, message: "Invalid type id." });

    const packages = await Package.find({ packageTypeId: typeId, active: true })
      .populate("packageTypeId", "_id name")
      .populate("goalId", "_id title")
      .sort({ order: 1, createdAt: -1 });

    const enriched = await enrichPackages(packages, req.user?.id);

    return res.status(200).json({ success: true, data: enriched });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

async function purchasedPackageIdSet(customerId: string | undefined, packageIds: any[]): Promise<Set<string>> {
  if (!customerId || packageIds.length === 0) return new Set();
  const now = new Date();
  const planIds = await PackageCourseEbookPrice.find({ packageId: { $in: packageIds } }).distinct("_id");
  const subs = await PackageCourseSubscription.find({
    customerId,
    status: true,
    paymentStatus: "verified",
    $and: [
      { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
      { $or: [{ targetPackageId: { $in: packageIds } }, { packageId: { $in: planIds } }] },
    ],
  })
    .select("targetPackageId packageId")
    .lean();

  const planToPackage = new Map<string, string>();
  if (subs.some((s: any) => s.packageId)) {
    const plans = await PackageCourseEbookPrice.find({ _id: { $in: subs.map((s: any) => s.packageId) } })
      .select("_id packageId")
      .lean();
    plans.forEach((pl: any) => planToPackage.set(String(pl._id), String(pl.packageId)));
  }

  const owned = new Set<string>();
  subs.forEach((s: any) => {
    if (s.targetPackageId) owned.add(String(s.targetPackageId));
    const viaPlan = planToPackage.get(String(s.packageId));
    if (viaPlan) owned.add(viaPlan);
  });
  return owned;
}

async function enrichPackages(packages: any[], customerId?: string) {
  const ownedSet = await purchasedPackageIdSet(customerId, packages.map((p) => p._id));
  return Promise.all(
    packages.map(async (p) => {
      const [plans, subCount] = await Promise.all([
        PackageCourseEbookPrice.find({ packageId: p._id, status: true }).sort({ duration: 1 }),
        PackageCourseSubscription.countDocuments({ packageId: p._id, status: true }),
      ]);
      return {
        ...p.toObject(),
        plans: {
          withMaterial: plans.filter((pl) => pl.withMaterial),
          withoutMaterial: plans.filter((pl) => !pl.withMaterial),
        },
        subscriberCount: subCount,
        isPurchased: ownedSet.has(String(p._id)),
      };
    })
  );
}

// GET /api/v1/client/packages/goal?labelIds=id1,id2,id3
// Returns one entry per requested goal-label, with that label's packages
// nested inside the `label` object. Driven by labels from /client/goals/my-goals.
export const listPackagesByGoal = async (req: Request, res: Response) => {
  try {
    const raw = (req.query.labelIds as string) || "";
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        message: "labelIds query param is required (comma-separated).",
      });
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      return res.status(400).json({ success: false, message: "No valid label ids supplied." });
    }

    // Resolve label metadata (name + parent goal) for each requested label.
    const goals = await Goal.find({ "labels._id": { $in: validIds } })
      .select("title labels")
      .lean();

    const labelMeta = new Map<string, { name: string; goalId: any; goalTitle: string }>();
    for (const g of goals as any[]) {
      for (const l of g.labels || []) {
        const lid = l._id?.toString();
        if (lid && validIds.includes(lid)) {
          labelMeta.set(lid, { name: l.name, goalId: g._id, goalTitle: g.title });
        }
      }
    }

    // One entry per requested label, preserving input order.
    const result = await Promise.all(
      validIds.map(async (labelId) => {
        const packages = await Package.find({ goalLabelId: labelId, active: true })
          .populate("packageTypeId", "_id name")
          .populate("goalId", "_id title")
          .sort({ order: 1, createdAt: -1 });

        const enriched = await enrichPackages(packages, req.user?.id);
        const meta = labelMeta.get(labelId);

        return {
          label: {
            _id: labelId,
            name: meta?.name ?? null,
            goalId: meta?.goalId ?? null,
            goalTitle: meta?.goalTitle ?? null,
            packages: enriched,
          },
        };
      })
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackageTypes = async (_req: Request, res: Response) => {
  try {
    const types = await PackageType.find({ active: true }).sort({ order: 1, name: 1 });
    return res.status(200).json({ success: true, data: types });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listMyPackages = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const now = new Date();

    const subs = await PackageCourseSubscription.find({
      customerId,
      packageId: { $ne: null },
      status: true,
      $or: [{ endAt: null }, { endAt: { $gt: now } }],
    })
      .populate({ path: "packageId", populate: { path: "packageTypeId goalId" } })
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: subs });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const getChatMessages = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const packageId = req.params.packageId as string;
    if (!mongoose.Types.ObjectId.isValid(packageId))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const active = await hasActiveSubscription(customerId, packageId);
    if (!active) {
      return res.status(403).json({
        success: false,
        message: "You must have an active subscription to view package chat.",
      });
    }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PackageChat.find({ packageId }).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      PackageChat.countDocuments({ packageId }),
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
