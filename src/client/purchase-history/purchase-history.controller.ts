import { Request, Response } from "express";
import {
  BookOrderStatus,
  PackageCourseEbookOrderStatus,
} from "../../models/enums";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as phSql from "../../modules/client-purchase-history/client-purchase-history.service";

const parsePagination = (q: Record<string, string>) => {
  const pageNum = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(q.limit ?? "20", 10) || 20, 1), 100);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

// GET /api/v1/client/purchase-history/subscriptions
// Drives the "Subscriptions" tab. Returns paid course/package subscriptions
// only (paymentStatus === "verified"); pending/failed payments are intentionally
// hidden — the user only wants to see their actual purchases here.
//
// Each row carries the package-type badge ("Live" / "Recorded" / "Test Series")
// resolved through PackageCourseEbookPrice → Package → PackageType.
export const listSubscriptionsHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listSubscriptionsHistory invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listSubscriptionsHistory unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const cid = phSql.parsePhId(String(userId));
    if (!cid) return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    // ⚠ SQL has no payment_status — "verified" maps to status=true (active sub).
    const { data, pagination } = await phSql.listSubscriptions(cid, skip, limitNum, pageNum, limitNum);
    return res.status(200).json({ success: true, data, pagination });
  } catch (e: any) {
    logger.error("listSubscriptionsHistory failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/books
// Drives the "Books" tab. Returns BookOrders in success states only
// (verified / shipped / delivered) — pending/failed/cancelled are hidden
// because the screen is "what I bought", not "every order I ever started".
const BOOK_SUCCESS_STATUSES = [
  BookOrderStatus.VERIFIED,
  BookOrderStatus.SHIPPED,
  BookOrderStatus.DELIVERED,
];

export const listBooksHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listBooksHistory invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listBooksHistory unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const cid = phSql.parsePhId(String(userId));
    if (!cid) return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    const { data, pagination } = await phSql.listBooks(cid, BOOK_SUCCESS_STATUSES as string[], skip, limitNum, pageNum, limitNum);
    return res.status(200).json({ success: true, data, pagination });
  } catch (e: any) {
    logger.error("listBooksHistory failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/purchase-history/ebooks
// Drives the "E-Book" tab. Returns EbookOrders in COMPLETE status only.
export const listEbooksHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listEbooksHistory invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listEbooksHistory unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { pageNum, limitNum, skip } = parsePagination(req.query as Record<string, string>);

    const cid = phSql.parsePhId(String(userId));
    if (!cid) return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 } });
    const { data, pagination } = await phSql.listEbooks(cid, PackageCourseEbookOrderStatus.COMPLETE, skip, limitNum, pageNum, limitNum);
    return res.status(200).json({ success: true, data, pagination });
  } catch (e: any) {
    logger.error("listEbooksHistory failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
