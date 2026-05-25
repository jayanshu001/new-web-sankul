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
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";

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

  const activeSub = customerId
    ? await getActiveSubscription(customerId, String(pkg._id))
    : null;
  const isPurchased = !!activeSub;
  const daysLeft = isPurchased ? computeDaysLeft(activeSub?.endAt ?? null) : null;

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
      daysLeft,
    },
    videos: videos.filter(Boolean),
    materials: materials.filter(Boolean),
    tests: tests.filter(Boolean),
    plans: splitPlans,
    availablePromoCode,
  };
}

async function getActiveSubscription(customerId: string, packageId: string): Promise<{ endAt: Date | null } | null> {
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
  }).select("endAt").lean();
  return sub ? { endAt: (sub as any).endAt ?? null } : null;
}

async function hasActiveSubscription(customerId: string, packageId: string): Promise<boolean> {
  return !!(await getActiveSubscription(customerId, packageId));
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const getPackageDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getPackageDetail invoked", { traceId, path: req.originalUrl, userId: req.user?.id, packageId: id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("getPackageDetail invalid id", { traceId, packageId: id }); return res.status(400).json({ success: false, message: "Invalid package id." }); }

    const detail = await buildPackageDetail(id, req.user?.id);
    if (!detail) { logger.warn("getPackageDetail not found", { traceId, packageId: id }); return res.status(404).json({ success: false, message: "Package not found." }); }

    logger.info("getPackageDetail success", { traceId, packageId: id });
    return res.status(200).json({ success: true, data: detail });
  } catch (error: any) {
    logger.error("getPackageDetail failed", { traceId, packageId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/packages
// Flat paginated listing of active packages, with optional filters.
export const listPackages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPackages invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

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

    logger.info("listPackages success", { traceId, total, returned: data.length });
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
    logger.error("listPackages failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackagesByType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const typeId = req.params.typeId as string;
  logger.info("listPackagesByType invoked", { traceId, path: req.originalUrl, userId: req.user?.id, typeId });

  try {
    if (!mongoose.Types.ObjectId.isValid(typeId)) { logger.warn("listPackagesByType invalid id", { traceId, typeId }); return res.status(400).json({ success: false, message: "Invalid type id." }); }

    const packages = await Package.find({ packageTypeId: typeId, active: true })
      .populate("packageTypeId", "_id name")
      .populate("goalId", "_id title")
      .sort({ order: 1, createdAt: -1 });

    const enriched = await enrichPackages(packages, req.user?.id);

    logger.info("listPackagesByType success", { traceId, typeId, count: enriched.length });
    return res.status(200).json({ success: true, data: enriched });
  } catch (error: any) {
    logger.error("listPackagesByType failed", { traceId, typeId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Returns a map of packageId -> latest-expiring active subscription's endAt
// (Date | null). `null` means lifetime; absence means not purchased.
async function purchasedPackageEndAtMap(customerId: string | undefined, packageIds: any[]): Promise<Map<string, Date | null>> {
  if (!customerId || packageIds.length === 0) return new Map();
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
    .select("targetPackageId packageId endAt")
    .lean();

  const planToPackage = new Map<string, string>();
  if (subs.some((s: any) => s.packageId)) {
    const plans = await PackageCourseEbookPrice.find({ _id: { $in: subs.map((s: any) => s.packageId) } })
      .select("_id packageId")
      .lean();
    plans.forEach((pl: any) => planToPackage.set(String(pl._id), String(pl.packageId)));
  }

  // Pick the longest-lived active sub per package. `null` (lifetime) beats any date.
  const owned = new Map<string, Date | null>();
  const upsert = (pid: string, endAt: Date | null) => {
    if (!owned.has(pid)) { owned.set(pid, endAt); return; }
    const prev = owned.get(pid);
    if (prev === null || endAt === null) { owned.set(pid, null); return; }
    if (endAt.getTime() > (prev as Date).getTime()) owned.set(pid, endAt);
  };
  subs.forEach((s: any) => {
    const endAt: Date | null = s.endAt ?? null;
    if (s.targetPackageId) upsert(String(s.targetPackageId), endAt);
    const viaPlan = planToPackage.get(String(s.packageId));
    if (viaPlan) upsert(viaPlan, endAt);
  });
  return owned;
}

async function enrichPackages(packages: any[], customerId?: string) {
  const ownedMap = await purchasedPackageEndAtMap(customerId, packages.map((p) => p._id));
  const now = new Date();
  return Promise.all(
    packages.map(async (p) => {
      const [plans, subCount] = await Promise.all([
        PackageCourseEbookPrice.find({ packageId: p._id, status: true }).sort({ duration: 1 }),
        PackageCourseSubscription.countDocuments({ packageId: p._id, status: true }),
      ]);
      const pid = String(p._id);
      const isPurchased = ownedMap.has(pid);
      return {
        ...p.toObject(),
        plans: {
          withMaterial: plans.filter((pl) => pl.withMaterial),
          withoutMaterial: plans.filter((pl) => !pl.withMaterial),
        },
        subscriberCount: subCount,
        isPurchased,
        daysLeft: isPurchased ? computeDaysLeft(ownedMap.get(pid) ?? null, now) : null,
      };
    })
  );
}

// GET /api/v1/client/packages/goal?labelIds=id1,id2,id3
// Returns one entry per requested goal-label, with that label's packages
// nested inside the `label` object. Driven by labels from /client/goals/my-goals.
export const listPackagesByGoal = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listPackagesByGoal invoked", { traceId, path: req.originalUrl, userId: req.user?.id, labelIds: req.query.labelIds });

  try {
    const raw = (req.query.labelIds as string) || "";
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!ids.length) {
      logger.warn("listPackagesByGoal missing labelIds", { traceId });
      return res.status(400).json({
        success: false,
        message: "labelIds query param is required (comma-separated).",
      });
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validIds.length) {
      logger.warn("listPackagesByGoal no valid labelIds", { traceId, ids });
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

    logger.info("listPackagesByGoal success", { traceId, labelCount: result.length });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    logger.error("listPackagesByGoal failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackageTypes = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listPackageTypes invoked", { traceId, path: _req.originalUrl });

  try {
    const types = await PackageType.find({ active: true }).sort({ order: 1, name: 1 });
    logger.info("listPackageTypes success", { traceId, count: types.length });
    return res.status(200).json({ success: true, data: types });
  } catch (error: any) {
    logger.error("listPackageTypes failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listMyPackages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyPackages invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("listMyPackages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const now = new Date();

    const subs = await PackageCourseSubscription.find({
      customerId,
      packageId: { $ne: null },
      status: true,
      $or: [{ endAt: null }, { endAt: { $gt: now } }],
    })
      .populate({ path: "packageId", populate: { path: "packageTypeId goalId" } })
      .sort({ createdAt: -1 })
      .lean();

    const data = subs.map((s: any) => ({
      ...s,
      daysLeft: computeDaysLeft(s.endAt ?? null, now),
    }));

    logger.info("listMyPackages success", { traceId, customerId, count: subs.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("listMyPackages failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const getChatMessages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const packageId = req.params.packageId as string;
  logger.info("getChatMessages invoked", { traceId, path: req.originalUrl, customerId, packageId });

  try {
    if (!customerId) { logger.warn("getChatMessages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    if (!mongoose.Types.ObjectId.isValid(packageId)) { logger.warn("getChatMessages invalid id", { traceId, customerId, packageId }); return res.status(400).json({ success: false, message: "Invalid package id." }); }

    const active = await hasActiveSubscription(customerId, packageId);
    if (!active) {
      logger.warn("getChatMessages no active subscription", { traceId, customerId, packageId });
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

    logger.info("getChatMessages success", { traceId, customerId, packageId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("getChatMessages failed", { traceId, customerId, packageId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
