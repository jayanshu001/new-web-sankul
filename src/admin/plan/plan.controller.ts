import { Request, Response } from "express";
import mongoose from "mongoose";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import {
  createPlanSchema,
  updatePlanSchema,
  bulkStatusSchema,
  bulkDeleteSchema,
} from "./plan.validation";
import { buildRegexCondition } from "../../utils/searchFilter";
import * as planSql from "../../modules/admin-plan/admin-plan.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EntityKey = "courseId" | "packageId" | "ebookId";

function resolveEntityKey(
  plan: { courseId?: any; packageId?: any; ebookId?: any }
): EntityKey | null {
  if (plan.courseId) return "courseId";
  if (plan.packageId) return "packageId";
  if (plan.ebookId) return "ebookId";
  return null;
}

async function enforceSingleDefault(
  planId: string,
  entityKey: EntityKey,
  entityId: mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
) {
  await PackageCourseEbookPrice.updateMany(
    { [entityKey]: entityId, _id: { $ne: planId } },
    { $set: { isDefault: false } },
    session ? { session } : undefined
  );
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const listPlans = async (req: Request, res: Response) => {
  try {
    const {
      entityType,
      courseId,
      packageId,
      ebookId,
      status,
      isDefault,
      withMaterial,
      search,
      sortBy,
      sortOrder,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum0 = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum0 = Math.max(parseInt(limit, 10) || 20, 1);
    const sortDir: "asc" | "desc" = sortOrder === "asc" ? "asc" : "desc";

    // ─── MySQL branch (ws_package_course_ebook_price) ─────────────────────
    if (planSql.isAdminPlanMysql()) {
      const { items, total } = await planSql.listPlans({ entityType, courseId, packageId, ebookId, status, isDefault, withMaterial, search, sortBy, sortDir, page: pageNum0, limit: limitNum0 });
      return res.status(200).json({ success: true, data: items, pagination: { total, page: pageNum0, limit: limitNum0, totalPages: Math.ceil(total / limitNum0) } });
    }

    const filter: any = {};

    if (entityType === "course") filter.courseId = { $ne: null };
    else if (entityType === "package") filter.packageId = { $ne: null };
    else if (entityType === "ebook") filter.ebookId = { $ne: null };

    if (courseId && mongoose.Types.ObjectId.isValid(courseId)) filter.courseId = courseId;
    if (packageId && mongoose.Types.ObjectId.isValid(packageId)) filter.packageId = packageId;
    if (ebookId && mongoose.Types.ObjectId.isValid(ebookId)) filter.ebookId = ebookId;

    if (status === "true" || status === "false") filter.status = status === "true";
    if (isDefault === "true" || isDefault === "false") filter.isDefault = isDefault === "true";
    if (withMaterial === "true" || withMaterial === "false")
      filter.withMaterial = withMaterial === "true";
    { const c = buildRegexCondition(search); if (c) filter.name = c; }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    // Query-driven sort when sortBy is whitelisted; else the legacy default
    // (default-plan first, duration asc, newest). Mirrors the MySQL branch.
    const dir = sortDir === "asc" ? 1 : -1;
    const sortField =
      sortBy === "name" ? "name" :
      sortBy === "duration" ? "duration" :
      sortBy === "price" ? "price" :
      sortBy === "createdAt" ? "createdAt" :
      sortBy === "updatedAt" ? "updatedAt" : null;
    const sortSpec: Record<string, 1 | -1> = sortField
      ? { [sortField]: dir as 1 | -1, _id: -1 }
      : { createdAt: -1, _id: -1 }; // default: recently-added on top

    const [data, total] = await Promise.all([
      PackageCourseEbookPrice.find(filter)
        .populate("courseId", "_id name")
        .populate("packageId", "_id name")
        .populate("ebookId", "_id name")
        .sort(sortSpec)
        .skip(skip)
        .limit(limitNum),
      PackageCourseEbookPrice.countDocuments(filter),
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

export const getPlanById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const numId = planSql.parsePlanId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
      const data = await planSql.getPlanById(numId);
      if (!data) return res.status(404).json({ success: false, message: "Plan not found." });
      return res.status(200).json({ success: true, data });
    }

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid plan id." });
    const plan = await PackageCourseEbookPrice.findById(id)
      .populate("courseId", "_id name")
      .populate("packageId", "_id name")
      .populate("ebookId", "_id name");
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found." });

    const [promoted, subCount] = await Promise.all([
      PromotedPackageCourseEbook.countDocuments({ planId: id }),
      PackageCourseSubscription.countDocuments({ packageId: id }),
    ]);

    return res.status(200).json({
      success: true,
      data: { ...plan.toObject(), promotedCount: promoted, subscriberCount: subCount },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPlan = async (req: Request, res: Response) => {
  // Audit P0 fix: wrap the plan insert + sibling default-flip in a single
  // transaction so two `isDefault: true` rows for the same entity can't
  // exist between writes.
  const session = await mongoose.startSession();
  try {
    const data = createPlanSchema.parse(req.body);

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const created = await planSql.createPlan(data as any);
      return res.status(201).json({ success: true, data: created });
    }

    const payload: any = {
      ...data,
      withMaterial: data.withMaterial ?? false,
      materialPrice: data.materialPrice ?? 0,
      courseId: data.courseId || null,
      packageId: data.packageId || null,
      ebookId: data.ebookId || null,
    };

    let createdPlan: any;
    await session.withTransaction(async () => {
      const [plan] = await PackageCourseEbookPrice.create([payload], { session });
      createdPlan = plan;
      if (plan.isDefault) {
        const key = resolveEntityKey(plan)!;
        const entityId = plan[key] as mongoose.Types.ObjectId;
        await enforceSingleDefault(plan._id.toString(), key, entityId, session);
      }
    });

    return res.status(201).json({ success: true, data: createdPlan });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const updatePlan = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  // ─── MySQL branch ─────────────────────────────────────────────────────
  if (planSql.isAdminPlanMysql()) {
    try {
      const numId = planSql.parsePlanId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
      const data = updatePlanSchema.parse(req.body);
      const updated = await planSql.updatePlan(numId, data as any);
      if (!updated) return res.status(404).json({ success: false, message: "Plan not found." });
      return res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ success: false, message: "Invalid plan id." });

  const session = await mongoose.startSession();
  try {
    const data = updatePlanSchema.parse(req.body);

    // When linkage is being changed, normalise all three keys so the plan can
    // never end up pointing at two entities: the chosen one is set, the other
    // two are explicitly nulled. Validation already guaranteed exactly one is
    // truthy when any of the three is present.
    const linkagePresent =
      data.courseId !== undefined || data.packageId !== undefined || data.ebookId !== undefined;
    const setFields: any = { ...data };
    if (linkagePresent) {
      setFields.courseId = data.courseId || null;
      setFields.packageId = data.packageId || null;
      setFields.ebookId = data.ebookId || null;
    }

    let updated: any;
    let notFound = false;
    await session.withTransaction(async () => {
      const plan = await PackageCourseEbookPrice.findByIdAndUpdate(
        id,
        { $set: setFields },
        { new: true, session }
      );
      if (!plan) {
        notFound = true;
        return;
      }
      updated = plan;
      if (plan.isDefault) {
        const key = resolveEntityKey(plan);
        if (key) {
          const entityId = plan[key] as mongoose.Types.ObjectId;
          await enforceSingleDefault(plan._id.toString(), key, entityId, session);
        }
      }
    });

    if (notFound) return res.status(404).json({ success: false, message: "Plan not found." });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const deletePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const numId = planSql.parsePlanId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
      const r = await planSql.deletePlan(numId);
      if (r === "not_found") return res.status(404).json({ success: false, message: "Plan not found." });
      if (r === "has_subscribers") return res.status(400).json({ success: false, message: "Plan has subscribers; archive (set status=false) instead." });
      return res.status(200).json({ success: true, message: "Plan deleted." });
    }

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid plan id." });

    const subCount = await PackageCourseSubscription.countDocuments({ packageId: id });
    if (subCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Plan has subscribers; archive (set status=false) instead.",
      });
    }

    const plan = await PackageCourseEbookPrice.findByIdAndDelete(id);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found." });
    // Orphan any promoted-promo rows
    await PromotedPackageCourseEbook.deleteMany({ planId: id });
    return res.status(200).json({ success: true, message: "Plan deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePlanStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const numId = planSql.parsePlanId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
      const newStatus = await planSql.togglePlanStatus(numId);
      if (newStatus === null) return res.status(404).json({ success: false, message: "Plan not found." });
      return res.status(200).json({ success: true, data: { status: newStatus } });
    }

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid plan id." });
    const plan = await PackageCourseEbookPrice.findById(id).select("status");
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found." });
    plan.status = !plan.status;
    await plan.save();
    return res.status(200).json({ success: true, data: { status: plan.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const markAsDefault = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  // ─── MySQL branch ─────────────────────────────────────────────────────
  if (planSql.isAdminPlanMysql()) {
    const numId = planSql.parsePlanId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
    const r = await planSql.markAsDefault(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Plan not found." });
    if (r === "no_owner") return res.status(400).json({ success: false, message: "Plan is not attached to any course/package/ebook." });
    return res.status(200).json({ success: true, data: r });
  }

  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ success: false, message: "Invalid plan id." });

  const session = await mongoose.startSession();
  try {
    let notFound = false;
    let invalidEntity = false;
    let result: any;

    await session.withTransaction(async () => {
      const plan = await PackageCourseEbookPrice.findById(id).session(session);
      if (!plan) {
        notFound = true;
        return;
      }
      const key = resolveEntityKey(plan);
      if (!key) {
        invalidEntity = true;
        return;
      }
      plan.isDefault = true;
      await plan.save({ session });
      await enforceSingleDefault(
        plan._id.toString(),
        key,
        plan[key] as mongoose.Types.ObjectId,
        session
      );
      result = plan;
    });

    if (notFound) return res.status(404).json({ success: false, message: "Plan not found." });
    if (invalidEntity)
      return res.status(400).json({
        success: false,
        message: "Plan is not attached to any course/package/ebook.",
      });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkStatusSchema.parse(req.body);

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const numIds = ids.map((i) => planSql.parsePlanId(i)).filter((n): n is number => n !== null);
      if (!numIds.length) return res.status(400).json({ success: false, message: "No valid ids." });
      const modified = await planSql.bulkStatus(numIds, status);
      return res.status(200).json({ success: true, modified });
    }

    const valid = ids.filter((i) => mongoose.Types.ObjectId.isValid(i));
    if (!valid.length) return res.status(400).json({ success: false, message: "No valid ids." });
    const r = await PackageCourseEbookPrice.updateMany(
      { _id: { $in: valid } },
      { $set: { status } }
    );
    return res.status(200).json({ success: true, modified: r.modifiedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkDeleteSchema.parse(req.body);

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const numIds = ids.map((i) => planSql.parsePlanId(i)).filter((n): n is number => n !== null);
      if (!numIds.length) return res.status(400).json({ success: false, message: "No valid ids." });
      const r = await planSql.bulkDelete(numIds);
      if (!r.ok) return res.status(400).json({ success: false, message: "One or more plans have subscribers; remove those first." });
      return res.status(200).json({ success: true, deleted: r.deleted });
    }

    const valid = ids.filter((i) => mongoose.Types.ObjectId.isValid(i));
    if (!valid.length) return res.status(400).json({ success: false, message: "No valid ids." });

    const stillSubscribed = await PackageCourseSubscription.countDocuments({
      packageId: { $in: valid },
    });
    if (stillSubscribed > 0) {
      return res.status(400).json({
        success: false,
        message: "One or more plans have subscribers; remove those first.",
      });
    }

    const r = await PackageCourseEbookPrice.deleteMany({ _id: { $in: valid } });
    await PromotedPackageCourseEbook.deleteMany({ planId: { $in: valid } });
    return res.status(200).json({ success: true, deleted: r.deletedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const clonePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { targetCourseId, targetPackageId, targetEbookId } = req.body as Record<string, string>;

    // ─── MySQL branch ─────────────────────────────────────────────────────
    if (planSql.isAdminPlanMysql()) {
      const numId = planSql.parsePlanId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid plan id." });
      const r = await planSql.clonePlan(numId, { courseId: targetCourseId, packageId: targetPackageId, ebookId: targetEbookId });
      if (r === "not_found") return res.status(404).json({ success: false, message: "Plan not found." });
      if (r === "bad_target") return res.status(400).json({ success: false, message: "Exactly one of targetCourseId, targetPackageId, targetEbookId is required." });
      return res.status(201).json({ success: true, data: r });
    }

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid plan id." });
    const existing = await PackageCourseEbookPrice.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: "Plan not found." });

    const targets = [targetCourseId, targetPackageId, targetEbookId].filter(Boolean);
    if (targets.length !== 1)
      return res.status(400).json({
        success: false,
        message: "Exactly one of targetCourseId, targetPackageId, targetEbookId is required.",
      });

    const payload: any = {
      name: existing.name,
      duration: existing.duration,
      price: existing.price,
      withMaterial: existing.withMaterial,
      materialPrice: existing.materialPrice,
      isDefault: false,
      status: existing.status,
      courseId: targetCourseId || null,
      packageId: targetPackageId || null,
      ebookId: targetEbookId || null,
    };
    const cloned = await PackageCourseEbookPrice.create(payload);
    return res.status(201).json({ success: true, data: cloned });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
