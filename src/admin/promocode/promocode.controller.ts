import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { Goal } from "../../models/Goal.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import {
  PromotedPackageCourseEbook,
  PromotedPlanKind,
} from "../../models/course/PromotedPackageCourseEbook.model";
import {
  createPromocodeSchema,
  updatePromocodeSchema,
  togglePromocodeStatusSchema,
  bulkPromocodeIdsSchema,
  bulkPromocodeStatusSchema,
  AppliesToType,
  PlanLinkInput,
} from "./promocode.validation";
import { buildRegexCondition } from "../../utils/searchFilter";

const APPLIES_TO_MODEL = {
  package: Package,
  course: Course,
  liveCourse: LiveCourse,
} as const;

const APPLIES_TO_POPULATE_FIELDS = "_id name image";

// --- Plan resolution helpers -------------------------------------------------
// Package/course plans live in `PackageCourseEbookPrice` (kind "price"), keyed by
// packageId/courseId. Live-course plans live in `LiveCoursePlan` (kind "livePlan"),
// keyed by liveCourseId. Both expose duration/price; only "price" plans carry
// `withMaterial` (live plans are always treated as without-material).

const PLAN_KIND_BY_TYPE: Record<AppliesToType, PromotedPlanKind> = {
  package: "price",
  course: "price",
  liveCourse: "livePlan",
};

interface ResolvedPlan {
  id: string;
  entityId: string;
  duration: number;
  price: number;
  withMaterial: boolean;
  kind: PromotedPlanKind;
}

// Load every plan belonging to the given entities of `type`, normalized to the
// shape the picker UI and link persistence both need.
async function loadPlansForEntities(
  type: AppliesToType,
  entityIds: string[]
): Promise<ResolvedPlan[]> {
  if (!entityIds.length) return [];
  if (type === "liveCourse") {
    const rows = await LiveCoursePlan.find({
      liveCourseId: { $in: entityIds },
      status: true,
    })
      .select("_id liveCourseId duration price")
      .lean();
    return rows.map((r: any) => ({
      id: String(r._id),
      entityId: String(r.liveCourseId),
      duration: r.duration,
      price: r.price,
      withMaterial: false,
      kind: "livePlan" as const,
    }));
  }
  const key = type === "package" ? "packageId" : "courseId";
  const rows = await PackageCourseEbookPrice.find({
    [key]: { $in: entityIds },
    status: true,
  })
    .select(`_id ${key} duration price withMaterial`)
    .lean();
  return rows.map((r: any) => ({
    id: String(r._id),
    entityId: String(r[key]),
    duration: r.duration,
    price: r.price,
    withMaterial: !!r.withMaterial,
    kind: "price" as const,
  }));
}

async function assertAppliesToExists(appliesTo: { type: AppliesToType; ids: string[] }) {
  const Model = APPLIES_TO_MODEL[appliesTo.type] as any;
  const found = await Model.countDocuments({ _id: { $in: appliesTo.ids } });
  if (found !== appliesTo.ids.length) {
    throw Object.assign(new Error(`One or more ${appliesTo.type} ids do not exist`), {
      __badRequest: true,
    });
  }
}

async function populateAppliesTo(doc: any) {
  if (!doc?.appliesTo?.ids?.length) return doc;
  const Model = APPLIES_TO_MODEL[doc.appliesTo.type as AppliesToType] as any;
  if (!Model) return doc;
  const records = await Model.find({ _id: { $in: doc.appliesTo.ids } })
    .select(APPLIES_TO_POPULATE_FIELDS)
    .lean();
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  obj.appliesTo = { type: doc.appliesTo.type, ids: records };
  return obj;
}

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// Persist the per-plan promoter/customer split for a promocode using
// replace-semantics: rows in `plans` are upserted, links not present are removed.
// Orphan plans (whose parent entity isn't in `appliesTo.ids`) are silently
// dropped rather than rejected (TASK 2 #3). `validPlanIds` is the set of plan ids
// that actually belong to the saved entities, with their resolved kind.
async function syncPlanLinks(
  promocodeId: mongoose.Types.ObjectId,
  plans: PlanLinkInput[],
  validPlans: Map<string, ResolvedPlan>
) {
  const kept = plans.filter((p) => validPlans.has(p.planId));

  await Promise.all(
    kept.map((p) =>
      PromotedPackageCourseEbook.updateOne(
        { promocodeId, planId: p.planId },
        {
          $set: {
            planKind: validPlans.get(p.planId)!.kind,
            promoterPercentage: p.promoterPercentage,
            customerPercentage: p.customerPercentage,
          },
        },
        { upsert: true }
      )
    )
  );

  const keepIds = kept.map((p) => new mongoose.Types.ObjectId(p.planId));
  await PromotedPackageCourseEbook.deleteMany({
    promocodeId,
    planId: { $nin: keepIds },
  });
}

