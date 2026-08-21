// src/admin/package/package.service.ts
//
// Domain logic for admin package endpoints. Reads/writes go through the
// admin-package SQL module; package-chat and promo-code reads route to their
// own SQL modules. Errors thrown as `HttpError(code, message)` for the global
// handler.

import { HttpError } from "../../middlewares/errorHandler";
import { planInUseMessage } from "../../utils/planUsage";
import {
  listChatMessagesMysql,
  postChatMessageMysql,
  deleteChatMessageMysql,
  packageExists as packageChatPackageExists,
  parsePackageChatId,
} from "../../modules/package-chat/package-chat.service";
import * as adminPackage from "../../modules/admin-package/admin-package.service";
import * as promoCode from "../../modules/promo-code/promo-code.service";

// Re-exported so the thin controllers can branch validation if needed.
export const isAdminPackageMysql = adminPackage.isAdminPackageMysql;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

// On the SQL branch ids are numeric.
const assertPkgSqlId = (id: string, label: string): number => {
  const n = adminPackage.parsePackageId(id);
  if (!n) throw new HttpError(400, `Invalid ${label} id.`);
  return n;
};

// ──────────────────────────────────────────────────────────────────────────────
// Package types (small master)
// ──────────────────────────────────────────────────────────────────────────────

export const listPackageTypes = async () => {
  return adminPackage.listPackageTypes();
};

export const createPackageType = async (validated: any) => {
  return adminPackage.createPackageType(validated);
};

export const updatePackageType = async (id: string, validated: any) => {
  const res = await adminPackage.updatePackageType(assertPkgSqlId(id, "package type"), validated);
  if (res === "not_found") throw new HttpError(404, "Package type not found.");
  return res;
};

export const deletePackageType = async (id: string) => {
  const res = await adminPackage.deletePackageType(assertPkgSqlId(id, "package type"));
  if (res === "not_found") throw new HttpError(404, "Package type not found.");
  if (res === "in_use") throw new HttpError(400, "Package type is in use; reassign packages first.");
  return;
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
  return adminPackage.listPackages(query);
};

