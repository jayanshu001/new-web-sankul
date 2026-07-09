// src/admin/ebook/ebook.service.ts
//
// Domain logic for admin ebook endpoints. Same shape as course/package service:
//   cache-aside on hot reads, HttpError for predictable status codes.

import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";
import * as adminEbook from "../../modules/admin-ebook/admin-ebook.service";

// Re-exported so the thin controllers can branch validation (numeric vs ObjectId).
export const isAdminEbookMysql = adminEbook.isAdminEbookMysql;
export const parseEbookId = adminEbook.parseEbookId;

// On the SQL branch ids are numeric.
const assertEbookSqlId = (id: string, label: string): number => {
  const n = adminEbook.parseEbookId(id);
  if (!n) throw new HttpError(400, `Invalid ${label} ID`);
  return n;
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
  // int-arrays (C6, persisted in adminEbook.createEbook) and isTrending
  // (ws_ebook.is_trending). Only the PDF-upload status fields remain SQL-managed
  // by the upload pipeline, not this write path.
  return adminEbook.createEbook(validated);
};

// NOTE: the former Mongo `setEbookUploadStatus` helper was removed — the live
// PDF-upload pipeline persists status via `setEbookUploadStatusSql`
// (src/modules/pdf-upload/pdf-upload.service.ts), which writes the ws_ebook
// upload columns. This orphan had no remaining callers.

export const updateEbook = async (id: string, validated: any) => {
  // NOTE: the Mongo path best-effort-deletes replaced S3 files; on SQL we skip
  // that orphan cleanup (not part of the API contract). examCountdownIds/
  // examCountdownCategoryIds ARE persisted as JSON on SQL (C6) and isTrending
  // persists to ws_ebook.is_trending; PDF-status fields are managed by the
  // upload pipeline, not this write path.
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

// Flips ws_ebook.is_trending via the admin-ebook SQL module and invalidates the
// admin ebook caches so list/detail reads reflect the new value.
export const toggleEbookTrending = async (id: string) => {
  const numId = assertEbookSqlId(id, "Ebook");
  const updated = await adminEbook.toggleEbookTrending(numId);
  if (!updated) throw new HttpError(404, "Ebook not found");
  await invalidateEbookCaches(id);
  return { isTrending: updated.isTrending };
};

export const reorderEbooks = async (orders: Array<{ id: string; order: number }>) => {
  await adminEbook.reorderEbooks(orders);
  return;
};

// ──────────────────────────────────────────────────────────────────────────────
// Ebook plans
// ──────────────────────────────────────────────────────────────────────────────

export const listEbookPlans = async (
  ebookId: string,
  opts: { skip: number; take: number; page: number; limit: number }
) => {
  const res = await adminEbook.listEbookPlans(assertEbookSqlId(ebookId, "Ebook"), opts);
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
