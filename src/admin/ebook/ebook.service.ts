// src/admin/ebook/ebook.service.ts
//
// Domain logic for admin ebook endpoints. Same shape as course/package service:
//   `.lean()` + select on reads, transactions on multi-doc writes, cache-aside
//   on hot reads, HttpError for predictable status codes.

import mongoose from "mongoose";
import { Ebook, EbookUploadStatus } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { HttpError } from "../../middlewares/errorHandler";
import { deleteFromS3FileUrl, isOwnBucketUrl } from "../../middlewares/upload";
import cache from "../../libs/cache";
import { buildRegexCondition, buildSearchFilter } from "../../utils/searchFilter";

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
    cache.invalidateByPrefix(cache.keyPrefix("admin", "ebook", "list:")),
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
  Object.assign(filter, buildSearchFilter(search, ["name", "author"]));
  {
    const c = buildRegexCondition(author);
    if (c) filter.author = c;
  }
  {
    const c = buildRegexCondition(publisher);
    if (c) filter.publisher = c;
  }
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
        .populate("examCountdownCategoryIds", "_id name colorHex")
        .populate("examCountdownIds", "_id title examDate")
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
  // Legacy single field is now a derived mirror of examCountdownCategoryIds[0]
  // (admin no longer sends a meaningful single value). Kept in sync for the one
  // remaining reader. See docs/MIGRATION_QUERY_CHANGES.md.
  (validated as any).examCountdownCategoryId = validated.examCountdownCategoryIds?.[0] ?? null;
  const ebook = await Ebook.create(validated);
  await invalidateEbookCaches();
  return ebook.toObject();
};

// ──────────────────────────────────────────────────────────────────────────────
// PDF upload status (written by the upload pipeline)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Persist the PDF-upload status of an ebook's Book or Demo slot onto the ebook
 * document, then invalidate the ebook list + detail caches so the admin list
 * (which polls every 5s) reads the fresh state. Called by the upload pipeline at
 * each job transition (queued → processing → completed/failed).
 *
 * `target` is the URL field being uploaded ("bookUrl" | "demoUrl"); it maps to
 * the matching {book,demo}UploadStatus / {book,demo}UploadProgress pair. `set`
 * lets the completed transition also write the resolved url/filename in the same
 * update (so the doc never shows completed without its bookUrl).
 */
export const setEbookUploadStatus = async (
  ebookId: string,
  target: "bookUrl" | "demoUrl",
  fields: { status: EbookUploadStatus; progress?: number; set?: Record<string, unknown> }
): Promise<void> => {
  const prefix = target === "demoUrl" ? "demo" : "book";
  const update: Record<string, unknown> = {
    [`${prefix}UploadStatus`]: fields.status,
    ...(fields.set ?? {}),
  };
  if (fields.progress !== undefined) {
    update[`${prefix}UploadProgress`] = fields.progress;
  }
  await Ebook.updateOne({ _id: ebookId }, { $set: update });
  await invalidateEbookCaches(ebookId);
};

// File-bearing ebook fields whose replaced values must be cleaned up from
// Spaces on update (otherwise the previous upload is orphaned in storage).
const EBOOK_FILE_FIELDS = ["image", "thumbnail", "demoUrl", "bookUrl"] as const;

export const updateEbook = async (id: string, validated: any) => {
  assertObjectId(id, "Ebook");
  // Keep the legacy single field in sync with examCountdownCategoryIds[0], but
  // ONLY when the array is present in this payload — otherwise an update that
  // doesn't touch countdowns would wipe the single field. Drop any stale single
  // value the admin still sends. See docs/MIGRATION_QUERY_CHANGES.md.
  if (validated.examCountdownCategoryIds !== undefined) {
    (validated as any).examCountdownCategoryId = validated.examCountdownCategoryIds[0] ?? null;
  } else {
    delete (validated as any).examCountdownCategoryId;
  }

  // Snapshot the current file URLs before the update so we can delete any that
  // get replaced. Only fields actually present in the payload can change.
  const prev: any = await Ebook.findById(id)
    .select(EBOOK_FILE_FIELDS.join(" "))
    .lean();
  if (!prev) throw new HttpError(404, "Ebook not found");

  const ebook = await Ebook.findByIdAndUpdate(id, validated, { new: true }).lean();
  if (!ebook) throw new HttpError(404, "Ebook not found");
  await invalidateEbookCaches(id);

  // Best-effort cleanup of replaced files — runs AFTER the update succeeds, so a
  // failed update never deletes a live file. Only delete when the field was in
  // the payload, the URL actually changed, and the old URL is in our bucket
  // (never an external link). Errors are swallowed (orphan cleanup is not
  // worth failing the request over).
  for (const field of EBOOK_FILE_FIELDS) {
    if (!(field in validated)) continue;
    const oldUrl: string | undefined = prev[field];
    const newUrl: string | undefined = (ebook as any)[field];
    if (oldUrl && oldUrl !== newUrl && isOwnBucketUrl(oldUrl)) {
      void deleteFromS3FileUrl(oldUrl);
    }
  }

  return ebook;
};

export const deleteEbook = async (id: string) => {
  assertObjectId(id, "Ebook");
  const session = await mongoose.startSession();
  // Captured inside the transaction, used AFTER it commits — S3 deletes are not
  // transactional and must never be able to abort the DB write.
  let deletedFileUrls: Array<string | undefined> = [];
  try {
    let notFound = false;
    await session.withTransaction(async () => {
      const ebook = await Ebook.findByIdAndDelete(id, { session });
      if (!ebook) {
        notFound = true;
        return;
      }
      deletedFileUrls = EBOOK_FILE_FIELDS.map((f) => (ebook as any)[f]);
      await EbookPrice.deleteMany({ ebookId: id }, { session });
    });
    if (notFound) throw new HttpError(404, "Ebook not found");
    await invalidateEbookCaches(id);

    // Best-effort cleanup of the ebook's stored files (image/thumbnail/demo/
    // book) — only own-bucket URLs, never external links. Runs after commit so
    // a storage blip can't undo the delete. Errors are swallowed.
    for (const url of deletedFileUrls) {
      if (url && isOwnBucketUrl(url)) void deleteFromS3FileUrl(url);
    }
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
