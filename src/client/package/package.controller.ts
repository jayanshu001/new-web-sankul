import { Request, Response } from "express";
import mongoose from "mongoose";
import { Package } from "../../models/course/Package.model";
import { PackageType } from "../../models/course/PackageType.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageChat } from "../../models/course/PackageChat.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { Goal } from "../../models/Goal.model";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function decorateVideoCategory(cat: any) {
  if (!cat) return null;
  const childCount = await VideoCategoryRelation.countDocuments({ parent: cat._id });
  return {
    _id: cat._id,
    title: cat.title,
    image: cat.image,
    havingChildDirectory: childCount > 0,
    count: "",
  };
}

async function decorateMaterialCategory(cat: any) {
  if (!cat) return null;
  const childCount = await MaterialCategory.countDocuments({ parent: cat._id, status: true });
  return {
    _id: cat._id,
    title: cat.title,
    image: cat.image,
    havingChildDirectory: childCount > 0,
    count: "",
  };
}

async function decorateExamCategory(cat: any) {
  if (!cat) return null;
  const childCount = await ExamCategory.countDocuments({ parentId: cat._id, status: true });
  return {
    _id: cat._id,
    title: cat.name,
    image: cat.image,
    havingChildDirectory: childCount > 0,
    count: "",
  };
}

async function buildPackageDetail(packageId: string) {
  const pkg = await Package.findOne({ _id: packageId, active: true })
    .populate("packageTypeId", "_id name")
    .populate("goalId", "_id title")
    .populate("pcMaterialId", "_id title")
    .populate("specificSubjects.category", "_id title image")
    .populate("materialCategories.category", "_id title image")
    .populate("examCategories.category", "_id title image");
  if (!pkg) return null;

  const subjectRefs = (pkg.specificSubjects ?? [])
    .filter((r: any) => r.status !== false)
    .sort((a: any, b: any) => a.order - b.order);
  const materialRefs = (pkg.materialCategories ?? [])
    .filter((r: any) => r.status !== false)
    .sort((a: any, b: any) => a.order - b.order);
  const examRefs = (pkg.examCategories ?? [])
    .filter((r: any) => r.status !== false)
    .sort((a: any, b: any) => a.order - b.order);

  const [subjects, materials, exams] = await Promise.all([
    Promise.all(subjectRefs.map((r: any) => decorateVideoCategory(r.category))),
    Promise.all(materialRefs.map((r: any) => decorateMaterialCategory(r.category))),
    Promise.all(examRefs.map((r: any) => decorateExamCategory(r.category))),
  ]);

  const plans = await PackageCourseEbookPrice.find({ packageId, status: true }).sort({ duration: 1 });
  const splitPlans = {
    withMaterial: plans.filter((p) => p.withMaterial),
    withoutMaterial: plans.filter((p) => !p.withMaterial),
  };

  // Available promo codes for this package's plans
  const planIds = plans.map((p) => p._id);
  const now = new Date();
  const promoted = await PromotedPackageCourseEbook.find({ planId: { $in: planIds } })
    .populate("promocodeId")
    .lean();
  const availablePromoCode: any[] = [];
  const seen = new Set<string>();
  for (const promo of promoted) {
    const code = promo.promocodeId as any;
    if (!code || code.type !== "public" || code.status === false) continue;
    if (code.promo_start_at && code.promo_start_at > now) continue;
    if (code.promo_expire_at && code.promo_expire_at < now) continue;
    const key = code.promocode ?? code._id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    availablePromoCode.push({
      title: code.title ?? "",
      promocode: code.promocode,
      description: code.description ?? "",
    });
  }

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
      pcMaterial: pkg.pcMaterialId,
    },
    subjects: subjects.filter(Boolean),
    materials: materials.filter(Boolean),
    exams: exams.filter(Boolean),
    plans: splitPlans,
    availablePromoCode,
  };
}

async function hasActiveSubscription(customerId: string, packageId: string): Promise<boolean> {
  const now = new Date();
  const sub = await PackageCourseSubscription.findOne({
    customerId,
    packageId,
    status: true,
    $or: [{ endAt: null }, { endAt: { $gt: now } }],
  });
  return !!sub;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const getPackageDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const detail = await buildPackageDetail(id);
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
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = { active: true };
    if (search) filter.name = { $regex: search, $options: "i" };
    if (isMagazine === "true" || isMagazine === "false") filter.isMagazine = isMagazine === "true";
    if (packageTypeId && mongoose.Types.ObjectId.isValid(packageTypeId))
      filter.packageTypeId = packageTypeId;
    if (goalId && mongoose.Types.ObjectId.isValid(goalId)) filter.goalId = goalId;

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

    const data = await enrichPackages(packages);

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

    const enriched = await Promise.all(
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
        };
      })
    );

    return res.status(200).json({ success: true, data: enriched });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

async function enrichPackages(packages: any[]) {
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

        const enriched = await enrichPackages(packages);
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
