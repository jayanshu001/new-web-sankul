// Promoter customers: HTTP handlers for the promoter's attributed customers.
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parsePromoterId,
  listPromoterCustomers,
  listPromoterSubscriptions,
} from "../../modules/promoter-data/promoter-data.service";
import { parseListQuery } from "../../utils/listQuery";

export const listMyCustomers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("listMyCustomers invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("listMyCustomers unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const { page: pageNum, limit: limitNum } = parseListQuery({ page, limit }, { defaultLimit: 20, maxLimit: 500 });

    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { items, total } = await listPromoterCustomers(pid, { search, page: pageNum, limit: limitNum });
    logger.info("listMyCustomers success", { traceId, promoterId, total });
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

// Customer plus their course/ebook subscriptions; 404 unless attributed to this promoter.
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
    // A non-positive id never matches a customer; answer exactly as before (404), and never
    // let customerId 0 fall through to the unfiltered list.
    if (cid <= 0) return res.status(404).json({ success: false, message: "Customer not found." });
    // Attribution: empty unless the customer is in this promoter's attributed set.
    const { items: [customer] } = await listPromoterCustomers(pid, { customerId: cid, page: 1, limit: 1 });
    if (!customer) { logger.warn("getMyCustomerDetail not attributed", { traceId, promoterId, customerId }); return res.status(404).json({ success: false, message: "Customer not found." }); }
    // One customer's subs under one promoter is a small set; the cap is only a ceiling.
    const [courseAll, ebookAll] = await Promise.all([
      listPromoterSubscriptions(pid, { type: "course", customerId: cid, page: 1, limit: 1000 }),
      listPromoterSubscriptions(pid, { type: "ebook", customerId: cid, page: 1, limit: 1000 }),
    ]);
    const courseSubscriptions = courseAll.items;
    const ebookSubscriptions = ebookAll.items;
    logger.info("getMyCustomerDetail success", { traceId, promoterId, customerId, courseSubs: courseSubscriptions.length, ebookSubs: ebookSubscriptions.length });
    return res.status(200).json({ success: true, data: { customer, courseSubscriptions, ebookSubscriptions } });
  } catch (e: any) {
    logger.error("getMyCustomerDetail failed", { traceId, promoterId, customerId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