export const getPackageById = async (id: string) => {
  const res = await adminPackage.getPackageById(assertPkgSqlId(id, "package"));
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const createPackage = async (validated: any) => {
  // isPaid/packageCategoryId/examCountdown* DO
  // persist on SQL (ws_package columns), as do goalId/goalLabelId. Embedded
  // arrays → pivot tables. Goal-label validation runs inside adminPackage.
  return adminPackage.createPackage(validated);
};

export const updatePackage = async (id: string, validated: any) => {
  const res = await adminPackage.updatePackage(assertPkgSqlId(id, "package"), validated);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const deletePackage = async (id: string) => {
  const res = await adminPackage.deletePackage(assertPkgSqlId(id, "package"));
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  if (res === "has_subscribers") throw new HttpError(400, "Package has active subscribers; archive (set active=false) instead.");
  return;
};

export const togglePackageStatus = async (id: string) => {
  const res = await adminPackage.togglePackageStatus(assertPkgSqlId(id, "package"));
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const reorderPackages = async (
  orders: Array<{ id: string; order: number }>
) => {
  const res = await adminPackage.reorderPackages(orders);
  if (res === "dup") throw new HttpError(400, "Duplicate order values.");
  return;
};

// ──────────────────────────────────────────────────────────────────────────────
// Reorder embedded category arrays
// ──────────────────────────────────────────────────────────────────────────────

export const reorderEmbedded = async (
  pkgId: string,
  field: "specificSubjects" | "materialCategories" | "examCategories",
  orders: Array<{ category: string; order: number }>
) => {
  const res = await adminPackage.reorderEmbedded(assertPkgSqlId(pkgId, "package"), field, orders);
  if (res === "dup") throw new HttpError(400, "Duplicate order values.");
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

// ──────────────────────────────────────────────────────────────────────────────
// Plans
// ──────────────────────────────────────────────────────────────────────────────

/** Plans list accepts an optional `status` filter that the subscribers list does not. */
export interface PlanListQuery {
  page?: string;
  limit?: string;
  /** "true" | "false" — omit for every plan, active and inactive (the panel's case). */
  status?: string;
}

export const listPackagePlans = async (packageId: string, query: PlanListQuery) => {
  const res = await adminPackage.listPackagePlans(assertPkgSqlId(packageId, "package"), query);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const attachPlansToPackage = async (packageId: string, planIds: string[]) => {
  const res = await adminPackage.attachPlansToPackage(assertPkgSqlId(packageId, "package"), planIds);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  if (res === "no_valid") throw new HttpError(400, "No valid plan ids.");
  return res;
};

export const detachPlan = async (packageId: string, planId: string) => {
  const res = await adminPackage.detachPlan(assertPkgSqlId(packageId, "package"), assertPkgSqlId(planId, "plan"));
  if (res === "not_found") throw new HttpError(404, "Pricing plan not found on this package.");
  if (typeof res === "object") throw new HttpError(409, planInUseMessage(res.inUse));
};

// ──────────────────────────────────────────────────────────────────────────────
// Subscribers / Promoted codes / Video relations
// ──────────────────────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export const listSubscribers = async (packageId: string, query: PaginationQuery) => {
  const res = await adminPackage.listSubscribers(assertPkgSqlId(packageId, "package"), query);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const listExamCategories = async (packageId: string, query: PaginationQuery) => {
  const res = await adminPackage.listExamCategories(assertPkgSqlId(packageId, "package"), query);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const listMaterialCategories = async (packageId: string, query: PaginationQuery) => {
  const res = await adminPackage.listMaterialCategories(assertPkgSqlId(packageId, "package"), query);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const listSpecificSubjects = async (packageId: string, query: PaginationQuery) => {
  const res = await adminPackage.listSpecificSubjects(assertPkgSqlId(packageId, "package"), query);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

// MySQL promo-code read. On SQL the package id is numeric. Paginated via the
// shared scope helper (supports optional `search` on the promocode).
export const listPromotedCodes = async (
  packageId: string,
  query: { search?: string; page: number; limit: number; skip: number }
) => {
  return promoCode.listPromocodesForScope("package", assertPkgSqlId(packageId, "package"), query);
};

// The Book↔Package many-to-many link (`Book.packageIds`) was Mongo-only — ws_book
// has no package-link column and admin-book synthesizes `packageIds: []`. With no
// SQL representation of the relationship, no book can belong to a package, so this
// always returns an empty (but correctly-shaped, paginated) list.
export const listBooks = async (packageId: string, query: PaginationQuery) => {
  assertPkgSqlId(packageId, "package");
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "20", 10) || 20, 1), 100);

  return {
    data: [] as unknown[],
    pagination: {
      total: 0,
      page: pageNum,
      limit: limitNum,
      totalPages: 0,
    },
  };
};

export const listVideoRelations = async (packageId: string) => {
  const res = await adminPackage.listVideoRelations(assertPkgSqlId(packageId, "package"));
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

export const setVideoRelations = async (
  packageId: string,
  videoCategoryRelationIds: string[]
) => {
  const res = await adminPackage.setVideoRelations(assertPkgSqlId(packageId, "package"), videoCategoryRelationIds);
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

/**
 * BFS across the VideoCategoryRelation tree starting from the package's
 * specificSubjects roots, then mark every collected relation as active for
 * this package (transactionally).
 */
export const expandSubjectsToRelations = async (packageId: string) => {
  const res = await adminPackage.expandSubjectsToRelations(assertPkgSqlId(packageId, "package"));
  if (res === "not_found") throw new HttpError(404, "Package not found.");
  return res;
};

// ──────────────────────────────────────────────────────────────────────────────
// Chat
// ──────────────────────────────────────────────────────────────────────────────

export const listChatMessages = async (packageId: string, query: PaginationQuery) => {
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);

  const pid = parsePackageChatId(packageId);
  if (pid == null) throw new HttpError(400, "Invalid package id.");
  const { data, total } = await listChatMessagesMysql(pid, pageNum, limitNum);
  return {
    data,
    pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  };
};

export const postChatMessage = async (
  packageId: string,
  validated: any,
  adminId?: string
) => {
  if (!validated.text && !validated.mediaUrl) {
    throw new HttpError(400, "Provide text or mediaUrl.");
  }

  const pid = parsePackageChatId(packageId);
  if (pid == null) throw new HttpError(400, "Invalid package id.");
  if (!(await packageChatPackageExists(pid))) throw new HttpError(404, "Package not found.");
  return postChatMessageMysql({
    packageId: pid,
    text: validated.text,
    mediaUrl: validated.mediaUrl,
    mediaType: validated.mediaType,
    senderId: adminId ?? null, // admin ObjectId string → varchar sender_id
    senderType: "admin",
  });
};

export const deleteChatMessage = async (messageId: string) => {
  const mid = parsePackageChatId(messageId);
  if (mid == null) throw new HttpError(400, "Invalid message id.");
  const ok = await deleteChatMessageMysql(mid);
  if (!ok) throw new HttpError(404, "Message not found.");
};
