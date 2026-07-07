import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  parseWlId,
  isWlType,
  itemExists,
  listWishlistMysql,
  addWishlistMysql,
  removeWishlistMysql,
  checkWishlistMysql,
} from "../../modules/client-wishlist/client-wishlist.service";

// GET /api/v1/client/wishlist
export const listWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listWishlist invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const { itemType } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

    // ─── SQL branch (int id-space) — gated on `client-wishlist` ───
    const cidNum = parseWlId(String(userId));
    if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    const typeFilter = itemType && isWlType(itemType) ? itemType : null;
    const { data, count, total } = await listWishlistMysql(cidNum, typeFilter, { search, skip, limit });
    logger.info("listWishlist success (sql)", { traceId, customerId: userId, count, total });
    return res.status(200).json({ success: true, data, count, pagination: buildPagination(total, page, limit) });
  } catch (e: any) {
    logger.error("listWishlist failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/wishlist
export const addToWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("addToWishlist invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("addToWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ─── SQL branch (int id-space) — itemId is an int, not 24-hex ───
    const cidNum = parseWlId(String(userId));
    if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    const itemType = String(req.body?.itemType ?? "");
    const itemIdNum = parseWlId(String(req.body?.itemId ?? ""));
    if (!isWlType(itemType) || itemIdNum == null) {
      logger.warn("addToWishlist validation failed (sql)", { traceId, customerId: userId, itemType, itemId: req.body?.itemId });
      return res.status(400).json({ success: false, message: "Invalid itemType or itemId." });
    }
    if (!(await itemExists(itemType, itemIdNum))) {
      logger.warn("addToWishlist item not found (sql)", { traceId, customerId: userId, itemType, itemId: itemIdNum });
      return res.status(404).json({ success: false, message: "Item not found." });
    }
    const outcome = await addWishlistMysql(cidNum, itemType, itemIdNum);
    logger.info("addToWishlist success (sql)", { traceId, customerId: userId, itemType, itemId: itemIdNum, outcome });
    if (outcome === "exists") return res.status(200).json({ success: true, message: "Already in wishlist." });
    return res.status(201).json({ success: true });
  } catch (e: any) {
    if (e.issues) { logger.warn("addToWishlist validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("addToWishlist failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/client/wishlist/:itemType/:itemId
export const removeFromWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { itemType, itemId } = req.params as Record<string, string>;
  logger.info("removeFromWishlist invoked", { traceId, path: req.originalUrl, customerId: userId, itemType, itemId });

  try {
    if (!userId) { logger.warn("removeFromWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isWlType(itemType)) { logger.warn("removeFromWishlist invalid itemType", { traceId, customerId: userId, itemType }); return res.status(400).json({ success: false, message: "Invalid itemType." }); }

    // ─── SQL branch (int id-space) ───
    const cidNum = parseWlId(String(userId));
    const itemIdNum = parseWlId(String(itemId));
    if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (!isWlType(itemType) || itemIdNum == null) return res.status(400).json({ success: false, message: "Invalid itemId." });
    const removed = await removeWishlistMysql(cidNum, itemType, itemIdNum);
    if (!removed) { logger.warn("removeFromWishlist not found (sql)", { traceId, customerId: userId, itemType, itemId }); return res.status(404).json({ success: false, message: "Not in wishlist." }); }
    logger.info("removeFromWishlist success (sql)", { traceId, customerId: userId, itemType, itemId });
    return res.status(200).json({ success: true, message: "Removed." });
  } catch (e: any) {
    logger.error("removeFromWishlist failed", { traceId, customerId: userId, itemType, itemId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/wishlist/check/:itemType/:itemId
export const checkWishlist = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { itemType, itemId } = req.params as Record<string, string>;
  logger.info("checkWishlist invoked", { traceId, path: req.originalUrl, customerId: userId, itemType, itemId });

  try {
    if (!userId) { logger.warn("checkWishlist unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ─── SQL branch (int id-space) ───
    const cidNum = parseWlId(String(userId));
    const itemIdNum = parseWlId(String(itemId));
    if (cidNum == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (!isWlType(itemType) || itemIdNum == null) { logger.warn("checkWishlist invalid params (sql)", { traceId, customerId: userId, itemType, itemId }); return res.status(400).json({ success: false, message: "Invalid params." }); }
    const inWishlist = await checkWishlistMysql(cidNum, itemType, itemIdNum);
    logger.info("checkWishlist success (sql)", { traceId, customerId: userId, itemType, itemId, inWishlist });
    return res.status(200).json({ success: true, data: { inWishlist } });
  } catch (e: any) {
    logger.error("checkWishlist failed", { traceId, customerId: userId, itemType, itemId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
