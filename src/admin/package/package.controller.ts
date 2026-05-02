import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { Package } from "../../models/course/Package.model";
import { PackageType } from "../../models/course/PackageType.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageChat } from "../../models/course/PackageChat.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import {
  createPackageSchema,
  updatePackageSchema,
  reorderPackagesSchema,
  reorderEmbeddedSchema,
  attachPlansSchema,
  createPackageTypeSchema,
  updatePackageTypeSchema,
  createChatMessageSchema,
  setRelationsSchema,
} from "./package.validation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toCategoryRefs(items?: Array<{ category: string; order?: number; status?: boolean }>) {
  if (!items) return undefined;
  return items.map((i) => ({
    category: new Types.ObjectId(i.category),
    order: i.order ?? 0,
    status: i.status ?? true,
  }));
}

function slugifyTopic(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ─── Package Types ────────────────────────────────────────────────────────────

export const listPackageTypes = async (_req: Request, res: Response) => {
  try {
    const types = await PackageType.find().sort({ order: 1, name: 1 });
    return res.status(200).json({ success: true, data: types });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPackageType = async (req: Request, res: Response) => {
  try {
    const data = createPackageTypeSchema.parse(req.body);
    const pt = await PackageType.create(data);
    return res.status(201).json({ success: true, data: pt });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePackageType = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid id." });
    const data = updatePackageTypeSchema.parse(req.body);
    const pt = await PackageType.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!pt) return res.status(404).json({ success: false, message: "Package type not found." });
    return res.status(200).json({ success: true, data: pt });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePackageType = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid id." });
    const inUse = await Package.countDocuments({ packageTypeId: id });
    if (inUse > 0)
      return res.status(400).json({
        success: false,
        message: "Package type is in use; reassign packages first.",
      });
    await PackageType.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: "Package type deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Packages CRUD ────────────────────────────────────────────────────────────

export const listPackages = async (req: Request, res: Response) => {
  try {
    const {
      search,
      active,
      isMagazine,
      isPaid,
      packageTypeId,
      goalId,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    if (search) filter.name = { $regex: search, $options: "i" };
    if (active === "true" || active === "false") filter.active = active === "true";
    if (isMagazine === "true" || isMagazine === "false") filter.isMagazine = isMagazine === "true";
    if (isPaid === "true" || isPaid === "false") filter.isPaid = isPaid === "true";
    if (packageTypeId && mongoose.Types.ObjectId.isValid(packageTypeId))
      filter.packageTypeId = packageTypeId;
    if (goalId && mongoose.Types.ObjectId.isValid(goalId)) filter.goalId = goalId;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Package.find(filter)
        .populate("packageTypeId", "_id name")
        .populate("goalId", "_id title")
        .populate("pcMaterialId", "_id title")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Package.countDocuments(filter),
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

export const getPackageById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const pkg = await Package.findById(id)
      .populate("packageTypeId", "_id name")
      .populate("goalId", "_id title")
      .populate("pcMaterialId", "_id title")
      .populate("educatorId", "_id name")
      .populate("specificSubjects.category", "_id title image")
      .populate("materialCategories.category", "_id title image")
      .populate("examCategories.category", "_id title image");
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });
    return res.status(200).json({ success: true, data: pkg });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPackage = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.active === "string") req.body.active = req.body.active === "true";
    if (typeof req.body.isMagazine === "string") req.body.isMagazine = req.body.isMagazine === "true";
    if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
    const data = createPackageSchema.parse(req.body);
    const payload: any = {
      ...data,
      packageTypeId: data.packageTypeId || null,
      goalId: data.goalId || null,
      goalLabelId: data.goalLabelId || null,
      pcMaterialId: data.pcMaterialId || null,
      educatorId: data.educatorId || null,
      specificSubjects: toCategoryRefs(data.specificSubjects) ?? [],
      materialCategories: toCategoryRefs(data.materialCategories) ?? [],
      examCategories: toCategoryRefs(data.examCategories) ?? [],
      notificationTopic: data.notificationTopic || slugifyTopic(data.name),
    };
    const pkg = await Package.create(payload);
    return res.status(201).json({ success: true, data: pkg });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePackage = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.active === "string") req.body.active = req.body.active === "true";
    if (typeof req.body.isMagazine === "string") req.body.isMagazine = req.body.isMagazine === "true";
    if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
    const data = updatePackageSchema.parse(req.body);
    const update: any = { ...data };
    if (data.packageTypeId !== undefined) update.packageTypeId = data.packageTypeId || null;
    if (data.goalId !== undefined) update.goalId = data.goalId || null;
    if (data.goalLabelId !== undefined) update.goalLabelId = data.goalLabelId || null;
    if (data.pcMaterialId !== undefined) update.pcMaterialId = data.pcMaterialId || null;
    if (data.educatorId !== undefined) update.educatorId = data.educatorId || null;
    if (data.specificSubjects) update.specificSubjects = toCategoryRefs(data.specificSubjects);
    if (data.materialCategories) update.materialCategories = toCategoryRefs(data.materialCategories);
    if (data.examCategories) update.examCategories = toCategoryRefs(data.examCategories);

    const pkg = await Package.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });
    return res.status(200).json({ success: true, data: pkg });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePackage = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const subCount = await PackageCourseSubscription.countDocuments({ packageId: id });
    if (subCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Package has active subscribers; archive (set active=false) instead.",
      });
    }

    await session.withTransaction(async () => {
      await PackageVideoCategoryRelation.deleteMany({ packageId: id }, { session });
      await PackageChat.deleteMany({ packageId: id }, { session });
      await PackageCourseEbookPrice.updateMany(
        { packageId: id },
        { $set: { packageId: null, status: false } },
        { session }
      );
      await Package.findByIdAndDelete(id, { session });
    });

    return res.status(200).json({ success: true, message: "Package deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const togglePackageStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const pkg = await Package.findById(id).select("active");
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });
    pkg.active = !pkg.active;
    await pkg.save();
    return res.status(200).json({ success: true, data: { active: pkg.active } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderPackages = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderPackagesSchema.parse(req.body);
    const values = new Set(orders.map((o) => o.order));
    if (values.size !== orders.length)
      return res.status(400).json({ success: false, message: "Duplicate order values." });
    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } } }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await Package.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Package order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Reorder embedded categories ──────────────────────────────────────────────