export const getPromocodes = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      type,
      fromDate,
      toDate,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    {
      const c = buildRegexCondition(search?.toUpperCase());
      if (c) filter.promocode = c;
    }
    if (status === "true" || status === "false") filter.status = status === "true";
    if (type === "public" || type === "private") filter.type = type;
    if (fromDate || toDate) {
      filter.promo_start_at = {};
      if (fromDate) filter.promo_start_at.$gte = new Date(fromDate);
      if (toDate) filter.promo_start_at.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      PromoCode.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      PromoCode.countDocuments(filter),
    ]);

    const data = rows.map((row: any) => ({
      ...row,
      appliesTo: row.appliesTo
        ? { type: row.appliesTo.type, count: row.appliesTo.ids?.length ?? 0 }
        : null,
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPromocodeById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const promo = await PromoCode.findById(id);
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });

    const populated = await populateAppliesTo(promo);
    const plans = await loadPlanLinks(promo._id as mongoose.Types.ObjectId);

    return res
      .status(200)
      .json({ success: true, data: { promocode: populated, plans } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Build the populated `plans[]` link array for the edit screen (TASK 3). Each
// row carries both percentages and a `planId` populated with duration/price/
// withMaterial plus the parent entity { _id, name }, matching the shape the
// frontend `toPlanLink` parser expects.
async function loadPlanLinks(promocodeId: mongoose.Types.ObjectId) {
  const links = await PromotedPackageCourseEbook.find({ promocodeId }).lean();
  if (!links.length) return [];

  const priceIds = links.filter((l: any) => l.planKind !== "livePlan").map((l: any) => l.planId);
  const liveIds = links.filter((l: any) => l.planKind === "livePlan").map((l: any) => l.planId);

  const [priceRows, liveRows] = await Promise.all([
    priceIds.length
      ? PackageCourseEbookPrice.find({ _id: { $in: priceIds } })
          .select("_id duration price withMaterial packageId courseId ebookId")
          .lean()
      : [],
    liveIds.length
      ? LiveCoursePlan.find({ _id: { $in: liveIds } })
          .select("_id duration price liveCourseId")
          .lean()
      : [],
  ]);

  // Resolve parent entity names in one pass per collection.
  const pkgIds = priceRows.filter((r: any) => r.packageId).map((r: any) => r.packageId);
  const courseIds = priceRows.filter((r: any) => r.courseId).map((r: any) => r.courseId);
  const liveCourseIds = liveRows.map((r: any) => r.liveCourseId);

  const [pkgs, courses, liveCourses] = await Promise.all([
    pkgIds.length ? Package.find({ _id: { $in: pkgIds } }).select("_id name").lean() : [],
    courseIds.length ? Course.find({ _id: { $in: courseIds } }).select("_id name").lean() : [],
    liveCourseIds.length
      ? LiveCourse.find({ _id: { $in: liveCourseIds } }).select("_id name").lean()
      : [],
  ]);

  const nameOf = (list: any[]) =>
    new Map(list.map((d: any) => [String(d._id), { _id: d._id, name: d.name }]));
  const pkgMap = nameOf(pkgs);
  const courseMap = nameOf(courses);
  const liveMap = nameOf(liveCourses);

  const priceMap = new Map(priceRows.map((r: any) => [String(r._id), r]));
  const liveMapRows = new Map(liveRows.map((r: any) => [String(r._id), r]));

  return links.map((l: any) => {
    let planId: any = null;
    if (l.planKind === "livePlan") {
      const r = liveMapRows.get(String(l.planId));
      if (r) {
        planId = {
          _id: r._id,
          duration: r.duration,
          price: r.price,
          withMaterial: false,
          liveCourse: liveMap.get(String(r.liveCourseId)) ?? null,
        };
      }
    } else {
      const r = priceMap.get(String(l.planId));
      if (r) {
        planId = {
          _id: r._id,
          duration: r.duration,
          price: r.price,
          withMaterial: !!r.withMaterial,
        };
        if (r.packageId) planId.packageId = pkgMap.get(String(r.packageId)) ?? null;
        else if (r.courseId) planId.courseId = courseMap.get(String(r.courseId)) ?? null;
      }
    }
    return {
      _id: l._id,
      planId,
      promoterPercentage: l.promoterPercentage,
      customerPercentage: l.customerPercentage,
    };
  });
}

export const createPromocode = async (req: Request, res: Response) => {
  try {
    const data = createPromocodeSchema.parse(req.body);
    const code = data.promocode.toUpperCase();

    const exists = await PromoCode.findOne({ promocode: code });
    if (exists)
      return res.status(409).json({ success: false, message: "Promocode already exists." });

    await assertAppliesToExists(data.appliesTo);

    const promo = await PromoCode.create({
      promocode: code,
      title: data.title,
      description: data.description,
      promo_start_at: new Date(data.promo_start_at),
      promo_expire_at: new Date(data.promo_expire_at),
      type: data.type,
      status: data.status ?? true,
      discountType: data.discountType,
      discountValue: data.discountValue,
      promoterId: data.promoterId || null,
      appliesTo: { type: data.appliesTo.type, ids: data.appliesTo.ids },
    });

    if (data.plans.length) {
      const resolved = await loadPlansForEntities(data.appliesTo.type, data.appliesTo.ids);
      const validPlans = new Map(resolved.map((p) => [p.id, p]));
      await syncPlanLinks(promo._id as mongoose.Types.ObjectId, data.plans, validPlans);
    }

    return res.status(201).json({ success: true, data: promo });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.__badRequest)
      return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const data = updatePromocodeSchema.parse(req.body);

    const existing = await PromoCode.findById(id);
    if (!existing)
      return res.status(404).json({ success: false, message: "Promocode not found." });

    const update: any = { ...data };
    delete update.plans; // links live in their own collection, not on the promo doc
    if (data.promocode) update.promocode = data.promocode.toUpperCase();
    if (data.promo_start_at) update.promo_start_at = new Date(data.promo_start_at);
    if (data.promo_expire_at) update.promo_expire_at = new Date(data.promo_expire_at);

    if (data.appliesTo) {
      await assertAppliesToExists(data.appliesTo);
      update.appliesTo = { type: data.appliesTo.type, ids: data.appliesTo.ids };
    } else {
      delete update.appliesTo;
    }

    const promo = await PromoCode.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });

    // Replace-semantics on plan links. Validate plan ids against the *effective*
    // appliesTo (the just-saved value, or the existing one if appliesTo wasn't
    // part of this update).
    if (data.plans !== undefined) {
      const effective = promo.appliesTo;
      const type = effective?.type as AppliesToType | undefined;
      const ids = (effective?.ids ?? []).map((x: any) => String(x));
      const resolved = type ? await loadPlansForEntities(type, ids) : [];
      const validPlans = new Map(resolved.map((p) => [p.id, p]));
      await syncPlanLinks(promo._id as mongoose.Types.ObjectId, data.plans, validPlans);
    } else if (data.appliesTo) {
      // appliesTo changed but plans omitted: drop links whose parent entity is no
      // longer covered, so stale percentages don't linger.
      const resolved = await loadPlansForEntities(
        data.appliesTo.type,
        data.appliesTo.ids
      );
      const validIds = resolved.map((p) => new mongoose.Types.ObjectId(p.id));
      await PromotedPackageCourseEbook.deleteMany({
        promocodeId: promo._id,
        planId: { $nin: validIds },
      });
    }

    return res.status(200).json({ success: true, data: promo });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.__badRequest)
      return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const deleted = await PromoCode.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Promocode not found." });

    await PromotedPackageCourseEbook.deleteMany({ promocodeId: id });

    return res.status(200).json({ success: true, message: "Promocode deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePromocodeStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const parsed = togglePromocodeStatusSchema.safeParse(req.body);
    let nextStatus: boolean;
    if (parsed.success) {
      nextStatus = parsed.data.status;
    } else {
      const promo = await PromoCode.findById(id).select("status");
      if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });
      nextStatus = !promo.status;
    }

    const promo = await PromoCode.findByIdAndUpdate(
      id,
      { $set: { status: nextStatus } },
      { new: true }
    );
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });
    return res.status(200).json({ success: true, data: { status: promo.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkPromocodeStatusSchema.parse(req.body);
    const valid = ids.filter(isObjectId);
    if (!valid.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    const result = await PromoCode.updateMany(
      { _id: { $in: valid } },
      { $set: { status } }
    );
    return res
      .status(200)
      .json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkPromocodeIdsSchema.parse(req.body);
    const valid = ids.filter(isObjectId);
    if (!valid.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    await PromoCode.deleteMany({ _id: { $in: valid } });
    await PromotedPackageCourseEbook.deleteMany({ promocodeId: { $in: valid } });
    return res.status(200).json({ success: true, message: "Promocodes deleted." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// TASK 1: return plans grouped by their parent entity, plus the exam-type list
// the bulk toolbar filters on. Only packages carry an exam type (their
// `goalLabelId` resolved against `Goal.labels`); courses/liveCourses have none
// and fall into the client-side "Ungrouped" bucket (field omitted).
export const getPromocodePlans = async (req: Request, res: Response) => {
  try {
    const { type, examTypeId, search } = req.query as Record<string, string>;

    const requested: AppliesToType[] =
      type === "package" || type === "course" || type === "liveCourse"
        ? [type]
        : ["package", "course", "liveCourse"];

    // Build the goalLabel -> name map (packages' exam types) once.
    const goals = await Goal.find({}).select("_id title labels").lean();
    const labelName = new Map<string, string>();
    for (const g of goals as any[]) {
      for (const lbl of g.labels ?? []) labelName.set(String(lbl._id), lbl.name);
    }

    const nameCondition = buildRegexCondition(search);
    const nameFilter = nameCondition ? { name: nameCondition } : {};

    const entities: any[] = [];
    const examTypes = new Map<string, string>();

    for (const t of requested) {
      const Model = APPLIES_TO_MODEL[t] as any;
      // Package uses `active`; course/liveCourse use `status`. Don't over-filter:
      // load all matching the name filter so the picker can still show them.
      const docs = await Model.find(nameFilter)
        .select(t === "package" ? "_id name goalLabelId" : "_id name")
        .lean();
      if (!docs.length) continue;

      const ids = docs.map((d: any) => String(d._id));
      const plans = await loadPlansForEntities(t, ids);
      const plansByEntity = new Map<string, ResolvedPlan[]>();
      for (const p of plans) {
        if (!plansByEntity.has(p.entityId)) plansByEntity.set(p.entityId, []);
        plansByEntity.get(p.entityId)!.push(p);
      }

      for (const d of docs as any[]) {
        const entityPlans = plansByEntity.get(String(d._id));
        if (!entityPlans?.length) continue; // only entities with >= 1 plan

        const labelId = t === "package" && d.goalLabelId ? String(d.goalLabelId) : null;
        const examName = labelId ? labelName.get(labelId) : undefined;

        // Apply the examTypeId filter (packages only; others have no exam type).
        if (examTypeId && labelId !== examTypeId) continue;

        if (labelId && examName) examTypes.set(labelId, examName);

        const entity: any = {
          id: String(d._id),
          name: d.name,
          type: t,
          plans: entityPlans.map((p) => ({
            id: p.id,
            duration: p.duration,
            price: p.price,
            withMaterial: p.withMaterial,
          })),
        };
        if (labelId && examName) {
          entity.examTypeId = labelId;
          entity.examTypeName = examName;
        }
        entities.push(entity);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        examTypes: Array.from(examTypes, ([id, name]) => ({ id, name })),
        entities,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
