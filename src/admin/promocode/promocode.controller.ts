import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import { TestSeriesPrice } from "../../models/testSeries/TestSeriesPrice.model";
import { Goal } from "../../models/Goal.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
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
import * as pcSql from "../../modules/promo-code/promo-code.service";

const APPLIES_TO_MODEL = {
  package: Package,
  course: Course,
  liveCourse: LiveCourse,
  ebook: Ebook,
  testSeries: TestSeries,
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
  ebook: "price",
  testSeries: "price",
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
  if (type === "ebook") {
    // Ebook plans live in their OWN collection (EbookPrice / ws_ebook_prices),
    // keyed by ebookId — NOT PackageCourseEbookPrice (which carries zero ebook
    // rows). Mirror the live-course branch.
    const rows = await EbookPrice.find({
      ebookId: { $in: entityIds },
      status: true,
    })
      .select("_id ebookId duration price")
      .lean();
    return rows.map((r: any) => ({
      id: String(r._id),
      entityId: String(r.ebookId),
      duration: r.duration,
      price: r.price,
      withMaterial: false,
      kind: "price" as const,
    }));
  }
  if (type === "testSeries") {
    // Test-series plans live in TestSeriesPrice (ws_test_series_prices), keyed by
    // testSeriesId. Their duration field is `durationDays` — normalise to the
    // common `duration` the picker UI expects.
    const rows = await TestSeriesPrice.find({
      testSeriesId: { $in: entityIds },
      status: true,
    })
      .select("_id testSeriesId durationDays price")
      .lean();
    return rows.map((r: any) => ({
      id: String(r._id),
      entityId: String(r.testSeriesId),
      duration: r.durationDays,
      price: r.price,
      withMaterial: false,
      kind: "price" as const,
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
  const type = doc.appliesTo.type as AppliesToType;
  const Model = APPLIES_TO_MODEL[type] as any;
  if (!Model) return doc;
  // TestSeries' display field is `title`; pull it and normalise to `name` so the
  // populated shape (`{ _id, name, image }`) is identical across all types and
  // the FE edit form rehydrates uniformly.
  const selectFields = type === "testSeries" ? "_id title thumbnail" : APPLIES_TO_POPULATE_FIELDS;
  const records = await Model.find({ _id: { $in: doc.appliesTo.ids } })
    .select(selectFields)
    .lean();
  const normalised =
    type === "testSeries"
      ? records.map((r: any) => ({ _id: r._id, name: r.title ?? null, image: r.thumbnail ?? null }))
      : records;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  obj.appliesTo = { type: doc.appliesTo.type, ids: normalised };
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

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    if (pcSql.isPromoCodeMysql()) {
      const r = await pcSql.listPromocodes({
        search: search?.trim() || null,
        status: status === "true" ? true : status === "false" ? false : null,
        type: type === "public" || type === "private" ? type : null,
        fromDate: fromDate ? new Date(fromDate) : null,
        toDate: toDate ? new Date(toDate) : null,
        skip,
        limitNum,
        pageNum,
      });
      return res.status(200).json({ success: true, ...r });
    }

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

    if (pcSql.isPromoCodeMysql()) {
      const nid = pcSql.parsePcId(id);
      if (nid == null)
        return res.status(400).json({ success: false, message: "Invalid promocode id." });
      const r = await pcSql.getPromocodeById(nid);
      if ((r as any).notFound)
        return res.status(404).json({ success: false, message: "Promocode not found." });
      // C5: real plan-link `plans[]` for the edit screen.
      const plans = await pcSql.loadPlanLinksSql(nid);
      return res
        .status(200)
        .json({ success: true, data: { ...(r as any).data, plans } });
    }

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

  // `planKind === "price"` is intentionally coarse: package/course plans live in
  // PackageCourseEbookPrice, BUT ebook plans live in EbookPrice and test-series
  // plans in TestSeriesPrice (all stored as kind "price"). So a price-kind link
  // must be resolved against ALL THREE collections, or ebook/testSeries links
  // come back with planId: null. We normalise each to a common row shape.
  const [pkgCourseRows, ebookRows, tsRows, liveRows] = await Promise.all([
    priceIds.length
      ? PackageCourseEbookPrice.find({ _id: { $in: priceIds } })
          .select("_id duration price withMaterial packageId courseId ebookId")
          .lean()
      : [],
    priceIds.length
      ? EbookPrice.find({ _id: { $in: priceIds } }).select("_id duration price ebookId").lean()
      : [],
    priceIds.length
      ? TestSeriesPrice.find({ _id: { $in: priceIds } })
          .select("_id durationDays price testSeriesId")
          .lean()
      : [],
    liveIds.length
      ? LiveCoursePlan.find({ _id: { $in: liveIds } })
          .select("_id duration price liveCourseId")
          .lean()
      : [],
  ]);

  // Resolve parent entity names in one pass per collection.
  const pkgIds = pkgCourseRows.filter((r: any) => r.packageId).map((r: any) => r.packageId);
  const courseIds = pkgCourseRows.filter((r: any) => r.courseId).map((r: any) => r.courseId);
  const ebookIds = ebookRows.map((r: any) => r.ebookId);
  const tsIds = tsRows.map((r: any) => r.testSeriesId);
  const liveCourseIds = liveRows.map((r: any) => r.liveCourseId);

  const [pkgs, courses, ebooks, testSeriesList, liveCourses] = await Promise.all([
    pkgIds.length ? Package.find({ _id: { $in: pkgIds } }).select("_id name").lean() : [],
    courseIds.length ? Course.find({ _id: { $in: courseIds } }).select("_id name").lean() : [],
    ebookIds.length ? Ebook.find({ _id: { $in: ebookIds } }).select("_id name").lean() : [],
    tsIds.length ? TestSeries.find({ _id: { $in: tsIds } }).select("_id title").lean() : [],
    liveCourseIds.length
      ? LiveCourse.find({ _id: { $in: liveCourseIds } }).select("_id name").lean()
      : [],
  ]);

  const nameOf = (list: any[]) =>
    new Map(list.map((d: any) => [String(d._id), { _id: d._id, name: d.name }]));
  const pkgMap = nameOf(pkgs);
  const courseMap = nameOf(courses);
  const ebookMap = nameOf(ebooks);
  // TestSeries' display field is `title`; normalise to `name` for a uniform shape.
  const tsMap = new Map(
    testSeriesList.map((d: any) => [String(d._id), { _id: d._id, name: d.title ?? null }])
  );
  const liveMap = nameOf(liveCourses);

  const pkgCourseMap = new Map(pkgCourseRows.map((r: any) => [String(r._id), r]));
  const ebookPriceMap = new Map(ebookRows.map((r: any) => [String(r._id), r]));
  const tsPriceMap = new Map(tsRows.map((r: any) => [String(r._id), r]));
  const liveMapRows = new Map(liveRows.map((r: any) => [String(r._id), r]));

  return links.map((l: any) => {
    let planId: any = null;
    const key = String(l.planId);
    if (l.planKind === "livePlan") {
      const r = liveMapRows.get(key);
      if (r) {
        planId = {
          _id: r._id,
          duration: r.duration,
          price: r.price,
          withMaterial: false,
          liveCourse: liveMap.get(String(r.liveCourseId)) ?? null,
        };
      }
    } else if (pkgCourseMap.has(key)) {
      const r: any = pkgCourseMap.get(key);
      planId = { _id: r._id, duration: r.duration, price: r.price, withMaterial: !!r.withMaterial };
      if (r.packageId) planId.packageId = pkgMap.get(String(r.packageId)) ?? null;
      else if (r.courseId) planId.courseId = courseMap.get(String(r.courseId)) ?? null;
    } else if (ebookPriceMap.has(key)) {
      const r: any = ebookPriceMap.get(key);
      planId = {
        _id: r._id,
        duration: r.duration,
        price: r.price,
        withMaterial: false,
        ebookId: ebookMap.get(String(r.ebookId)) ?? null,
      };
    } else if (tsPriceMap.has(key)) {
      const r: any = tsPriceMap.get(key);
      planId = {
        _id: r._id,
        duration: r.durationDays,
        price: r.price,
        withMaterial: false,
        testSeriesId: tsMap.get(String(r.testSeriesId)) ?? null,
      };
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

    if (pcSql.isPromoCodeMysql()) {
      const ids = data.appliesTo.ids.map((x) => Number(x));
      if (ids.some((n) => !Number.isInteger(n) || n <= 0))
        return res.status(400).json({ success: false, message: "Invalid appliesTo ids." });
      const promoterId = data.promoterId != null ? pcSql.parsePcId(data.promoterId) : null;
      try {
        const r = await pcSql.createPromocode({
          promocode: code,
          title: data.title,
          description: data.description,
          promo_start_at: new Date(data.promo_start_at),
          promo_expire_at: new Date(data.promo_expire_at),
          type: data.type,
          status: data.status ?? true,
          discountType: data.discountType,
          discountValue: data.discountValue,
          promoterId,
          appliesTo: { type: data.appliesTo.type, ids },
        });
        if ((r as any).conflict)
          return res.status(409).json({ success: false, message: "Promocode already exists." });
        // C5: real plan-link % sync (replaces the prior stub).
        if (data.plans.length) {
          const nid = pcSql.parsePcId(String((r as any).data._id));
          if (nid != null) {
            const validPlans = await pcSql.resolveValidPlansSql(data.appliesTo.type, ids);
            await pcSql.syncPlanLinksSql(nid, data.plans, validPlans);
          }
        }
        return res.status(201).json({ success: true, data: (r as any).data });
      } catch (e: any) {
        if (e.__badRequest)
          return res.status(400).json({ success: false, message: e.message });
        throw e;
      }
    }

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
    const data = updatePromocodeSchema.parse(req.body);

    if (pcSql.isPromoCodeMysql()) {
      const nid = pcSql.parsePcId(id);
      if (nid == null)
        return res.status(400).json({ success: false, message: "Invalid promocode id." });

      let appliesTo: { type: pcSql.AppliesToType; ids: number[] } | undefined;
      if (data.appliesTo) {
        const ids = data.appliesTo.ids.map((x) => Number(x));
        if (ids.some((n) => !Number.isInteger(n) || n <= 0))
          return res.status(400).json({ success: false, message: "Invalid appliesTo ids." });
        appliesTo = { type: data.appliesTo.type, ids };
      }
      const promoterId =
        data.promoterId === undefined
          ? undefined
          : data.promoterId == null
          ? null
          : pcSql.parsePcId(data.promoterId);

      try {
        const r = await pcSql.updatePromocode(nid, {
          promocode: data.promocode,
          title: data.title,
          description: data.description,
          promo_start_at: data.promo_start_at ? new Date(data.promo_start_at) : undefined,
          promo_expire_at: data.promo_expire_at ? new Date(data.promo_expire_at) : undefined,
          type: data.type,
          status: data.status,
          discountType: data.discountType,
          discountValue: data.discountValue,
          promoterId,
          appliesTo,
        });
        if ((r as any).notFound)
          return res.status(404).json({ success: false, message: "Promocode not found." });
        if ((r as any).conflict)
          return res.status(409).json({ success: false, message: "Promocode already exists." });
        // C5: real plan-link % replace-semantics, mirroring the Mongo branch.
        // Resolve the *effective* appliesTo (the just-saved value if appliesTo
        // was part of this update, else the existing row's).
        const effective = await pcSql.getPromocodeById(nid);
        // getPromocodeById returns { data: { promocode, plans } } — the resolved
        // appliesTo lives on `data.promocode.appliesTo`, NOT `data.appliesTo`.
        const effAppliesTo = (effective as any).data?.promocode?.appliesTo;
        const effType = effAppliesTo?.type as pcSql.AppliesToType | undefined;
        const effIds = (effAppliesTo?.ids ?? [])
          .map((x: any) => Number(x?._id ?? x))
          .filter((n: number) => Number.isInteger(n) && n > 0);
        if (data.plans !== undefined) {
          const validPlans = effType
            ? await pcSql.resolveValidPlansSql(effType, effIds)
            : new Map();
          await pcSql.syncPlanLinksSql(nid, data.plans, validPlans);
        } else if (appliesTo) {
          // appliesTo changed but plans omitted: drop now-orphaned links.
          const resolved = await pcSql.loadPlansForEntitiesSql(appliesTo.type, appliesTo.ids);
          await pcSql.prunePlanLinksSql(
            nid,
            resolved.map((p) => p.id)
          );
        }
        return res.status(200).json({ success: true, data: (r as any).data });
      } catch (e: any) {
        if (e.__badRequest)
          return res.status(400).json({ success: false, message: e.message });
        throw e;
      }
    }

    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

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

    if (pcSql.isPromoCodeMysql()) {
      const nid = pcSql.parsePcId(id);
      if (nid == null)
        return res.status(400).json({ success: false, message: "Invalid promocode id." });
      // Drop plan links first (FK-safe), then the rule. Mirrors Mongo cleanup.
      await pcSql.deletePlanLinksSql([nid]);
      const r = await pcSql.deletePromocode(nid);
      if ((r as any).notFound)
        return res.status(404).json({ success: false, message: "Promocode not found." });
      return res.status(200).json({ success: true, message: "Promocode deleted." });
    }

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
    const parsed = togglePromocodeStatusSchema.safeParse(req.body);

    if (pcSql.isPromoCodeMysql()) {
      const nid = pcSql.parsePcId(id);
      if (nid == null)
        return res.status(400).json({ success: false, message: "Invalid promocode id." });
      const r = await pcSql.toggleStatus(nid, parsed.success ? parsed.data.status : null);
      if ((r as any).notFound)
        return res.status(404).json({ success: false, message: "Promocode not found." });
      return res.status(200).json({ success: true, data: (r as any).data });
    }

    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

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

    if (pcSql.isPromoCodeMysql()) {
      const nids = ids.map((x) => pcSql.parsePcId(x)).filter((n): n is number => n != null);
      if (!nids.length)
        return res.status(400).json({ success: false, message: "No valid ids." });
      const r = await pcSql.bulkStatus(nids, status);
      return res.status(200).json({ success: true, matched: r.matched, modified: r.modified });
    }

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

    if (pcSql.isPromoCodeMysql()) {
      const nids = ids.map((x) => pcSql.parsePcId(x)).filter((n): n is number => n != null);
      if (!nids.length)
        return res.status(400).json({ success: false, message: "No valid ids." });
      await pcSql.deletePlanLinksSql(nids);
      await pcSql.bulkDelete(nids);
      return res.status(200).json({ success: true, message: "Promocodes deleted." });
    }

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
    const { type, examTypeId, goalId, search } = req.query as Record<string, string>;

    if (pcSql.isPromoCodeMysql()) {
      const data = await pcSql.getPromocodePlansSql({ type, examTypeId, search });
      return res.status(200).json({ success: true, data });
    }

    const ALL_TYPES: AppliesToType[] = ["package", "course", "liveCourse", "ebook", "testSeries"];
    const requested: AppliesToType[] = ALL_TYPES.includes(type as AppliesToType)
      ? [type as AppliesToType]
      : ALL_TYPES;

    // Build goal lookups once:
    //  - labelName:  goalLabelId -> label name   (legacy `examType*`, packages)
    //  - goalTitle:  goalId      -> goal title    (new `goalName`)
    //  - labelToGoal: goalLabelId -> goalId       (fallback when a package set
    //                 goalLabelId but not the top-level goalId)
    // NOTE: only Package carries any goal link in the schema. Course / LiveCourse
    // / Ebook / TestSeries have NO goal field, so they never get goalId and fall
    // into the FE's "Ungrouped" bucket. This is a data-model limit, not a bug.
    const goals = await Goal.find({}).select("_id title labels").lean();
    const labelName = new Map<string, string>();
    const goalTitle = new Map<string, string>();
    const labelToGoal = new Map<string, string>();
    for (const g of goals as any[]) {
      goalTitle.set(String(g._id), g.title);
      for (const lbl of g.labels ?? []) {
        labelName.set(String(lbl._id), lbl.name);
        labelToGoal.set(String(lbl._id), String(g._id));
      }
    }

    const nameCondition = buildRegexCondition(search);

    const entities: any[] = [];
    const examTypes = new Map<string, string>();

    for (const t of requested) {
      const Model = APPLIES_TO_MODEL[t] as any;
      // TestSeries names its display field `title`; every other entity uses
      // `name`. Search + select the right field per type, then normalise to
      // `name` in the output below so the picker shape stays uniform.
      const nameField = t === "testSeries" ? "title" : "name";
      const nameFilter = nameCondition ? { [nameField]: nameCondition } : {};
      // Package uses `active`; course/liveCourse use `status`. Don't over-filter:
      // load all matching the name filter so the picker can still show them.
      const docs = await Model.find(nameFilter)
        .select(
          t === "package"
            ? "_id name goalLabelId goalId"
            : t === "testSeries"
            ? "_id title"
            : "_id name"
        )
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

        // Resolve the entity's goal (packages only). Prefer the explicit
        // top-level goalId; fall back to deriving it from goalLabelId so a
        // package that only set the label still groups correctly. The result
        // matches the ids returned by GET /admin/goals.
        const resolvedGoalId =
          t === "package"
            ? d.goalId
              ? String(d.goalId)
              : labelId
              ? labelToGoal.get(labelId) ?? null
              : null
            : null;
        const goalName = resolvedGoalId ? goalTitle.get(resolvedGoalId) : undefined;

        // Apply the examTypeId filter (packages only; others have no exam type).
        if (examTypeId && labelId !== examTypeId) continue;
        // Apply the optional goalId filter (packages only; others have no goal).
        if (goalId && resolvedGoalId !== goalId) continue;

        if (labelId && examName) examTypes.set(labelId, examName);

        const entity: any = {
          id: String(d._id),
          name: t === "testSeries" ? d.title : d.name,
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
        // Per FE contract: omit goalId entirely when absent → entity is
        // "Ungrouped" and shows only under "All exam goals".
        if (resolvedGoalId) {
          entity.goalId = resolvedGoalId;
          if (goalName) entity.goalName = goalName;
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
