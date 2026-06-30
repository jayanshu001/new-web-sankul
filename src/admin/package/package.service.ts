// src/admin/package/package.service.ts
//
// Domain logic for admin package endpoints. Reads/writes go through the
// admin-package SQL module; package-chat and promo-code reads route to their
// own SQL modules. Errors thrown as `HttpError(code, message)` for the global
// handler.

import mongoose from "mongoose";
import { Book } from "../../models/book/Book.model";
import { HttpError } from "../../middlewares/errorHandler";
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

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} id.`);
  }
};

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
  // isPaid/isSmartCourse/isPlannerCourse/packageCategoryId/examCountdown* DO
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

export const listPackagePlans = async (packageId: string) => {
  const res = await adminPackage.listPackagePlans(assertPkgSqlId(packageId, "package"));
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
  await adminPackage.detachPlan(assertPkgSqlId(packageId, "package"), assertPkgSqlId(planId, "plan"));
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

// MySQL promo-code read. On SQL the package id is numeric.
export const listPromotedCodes = async (packageId: string) => {
  return promoCode.listPromocodesForPackage(assertPkgSqlId(packageId, "package"));
};

// ⚠ STAYS Mongo: Book.packageIds (the many-to-many link) has no SQL column —
// ws_book has no packageIds (confirmed by admin-book). No SQL branch.
// Physical books linked to this package (the "material (Book)" tab). Paginated
// to mirror listSubscribers. Books carry `packageIds`; a book belongs here when
// its `packageIds` array contains this package id.
export const listBooks = async (packageId: string, query: PaginationQuery) => {
  assertObjectId(packageId, "package");
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "20", 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const filter = { packageIds: packageId };
  const [data, total] = await Promise.all([
    Book.find(filter)
      .select(
        "_id name author image thumbnail listPrice discountedPrice shippingPrice language isMagazine isCombo isTrending status orderBy createdAt"
      )
      .sort({ orderBy: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Book.countDocuments(filter),
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