async function reorderEmbedded(
  pkgId: string,
  field: "specificSubjects" | "materialCategories" | "examCategories",
  body: any
) {
  const { orders } = reorderEmbeddedSchema.parse(body);
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) return { ok: false, message: "Duplicate order values." };
  const pkg = await Package.findById(pkgId);
  if (!pkg) return { ok: false, message: "Package not found." };
  const map = new Map(orders.map((o) => [o.category, o.order]));
  pkg[field] = pkg[field].map((ref: any) => {
    const newOrder = map.get(ref.category.toString());
    return newOrder !== undefined ? { ...ref.toObject?.() ?? ref, order: newOrder } : ref;
  });
  await pkg.save();
  return { ok: true, data: pkg[field] };
}

export const reorderSpecificSubjects = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const result = await reorderEmbedded(id, "specificSubjects", req.body);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.status(200).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderMaterialCategories = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const result = await reorderEmbedded(id, "materialCategories", req.body);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.status(200).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderExamCategories = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const result = await reorderEmbedded(id, "examCategories", req.body);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.status(200).json({ success: true, data: result.data });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Plans ────────────────────────────────────────────────────────────────────

export const listPackagePlans = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const plans = await PackageCourseEbookPrice.find({ packageId: id }).sort({ duration: 1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const attachPlans = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const { planIds } = attachPlansSchema.parse(req.body);
    const validIds = planIds.filter((i) => mongoose.Types.ObjectId.isValid(i));
    if (!validIds.length)
      return res.status(400).json({ success: false, message: "No valid plan ids." });
    const r = await PackageCourseEbookPrice.updateMany(
      { _id: { $in: validIds } },
      { $set: { packageId: id, courseId: null, ebookId: null } }
    );
    return res.status(200).json({ success: true, modified: r.modifiedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const detachPlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const planId = req.params.planId as string;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(planId))
      return res.status(400).json({ success: false, message: "Invalid ids." });
    await PackageCourseEbookPrice.updateOne(
      { _id: planId, packageId: id },
      { $set: { status: false } }
    );
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Subscribers / Promoted / Relations ───────────────────────────────────────

export const listSubscribers = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter = { packageId: id };
    const [data, total] = await Promise.all([
      PackageCourseSubscription.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      PackageCourseSubscription.countDocuments(filter),
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

export const listPromotedCodes = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const plans = await PackageCourseEbookPrice.find({ packageId: id }).select("_id");
    const planIds = plans.map((p) => p._id);
    const promoted = await PromotedPackageCourseEbook.find({ planId: { $in: planIds } })
      .populate("promocodeId")
      .populate("planId");
    return res.status(200).json({ success: true, data: promoted });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listVideoRelations = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const relations = await PackageVideoCategoryRelation.find({ packageId: id })
      .populate("videoCategoryRelationId");
    return res.status(200).json({ success: true, data: relations });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const setVideoRelations = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const { videoCategoryRelationIds } = setRelationsSchema.parse(req.body);

    // Verify relation ids exist
    const validIds = videoCategoryRelationIds.filter((i) =>
      mongoose.Types.ObjectId.isValid(i)
    );

    await session.withTransaction(async () => {
      // Deactivate existing
      await PackageVideoCategoryRelation.updateMany(
        { packageId: id },
        { $set: { active: false } },
        { session }
      );
      // Upsert new ones as active
      for (const rid of validIds) {
        await PackageVideoCategoryRelation.updateOne(
          { packageId: id, videoCategoryRelationId: rid },
          { $set: { active: true } },
          { upsert: true, session }
        );
      }
    });

    return res.status(200).json({ success: true, count: validIds.length });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

/**
 * Recursively collects all descendant video-category relation ids from a root
 * subject, then activates all those relations for this package.
 */
export const expandSubjectsToRelations = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const pkg = await Package.findById(id).select("specificSubjects");
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });

    const rootSubjectIds = pkg.specificSubjects.map((s) => s.category);

    // BFS across VideoCategoryRelation tree
    const collected = new Set<string>();
    let frontier: Types.ObjectId[] = [...rootSubjectIds];
    while (frontier.length) {
      const rels = await VideoCategoryRelation.find({ parent: { $in: frontier } })
        .select("_id child")
        .lean();
      if (!rels.length) break;
      const nextFrontier: Types.ObjectId[] = [];
      for (const r of rels) {
        if (!collected.has(r._id.toString())) {
          collected.add(r._id.toString());
          if (r.child) nextFrontier.push(r.child as Types.ObjectId);
        }
      }
      frontier = nextFrontier;
    }

    await session.withTransaction(async () => {
      await PackageVideoCategoryRelation.updateMany(
        { packageId: id },
        { $set: { active: false } },
        { session }
      );
      for (const rid of collected) {
        await PackageVideoCategoryRelation.updateOne(
          { packageId: id, videoCategoryRelationId: rid },
          { $set: { active: true } },
          { upsert: true, session }
        );
      }
    });

    return res.status(200).json({ success: true, count: collected.size });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export const listChatMessages = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });

    const { page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 50, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PackageChat.find({ packageId: id }).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      PackageChat.countDocuments({ packageId: id }),
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

export const postChatMessage = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid package id." });
    const data = createChatMessageSchema.parse(req.body);
    if (!data.text && !data.mediaUrl) {
      return res.status(400).json({ success: false, message: "Provide text or mediaUrl." });
    }
    const pkg = await Package.findById(id).select("_id");
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });

    const adminId = (req as any).user?.id;
    const msg = await PackageChat.create({
      packageId: id,
      text: data.text,
      mediaUrl: data.mediaUrl,
      mediaType: data.mediaType,
      senderType: "admin",
      senderId: adminId ? new Types.ObjectId(adminId) : null,
      pushSent: false,
    });

    // Actual FCM push will be wired when firebase-admin is added.
    return res.status(201).json({ success: true, data: msg });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteChatMessage = async (req: Request, res: Response) => {
  try {
    const id = req.params.messageId as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid message id." });
    const msg = await PackageChat.findByIdAndDelete(id);
    if (!msg) return res.status(404).json({ success: false, message: "Message not found." });
    return res.status(200).json({ success: true, message: "Message deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
