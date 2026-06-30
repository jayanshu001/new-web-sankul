import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parsePromoterId,
  listPromoterCustomers,
  listPromoterSubscriptions,
} from "../../modules/promoter-data/promoter-data.service";

// GET /api/v1/promoter/customers — unique customers attributed to this promoter
export const listMyCustomers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("listMyCustomers invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("listMyCustomers unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { items, total } = await listPromoterCustomers(pid, { search, page: pageNum, limit: limitNum });
    logger.info("listMyCustomers success (sql)", { traceId, promoterId, total });
    return res.status(200).json({
      success: true,
      data: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listMyCustomers failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/customers/:id
export const getMyCustomerDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  const customerId = req.params.id as string;
  logger.info("getMyCustomerDetail invoked", { traceId, path: req.originalUrl, promoterId, customerId });

  try {
    if (!promoterId) { logger.warn("getMyCustomerDetail unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const pid = parsePromoterId(promoterId);
    const cid = Number(customerId);
    if (!pid || !Number.isInteger(cid)) return res.status(400).json({ success: false, message: "Invalid id." });
    // Attribution: the customer must appear in this promoter's attributed set.
    const { items } = await listPromoterCustomers(pid, { page: 1, limit: 100000 });
    const customer = items.find((c) => c._id === String(cid));
    if (!customer) { logger.warn("getMyCustomerDetail not attributed (sql)", { traceId, promoterId, customerId }); return res.status(404).json({ success: false, message: "Customer not found." }); }
    // Pull this promoter's subs, then keep only this customer's.
    const [courseAll, ebookAll] = await Promise.all([
      listPromoterSubscriptions(pid, { type: "course", page: 1, limit: 100000 }),
      listPromoterSubscriptions(pid, { type: "ebook", page: 1, limit: 100000 }),
    ]);
    const courseSubscriptions = courseAll.items.filter((s) => s.customerId?._id === String(cid));
    const ebookSubscriptions = ebookAll.items.filter((s) => s.customerId?._id === String(cid));
    logger.info("getMyCustomerDetail success (sql)", { traceId, promoterId, customerId, courseSubs: courseSubscriptions.length, ebookSubs: ebookSubscriptions.length });
    return res.status(200).json({ success: true, data: { customer, courseSubscriptions, ebookSubscriptions } });
  } catch (e: any) {
    logger.error("getMyCustomerDetail failed", { traceId, promoterId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
