import { Request, Response } from "express";
import { Types } from "mongoose";
import type { FolderType } from "../../models/customer/Folder.model";
import type { FolderItemKind } from "../../models/customer/FolderItem.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import * as folderSql from "../../modules/client-folder/client-folder.service";

const ALLOWED_KIND: Record<FolderType, FolderItemKind> = {
  video: "video",
  material: "material",
};

function userId(req: Request): string | null {
  return req.user?.id ?? null;
}

/**
 * Ensure both default folders ("My Videos", "My Materials") exist for a customer.
 * Idempotent — safe to call on every signup and from backfill scripts.
 */
export async function ensureDefaultFolders(customerId: string | Types.ObjectId) {
  const cid = folderSql.parseFolderId(String(customerId));
  if (cid != null) return folderSql.ensureDefaultFolders(cid);
  return;
}

function makeFolderController(type: FolderType) {
  const allowedKind = ALLOWED_KIND[type];

  const list = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    logger.info(`${type}Folder list invoked`, { traceId, path: req.originalUrl, customerId: uid });

    try {
      if (!uid) {
        logger.warn(`${type}Folder list unauthorized`, { traceId });
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { search, page, limit, skip } = parseListQuery(req.query);

      const cid = folderSql.parseFolderId(uid);
      if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
      const { data, total } = await folderSql.listFolders(cid, type, search || undefined, skip, limit);
      return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
    } catch (error: any) {
      logger.error(`${type}Folder list failed`, { traceId, customerId: uid, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const create = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    logger.info(`${type}Folder create invoked`, { traceId, path: req.originalUrl, customerId: uid });

    try {
      if (!uid) {
        logger.warn(`${type}Folder create unauthorized`, { traceId });
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const name = (req.body?.name ?? "").toString().trim();
      if (!name) { logger.warn(`${type}Folder create missing name`, { traceId, customerId: uid }); return res.status(400).json({ success: false, message: "name is required." }); }
      if (name.length > 120) { logger.warn(`${type}Folder create name too long`, { traceId, customerId: uid }); return res.status(400).json({ success: false, message: "name too long (max 120)." }); }

      const cid = folderSql.parseFolderId(uid);
      if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
      const r = await folderSql.createFolder(cid, type, name);
      if (!r.ok) return res.status(409).json({ success: false, message: "A folder with this name already exists." });
      return res.status(201).json({ success: true, data: r.data });
    } catch (error: any) {
      logger.error(`${type}Folder create failed`, { traceId, customerId: uid, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const detail = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    const id = req.params.id as string;
    logger.info(`${type}Folder detail invoked`, { traceId, path: req.originalUrl, customerId: uid, folderId: id });

    try {
      if (!uid) {
        logger.warn(`${type}Folder detail unauthorized`, { traceId });
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { page = "1", limit = "20" } = req.query as Record<string, string>;
      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
      const skip = (pageNum - 1) * limitNum;

      const cid = folderSql.parseFolderId(uid); const fid = folderSql.parseFolderId(id);
      if (cid == null || fid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await folderSql.folderDetail(cid, type, fid, skip, limitNum);
      if (!r) return res.status(404).json({ success: false, message: "Folder not found." });
      return res.status(200).json({ success: true, data: { folder: r.folder, list: r.list }, pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) } });
    } catch (error: any) {
      logger.error(`${type}Folder detail failed`, { traceId, customerId: uid, folderId: id, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const update = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    const id = req.params.id as string;
    logger.info(`${type}Folder update invoked`, { traceId, path: req.originalUrl, customerId: uid, folderId: id });

    try {
      if (!uid) { logger.warn(`${type}Folder update unauthorized`, { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

      const name = (req.body?.name ?? "").toString().trim();
      if (!name) { logger.warn(`${type}Folder update missing name`, { traceId, folderId: id }); return res.status(400).json({ success: false, message: "name is required." }); }
      if (name.length > 120) { logger.warn(`${type}Folder update name too long`, { traceId, folderId: id }); return res.status(400).json({ success: false, message: "name too long (max 120)." }); }

      const cid = folderSql.parseFolderId(uid); const fid = folderSql.parseFolderId(id);
      if (cid == null || fid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await folderSql.updateFolder(cid, type, fid, name);
      if (r === "not_found") return res.status(404).json({ success: false, message: "Folder not found." });
      if (r === "dup") return res.status(409).json({ success: false, message: "A folder with this name already exists." });
      return res.status(200).json({ success: true, data: r });
    } catch (error: any) {
      logger.error(`${type}Folder update failed`, { traceId, customerId: uid, folderId: id, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const remove = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    const id = req.params.id as string;
    logger.info(`${type}Folder remove invoked`, { traceId, path: req.originalUrl, customerId: uid, folderId: id });

    try {
      if (!uid) { logger.warn(`${type}Folder remove unauthorized`, { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

      const cid = folderSql.parseFolderId(uid); const fid = folderSql.parseFolderId(id);
      if (cid == null || fid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await folderSql.removeFolder(cid, type, fid);
      if (!r.ok) return res.status(404).json({ success: false, message: "Folder not found." });
      return res.status(200).json({ success: true, message: r.wasDefault ? "Folder emptied." : "Folder deleted." });
    } catch (error: any) {
      logger.error(`${type}Folder remove failed`, { traceId, customerId: uid, folderId: id, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const addItem = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    const id = req.params.id as string;
    logger.info(`${type}Folder addItem invoked`, { traceId, path: req.originalUrl, customerId: uid, folderId: id, refId: req.body?.refId });

    try {
      if (!uid) { logger.warn(`${type}Folder addItem unauthorized`, { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

      const refId = req.body?.refId as string;

      const cid = folderSql.parseFolderId(uid); const fid = folderSql.parseFolderId(id); const rid = folderSql.parseFolderId(String(refId));
      if (cid == null || fid == null || rid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await folderSql.addItem(cid, type, fid, rid);
      if (r === "folder_not_found") return res.status(404).json({ success: false, message: "Folder not found." });
      if (r === "ref_not_found") return res.status(404).json({ success: false, message: `${allowedKind} not found.` });
      return res.status(r.deduped ? 200 : 201).json({ success: true, data: r.data, ...(r.deduped ? { deduped: true } : {}) });
    } catch (error: any) {
      logger.error(`${type}Folder addItem failed`, { traceId, customerId: uid, folderId: id, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  const removeItem = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    const { id, itemId } = req.params as { id: string; itemId: string };
    logger.info(`${type}Folder removeItem invoked`, { traceId, path: req.originalUrl, customerId: uid, folderId: id, itemId });

    try {
      if (!uid) { logger.warn(`${type}Folder removeItem unauthorized`, { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

      const cid = folderSql.parseFolderId(uid); const fid = folderSql.parseFolderId(id); const iid = folderSql.parseFolderId(itemId);
      if (cid == null || fid == null || iid == null) return res.status(400).json({ success: false, message: "Invalid id(s)." });
      const ok = await folderSql.removeItem(cid, type, fid, iid);
      if (!ok) return res.status(404).json({ success: false, message: "Item not found." });
      return res.status(200).json({ success: true, message: "Item removed." });
    } catch (error: any) {
      logger.error(`${type}Folder removeItem failed`, { traceId, customerId: uid, folderId: id, itemId, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  // GET /{video|material}-folders/all-items
  // Returns every folder the customer owns for this type, with its items + joined refs.
  // Mirrors the per-folder `detail` shape but in one call, and only counts items whose
  // underlying Material/Video still exists — so list length matches the dashboard count.
  const allItems = async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const uid = userId(req);
    logger.info(`${type}Folder allItems invoked`, { traceId, path: req.originalUrl, customerId: uid });

    try {
      if (!uid) { logger.warn(`${type}Folder allItems unauthorized`, { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

      const cid = folderSql.parseFolderId(uid);
      if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
      return res.status(200).json({ success: true, data: await folderSql.allItems(cid, type) });
    } catch (error: any) {
      logger.error(`${type}Folder allItems failed`, { traceId, customerId: uid, error: getErrorMessage(error), stack: error.stack });
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  return { list, create, detail, update, remove, addItem, removeItem, allItems };
}

export const videoFolderController = makeFolderController("video");
export const materialFolderController = makeFolderController("material");
