// src/admin/package/package.service.ts
//
// Domain logic for admin package endpoints. Same shape as course.service.ts:
//   - `.lean()` + explicit `.select()` on every read.
//   - Multi-document writes wrapped in `session.withTransaction`.
//   - Hot reads (list, detail) cached via `cache.aside`; writes invalidate.
//   - Errors thrown as `HttpError(code, message)` for the global handler.

import mongoose, { Types } from "mongoose";
import { Package } from "../../models/course/Package.model";
import { ExamCountdownCategory } from "../../models/examCountdown/ExamCountdownCategory.model";
import { ExamCountdown } from "../../models/examCountdown/ExamCountdown.model";
import { PackageType } from "../../models/course/PackageType.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PackageChat } from "../../models/course/PackageChat.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Goal } from "../../models/Goal.model";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} id.`);
  }
};

// Validates the two exam-countdown arrays: each id is a valid ObjectId and
// exists in its respective collection. Skips checks for undefined inputs so
// it composes with both create (defaults to []) and update (partial) flows.
const assertExamCountdownArrays = async (
  categoryIds: string[] | undefined,
  countdownIds: string[] | undefined
): Promise<void> => {
  if (categoryIds?.length) {
    if (categoryIds.some((id) => !mongoose.Types.ObjectId.isValid(id)))
      throw new HttpError(400, "Invalid examCountdownCategoryIds entry.");
    const count = await ExamCountdownCategory.countDocuments({ _id: { $in: categoryIds } });
    if (count !== new Set(categoryIds).size)
      throw new HttpError(400, "One or more examCountdownCategoryIds do not exist.");
  }
  if (countdownIds?.length) {
    if (countdownIds.some((id) => !mongoose.Types.ObjectId.isValid(id)))
      throw new HttpError(400, "Invalid examCountdownIds entry.");
    const count = await ExamCountdown.countDocuments({ _id: { $in: countdownIds } });
    if (count !== new Set(countdownIds).size)
      throw new HttpError(400, "One or more examCountdownIds do not exist.");
  }
};

const slugifyTopic = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const toCategoryRefs = (
  items?: Array<{ category: string; order?: number; status?: boolean }>
) =>
  items
    ? items.map((i) => ({
        category: new Types.ObjectId(i.category),
        order: i.order ?? 0,
        status: i.status ?? true,
      }))
    : undefined;

/**
 * Validates that, when goalLabelId is supplied, goalId is also supplied AND
 * the label _id exists inside that goal's labels[]. Throws HttpError on
 * violation; resolves silently on success or when label not supplied.
 */
const assertGoalLabelPair = async (
  goalId: string | null | undefined,
  goalLabelId: string | null | undefined
): Promise<void> => {
  if (!goalLabelId) return;
  if (!goalId) throw new HttpError(400, "goalId is required when goalLabelId is provided.");
  if (!mongoose.Types.ObjectId.isValid(goalId)) throw new HttpError(400, "Invalid goalId.");
  if (!mongoose.Types.ObjectId.isValid(goalLabelId))
    throw new HttpError(400, "Invalid goalLabelId.");
  const goal = await Goal.findById(goalId).select("labels._id").lean();
  if (!goal) throw new HttpError(404, "Goal not found for the supplied goalId.");
  const owns = (goal.labels ?? []).some((l: any) => l._id?.toString() === goalLabelId);
  if (!owns) throw new HttpError(400, "goalLabelId does not belong to the supplied goalId.");
};

// Cache keys ──────────────────────────────────────────────────────────────────
const packageListKey = (filter: any, page: number, limit: number) =>
  cache.key(
    "admin",
    "package",
    `list:${cache.hashFilter({ filter, page, limit })}`
  );
const packageDetailKey = (id: string) => cache.key("admin", "package", `detail:${id}`);

const invalidatePackageCaches = async (packageId?: string) => {
  const keys: string[] = [];
  if (packageId) keys.push(packageDetailKey(packageId));
  await Promise.all([
    cache.invalidate(...keys),
    cache.invalidateByPrefix(cache.keyPrefix("admin", "package", "list:")),
  ]);
};

// ──────────────────────────────────────────────────────────────────────────────
// Package types (small master)
// ──────────────────────────────────────────────────────────────────────────────

export const listPackageTypes = async () =>
  PackageType.find().sort({ order: 1, name: 1 }).lean();

export const createPackageType = async (validated: any) => {
  const pt = await PackageType.create(validated);
  return pt.toObject();
};

export const updatePackageType = async (id: string, validated: any) => {
  assertObjectId(id, "package type");
  const pt = await PackageType.findByIdAndUpdate(id, { $set: validated }, { new: true }).lean();
  if (!pt) throw new HttpError(404, "Package type not found.");
  return pt;
};

export const deletePackageType = async (id: string) => {
  assertObjectId(id, "package type");
  const inUse = await Package.countDocuments({ packageTypeId: id });
  if (inUse > 0) {
    throw new HttpError(400, "Package type is in use; reassign packages first.");
  }
  await PackageType.findByIdAndDelete(id);
};

// ──────────────────────────────────────────────────────────────────────────────
// Packages CRUD
// ──────────────────────────────────────────────────────────────────────────────

export interface ListPackagesQuery {
  search?: string;
  active?: string;
  isPaid?: string;
  packageTypeId?: string;
  goalId?: string;
  page?: string;
  limit?: string;
}

export const listPackages = async (query: ListPackagesQuery) => {
  const {
    search,
    active,
    isPaid,
    packageTypeId,
    goalId,
    page = "1",
    limit = "20",
  } = query;

  const filter: any = {};
  if (search) filter.name = { $regex: search, $options: "i" };
  if (active === "true" || active === "false") filter.active = active === "true";
  if (isPaid === "true" || isPaid === "false") filter.isPaid = isPaid === "true";
  if (packageTypeId && mongoose.Types.ObjectId.isValid(packageTypeId))
    filter.packageTypeId = packageTypeId;
  if (goalId && mongoose.Types.ObjectId.isValid(goalId)) filter.goalId = goalId;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  return cache.aside({
    key: packageListKey(filter, pageNum, limitNum),
    ttlSeconds: 300,
    load: async () => {
      const [packages, total] = await Promise.all([
        Package.find(filter)
          .populate("packageTypeId", "_id name")
          // Newest-first so the admin list matches the client "Recently Added"
          // section — a just-created package always surfaces at the top of
          // page 1 instead of being buried among other order-0 rows.
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Package.countDocuments(filter),
      ]);

      // Attach each package's active price plans (split into withMaterial /
      // withoutMaterial, same shape the client listing uses) so the list row
      // can show pricing/type without a second call.
      const packageIds = packages.map((p: any) => p._id);
      const plans = packageIds.length
        ? await PackageCourseEbookPrice.find({ packageId: { $in: packageIds }, status: true })
            .sort({ duration: 1 })
            .lean()
        : [];
      const plansByPackage = new Map<string, { withMaterial: any[]; withoutMaterial: any[] }>();
      for (const p of plans as any[]) {
        const key = String(p.packageId);
        let bucket = plansByPackage.get(key);
        if (!bucket) {
          bucket = { withMaterial: [], withoutMaterial: [] };
          plansByPackage.set(key, bucket);
        }
        (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
      }

      const data = packages.map((p: any) => ({
        ...p,
        plans: plansByPackage.get(String(p._id)) ?? { withMaterial: [], withoutMaterial: [] },
      }));

      return {
        data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    },
  });
};

export const getPackageById = async (id: string) => {
  assertObjectId(id, "package");
  return cache.aside({
    key: packageDetailKey(id),
    ttlSeconds: 300,
    load: async () => {
      const pkg = await Package.findById(id)
        .populate("packageTypeId", "_id name")
        .populate("examCountdownCategoryIds", "_id name colorHex")
        .populate("examCountdownIds", "_id title examDate")
        .populate("packageCategoryId", "_id title slug image")
        .populate("educatorId", "_id name")
        .populate("specificSubjects.category", "_id title image")
        .populate("materialCategories.category", "_id title image")
        .populate("examCategories.category", "_id title image")
        .lean();
      if (!pkg) throw new HttpError(404, "Package not found.");
      return pkg;
    },
  });
};

export const createPackage = async (validated: any) => {
  await assertGoalLabelPair(validated.goalId, validated.goalLabelId);
  if (
    validated.packageCategoryId &&
    !mongoose.Types.ObjectId.isValid(validated.packageCategoryId)
  )
    throw new HttpError(400, "Invalid packageCategoryId.");
  await assertExamCountdownArrays(validated.examCountdownCategoryIds, validated.examCountdownIds);

  const payload: any = {
    ...validated,
    packageTypeId: validated.packageTypeId || null,
    goalId: validated.goalId || null,
    goalLabelId: validated.goalLabelId || null,
    examCountdownCategoryIds: validated.examCountdownCategoryIds ?? [],
    examCountdownIds: validated.examCountdownIds ?? [],
    packageCategoryId: validated.packageCategoryId || null,
    educatorId: validated.educatorId || null,
    specificSubjects: toCategoryRefs(validated.specificSubjects) ?? [],
    materialCategories: toCategoryRefs(validated.materialCategories) ?? [],
    examCategories: toCategoryRefs(validated.examCategories) ?? [],
    notificationTopic: validated.notificationTopic || slugifyTopic(validated.name),
  };

  const pkg = await Package.create(payload);
  await invalidatePackageCaches();
  return pkg.toObject();
};

export const updatePackage = async (id: string, validated: any) => {
  assertObjectId(id, "package");

  if (validated.goalId !== undefined || validated.goalLabelId !== undefined) {
    const existing = await Package.findById(id).select("goalId goalLabelId").lean();
    const nextGoalId =
      validated.goalId !== undefined
        ? validated.goalId
        : existing?.goalId?.toString() ?? null;
    const nextLabelId =
      validated.goalLabelId !== undefined
        ? validated.goalLabelId
        : existing?.goalLabelId?.toString() ?? null;
    await assertGoalLabelPair(nextGoalId, nextLabelId);
  }

  const update: any = { ...validated };
  if (validated.packageTypeId !== undefined)
    update.packageTypeId = validated.packageTypeId || null;
  if (validated.goalId !== undefined) update.goalId = validated.goalId || null;
  if (validated.goalLabelId !== undefined) update.goalLabelId = validated.goalLabelId || null;
  if (validated.examCountdownCategoryIds !== undefined || validated.examCountdownIds !== undefined) {
    await assertExamCountdownArrays(validated.examCountdownCategoryIds, validated.examCountdownIds);
    if (validated.examCountdownCategoryIds !== undefined)
      update.examCountdownCategoryIds = validated.examCountdownCategoryIds;
    if (validated.examCountdownIds !== undefined)
      update.examCountdownIds = validated.examCountdownIds;
  }
  if (validated.packageCategoryId !== undefined) {
    if (
      validated.packageCategoryId &&
      !mongoose.Types.ObjectId.isValid(validated.packageCategoryId)
    )
      throw new HttpError(400, "Invalid packageCategoryId.");
    update.packageCategoryId = validated.packageCategoryId || null;
  }
  if (validated.educatorId !== undefined) update.educatorId = validated.educatorId || null;
  if (validated.specificSubjects)
    update.specificSubjects = toCategoryRefs(validated.specificSubjects);
  if (validated.materialCategories)
    update.materialCategories = toCategoryRefs(validated.materialCategories);
  if (validated.examCategories)
    update.examCategories = toCategoryRefs(validated.examCategories);

  const pkg = await Package.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!pkg) throw new HttpError(404, "Package not found.");
  await invalidatePackageCaches(id);
  return pkg;
};

export const deletePackage = async (id: string) => {
  assertObjectId(id, "package");

  const subCount = await PackageCourseSubscription.countDocuments({ packageId: id });
  if (subCount > 0) {
    throw new HttpError(
      400,
      "Package has active subscribers; archive (set active=false) instead."
    );
  }

  const session = await mongoose.startSession();
  try {
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
    await invalidatePackageCaches(id);
  } finally {
    session.endSession();
  }
};

export const togglePackageStatus = async (id: string) => {
  assertObjectId(id, "package");
  const pkg = await Package.findById(id).select("active");
  if (!pkg) throw new HttpError(404, "Package not found.");
  pkg.active = !pkg.active;
  await pkg.save();
  await invalidatePackageCaches(id);
  return { active: pkg.active };
};

export const reorderPackages = async (
  orders: Array<{ id: string; order: number }>
) => {
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) throw new HttpError(400, "Duplicate order values.");
  const ops = orders
    .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
    .map((o) => ({
      updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } },
    }));
  if (!ops.length) throw new HttpError(400, "No valid ids.");
  await Package.bulkWrite(ops);
  await invalidatePackageCaches();
};

// ──────────────────────────────────────────────────────────────────────────────
// Reorder embedded category arrays
// ──────────────────────────────────────────────────────────────────────────────

export const reorderEmbedded = async (
  pkgId: string,
  field: "specificSubjects" | "materialCategories" | "examCategories",
  orders: Array<{ category: string; order: number }>
) => {
  assertObjectId(pkgId, "package");
  const values = new Set(orders.map((o) => o.order));
  if (values.size !== orders.length) throw new HttpError(400, "Duplicate order values.");

  const pkg = await Package.findById(pkgId);
  if (!pkg) throw new HttpError(404, "Package not found.");

  const map = new Map(orders.map((o) => [o.category, o.order]));
  pkg[field] = pkg[field].map((ref: any) => {
    const newOrder = map.get(ref.category.toString());
    return newOrder !== undefined
      ? { ...(ref.toObject?.() ?? ref), order: newOrder }
      : ref;
  });
  await pkg.save();
  await invalidatePackageCaches(pkgId);
  return pkg[field];
};

// ──────────────────────────────────────────────────────────────────────────────
// Plans
// ──────────────────────────────────────────────────────────────────────────────

export const listPackagePlans = async (packageId: string) => {
  assertObjectId(packageId, "package");
  return PackageCourseEbookPrice.find({ packageId })
    .sort({ duration: 1 })
    .lean();
};

export const attachPlansToPackage = async (packageId: string, planIds: string[]) => {
  assertObjectId(packageId, "package");
  const validIds = planIds.filter((i) => mongoose.Types.ObjectId.isValid(i));
  if (!validIds.length) throw new HttpError(400, "No valid plan ids.");
  const r = await PackageCourseEbookPrice.updateMany(
    { _id: { $in: validIds } },
    { $set: { packageId, courseId: null, ebookId: null } }
  );
  await invalidatePackageCaches(packageId);
  return { modified: r.modifiedCount };
};

export const detachPlan = async (packageId: string, planId: string) => {
  assertObjectId(packageId, "package");
  assertObjectId(planId, "plan");
  await PackageCourseEbookPrice.updateOne(
    { _id: planId, packageId },
    { $set: { status: false } }
  );
  await invalidatePackageCaches(packageId);
};

// ──────────────────────────────────────────────────────────────────────────────
// Subscribers / Promoted codes / Video relations
// ──────────────────────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export const listSubscribers = async (packageId: string, query: PaginationQuery) => {
  assertObjectId(packageId, "package");
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "20", 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const filter = { packageId };
  const [data, total] = await Promise.all([
    PackageCourseSubscription.find(filter)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    PackageCourseSubscription.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const listPromotedCodes = async (packageId: string) => {
  assertObjectId(packageId, "package");
  return PromoCode.find({
    "appliesTo.type": "package",
    "appliesTo.ids": packageId,
  })
    .sort({ createdAt: -1 })
    .lean();
};

export const listVideoRelations = async (packageId: string) => {
  assertObjectId(packageId, "package");
  return PackageVideoCategoryRelation.find({ packageId })
    .populate("videoCategoryRelationId")
    .lean();
};

export const setVideoRelations = async (
  packageId: string,
  videoCategoryRelationIds: string[]
) => {
  assertObjectId(packageId, "package");
  const validIds = videoCategoryRelationIds.filter((i) =>
    mongoose.Types.ObjectId.isValid(i)
  );

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await PackageVideoCategoryRelation.updateMany(
        { packageId },
        { $set: { active: false } },
        { session }
      );
      for (const rid of validIds) {
        await PackageVideoCategoryRelation.updateOne(
          { packageId, videoCategoryRelationId: rid },
          { $set: { active: true } },
          { upsert: true, session }
        );
      }
    });
    await invalidatePackageCaches(packageId);
    return { count: validIds.length };
  } finally {
    session.endSession();
  }
};

/**
 * BFS across the VideoCategoryRelation tree starting from the package's
 * specificSubjects roots, then mark every collected relation as active for
 * this package (transactionally).
 */
export const expandSubjectsToRelations = async (packageId: string) => {
  assertObjectId(packageId, "package");

  const pkg = await Package.findById(packageId).select("specificSubjects").lean();
  if (!pkg) throw new HttpError(404, "Package not found.");

  const rootSubjectIds = (pkg.specificSubjects ?? []).map((s: any) => s.category);

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

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await PackageVideoCategoryRelation.updateMany(
        { packageId },
        { $set: { active: false } },
        { session }
      );
      for (const rid of collected) {
        await PackageVideoCategoryRelation.updateOne(
          { packageId, videoCategoryRelationId: rid },
          { $set: { active: true } },
          { upsert: true, session }
        );
      }
    });
    await invalidatePackageCaches(packageId);
    return { count: collected.size };
  } finally {
    session.endSession();
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Chat
// ──────────────────────────────────────────────────────────────────────────────

export const listChatMessages = async (packageId: string, query: PaginationQuery) => {
  assertObjectId(packageId, "package");
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    PackageChat.find({ packageId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    PackageChat.countDocuments({ packageId }),
  ]);

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const postChatMessage = async (
  packageId: string,
  validated: any,
  adminId?: string
) => {
  assertObjectId(packageId, "package");
  if (!validated.text && !validated.mediaUrl) {
    throw new HttpError(400, "Provide text or mediaUrl.");
  }
  const exists = await Package.exists({ _id: packageId });
  if (!exists) throw new HttpError(404, "Package not found.");

  const msg = await PackageChat.create({
    packageId,
    text: validated.text,
    mediaUrl: validated.mediaUrl,
    mediaType: validated.mediaType,
    senderType: "admin",
    senderId: adminId ? new Types.ObjectId(adminId) : null,
    pushSent: false,
  });
  return msg.toObject();
};

export const deleteChatMessage = async (messageId: string) => {
  assertObjectId(messageId, "message");
  const msg = await PackageChat.findByIdAndDelete(messageId).lean();
  if (!msg) throw new HttpError(404, "Message not found.");
};
