// src/admin/ebook/ebook.service.ts
//
// Domain logic for admin ebook endpoints. Same shape as course/package service:
//   `.lean()` + select on reads, transactions on multi-doc writes, cache-aside
//   on hot reads, HttpError for predictable status codes.

import mongoose from "mongoose";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} ID`);
  }
};

const ebookListKey = (filter: any, page: number, limit: number) =>
  cache.key(
    "admin",
    "ebook",
    `list:${cache.hashFilter({ filter, page, limit })}`
  );

const ebookDetailKey = (id: string) => cache.key("admin", "ebook", `detail:${id}`);

const invalidateEbookCaches = async (ebookId?: string) => {
  const keys: string[] = [];
  if (ebookId) keys.push(ebookDetailKey(ebookId));
  await Promise.all([
    cache.invalidate(...keys),
    cache.invalidateByPrefix(cache.key("admin", "ebook", "list:")),
  ]);
};

// ──────────────────────────────────────────────────────────────────────────────
// Ebook CRUD
// ──────────────────────────────────────────────────────────────────────────────

export interface ListEbooksQuery {
  search?: string;
  author?: string;
  publisher?: string;
  language?: string;
  status?: string;
  page?: string;
  limit?: string;
}

export const listEbooks = async (query: ListEbooksQuery) => {
  const { search, author, publisher, language, status, page = "1", limit = "20" } = query;

  const filter: any = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { author: { $regex: search, $options: "i" } },
    ];
  }
  if (author) filter.author = { $regex: author, $options: "i" };
  if (publisher) filter.publisher = { $regex: publisher, $options: "i" };
  if (language) filter.language = language;
  if (status === "true" || status === "false") filter.status = status === "true";

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  return cache.aside({
    key: ebookListKey(filter, pageNum, limitNum),
    ttlSeconds: 300,
    load: async () => {
      const [data, total] = await Promise.all([
        Ebook.find(filter)
          .sort({ order: 1, createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Ebook.countDocuments(filter),
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
    },
  });
};

export const getEbookById = async (id: string) => {
  assertObjectId(id, "Ebook");
  return cache.aside({
    key: ebookDetailKey(id),
    ttlSeconds: 300,
    load: async () => {
      const ebook = await Ebook.findById(id)
        .populate("examCountdownCategoryId", "_id name colorHex")
        .lean();
      if (!ebook) throw new HttpError(404, "Ebook not found");
      const plans = await EbookPrice.find({ ebookId: id, status: true })
        .sort({ price: 1 })
        .lean();
      return { ...ebook, plans };
    },
  });
};

export const createEbook = async (validated: any) => {
  (validated as any).examCountdownCategoryId = validated.examCountdownCategoryId || null;
  const ebook = await Ebook.create(validated);
  await invalidateEbookCaches();
  return ebook.toObject();
};

export const updateEbook = async (id: string, validated: any) => {
  assertObjectId(id, "Ebook");
  if (validated.examCountdownCategoryId !== undefined) {
    (validated as any).examCountdownCategoryId = validated.examCountdownCategoryId || null;
  }
  const ebook = await Ebook.findByIdAndUpdate(id, validated, { new: true }).lean();
  if (!ebook) throw new HttpError(404, "Ebook not found");
  await invalidateEbookCaches(id);
  return ebook;
};

export const deleteEbook = async (id: string) => {
  assertObjectId(id, "Ebook");
  const session = await mongoose.startSession();
  try {
    let notFound = false;
    await session.withTransaction(async () => {
      const ebook = await Ebook.findByIdAndDelete(id, { session });
      if (!ebook) {
        notFound = true;
        return;
      }
      await EbookPrice.deleteMany({ ebookId: id }, { session });
    });
    if (notFound) throw new HttpError(404, "Ebook not found");
    await invalidateEbookCaches(id);
  } finally {
    session.endSession();
  }
};

export const toggleEbookTrending = async (id: string) => {
  assertObjectId(id, "Ebook");
  const ebook = await Ebook.findById(id).select("isTrending");
  if (!ebook) throw new HttpError(404, "Ebook not found");
  ebook.isTrending = !ebook.isTrending;
  await ebook.save();
  await invalidateEbookCaches(id);
  return { isTrending: ebook.isTrending };
};

export const reorderEbooks = async (orders: Array<{ id: string; order: number }>) => {
  const ops = orders
    .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
    .map((o) => ({
      updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } },
    }));
  if (!ops.length) throw new HttpError(400, "No valid ids.");
  await Ebook.bulkWrite(ops);
  await invalidateEbookCaches();
};

// ──────────────────────────────────────────────────────────────────────────────
// Ebook plans
// ──────────────────────────────────────────────────────────────────────────────

export const listEbookPlans = async (ebookId: string) => {
  assertObjectId(ebookId, "Ebook");
  const exists = await Ebook.exists({ _id: ebookId });
  if (!exists) throw new HttpError(404, "Ebook not found");
  return EbookPrice.find({ ebookId }).sort({ price: 1 }).lean();
};

export const createEbookPlan = async (ebookId: string, validated: any) => {
  assertObjectId(ebookId, "Ebook");
  const exists = await Ebook.exists({ _id: ebookId });
  if (!exists) throw new HttpError(404, "Ebook not found");
  const plan = await EbookPrice.create({ ...validated, ebookId });
  await invalidateEbookCaches(ebookId);
  return plan.toObject();
};

export const getEbookPlanById = async (planId: string) => {
  assertObjectId(planId, "Plan");
  const plan = await EbookPrice.findById(planId).populate("ebookId", "_id name").lean();
  if (!plan) throw new HttpError(404, "Plan not found");
  return plan;
};

export const updateEbookPlan = async (planId: string, validated: any) => {
  assertObjectId(planId, "Plan");
  const plan = await EbookPrice.findByIdAndUpdate(planId, validated, { new: true });
  if (!plan) throw new HttpError(404, "Plan not found");
  if (plan.ebookId) await invalidateEbookCaches(plan.ebookId.toString());
  return plan.toObject();
};

export const deleteEbookPlan = async (planId: string) => {
  assertObjectId(planId, "Plan");
  const plan = await EbookPrice.findByIdAndDelete(planId);
  if (!plan) throw new HttpError(404, "Plan not found");
  if (plan.ebookId) await invalidateEbookCaches(plan.ebookId.toString());
};
