// src/admin/ebook/ebook.service.ts
//
// Domain logic for admin ebook endpoints. Same shape as course/package service:
//   cache-aside on hot reads, HttpError for predictable status codes.

import mongoose from "mongoose";
import { Ebook, EbookUploadStatus } from "../../models/ebook/Ebook.model";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";
import * as adminEbook from "../../modules/admin-ebook/admin-ebook.service";

// Re-exported so the thin controllers can branch validation (numeric vs ObjectId).
export const isAdminEbookMysql = adminEbook.isAdminEbookMysql;
export const parseEbookId = adminEbook.parseEbookId;

// On the SQL branch ids are numeric; the Mongo assertObjectId would 400 them.
const assertEbookSqlId = (id: string, label: string): number => {
  const n = adminEbook.parseEbookId(id);
  if (!n) throw new HttpError(400, `Invalid ${label} ID`);
  return n;
};

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} ID`);
  }
};

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
  return adminEbook.listEbooks(query);
};

export const getEbookById = async (id: string) => {
  const data = await adminEbook.getEbookById(assertEbookSqlId(id, "Ebook"));
  if (!data) throw new HttpError(404, "Ebook not found");
  return data;
};

export const createEbook = async (validated: any) => {
  // SQL ws_ebook now stores examCountdownIds/examCountdownCategoryIds as JSON
  // int-arrays (C6, persisted in adminEbook.createEbook). isTrending/PDF-status
  // remain Mongo-only (no SQL columns).
  return adminEbook.createEbook(validated);
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

export const updateEbook = async (id: string, validated: any) => {
  // NOTE: the Mongo path best-effort-deletes replaced S3 files; on SQL we skip
  // that orphan cleanup (not part of the API contract). examCountdownIds/
  // examCountdownCategoryIds ARE persisted as JSON on SQL (C6); PDF-status
  // fields are still dropped (no SQL columns).
  const data = await adminEbook.updateEbook(assertEbookSqlId(id, "Ebook"), validated);
  if (!data) throw new HttpError(404, "Ebook not found");
  return data;
};

export const deleteEbook = async (id: string) => {
  // Cascades the ebook's plans (ws_package_course_ebook_price) in one txn.
  // S3 file cleanup is skipped on SQL (best-effort, not contract).
  const ok = await adminEbook.deleteEbook(assertEbookSqlId(id, "Ebook"));
  if (!ok) throw new HttpError(404, "Ebook not found");
  return;
};

// ⚠ STAYS Mongo: ws_ebook has no `is_trending` column (isTrending is Mongo-only,
// synthesized false in the SQL DTO). No admin-ebook SQL branch.
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
  await adminEbook.reorderEbooks(orders);
  return;
};

// ──────────────────────────────────────────────────────────────────────────────
// Ebook plans
// ──────────────────────────────────────────────────────────────────────────────

export const listEbookPlans = async (ebookId: string) => {
  const res = await adminEbook.listEbookPlans(assertEbookSqlId(ebookId, "Ebook"));
  if (res === "not_found") throw new HttpError(404, "Ebook not found");
  return res;
};

export const createEbookPlan = async (ebookId: string, validated: any) => {
  const res = await adminEbook.createEbookPlan(assertEbookSqlId(ebookId, "Ebook"), validated);
  if (res === "not_found") throw new HttpError(404, "Ebook not found");
  return res;
};

export const getEbookPlanById = async (planId: string) => {
  const plan = await adminEbook.getEbookPlanById(assertEbookSqlId(planId, "Plan"));
  if (!plan) throw new HttpError(404, "Plan not found");
  return plan;
};

export const updateEbookPlan = async (planId: string, validated: any) => {
  const res = await adminEbook.updateEbookPlan(assertEbookSqlId(planId, "Plan"), validated);
  if (res === "not_found") throw new HttpError(404, "Plan not found");
  return res;
};

export const deleteEbookPlan = async (planId: string) => {
  const ok = await adminEbook.deleteEbookPlan(assertEbookSqlId(planId, "Plan"));
  if (!ok) throw new HttpError(404, "Plan not found");
  return;
};
