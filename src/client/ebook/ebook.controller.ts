import { Request, Response } from "express";
import { generateEbookReceipt } from "../../libs/core/generate";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  isEbookMysql,
  listEbooksWithPlans,
  getEbookDetailWithPlans,
  parseEbookId,
} from "../../modules/catalog-ebook/catalog-ebook.service";
import { listMyEbookSubscriptions } from "../../modules/commerce-ebook-sub/commerce-ebook-sub.service";
import type { EBookLanguage } from "@prisma/client";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// Legacy Mongo ObjectId shape (24-hex). Retained only to keep the invoice id
// validation identical to the pre-migration contract; SQL order ids are ints.
const isObjectId = (v: string) => /^[a-fA-F0-9]{24}$/.test(v);

// GET /api/v1/client/ebooks
export const listEbooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = (req as any).user?.id;
  logger.info("listEbooks invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { language } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

    // Composes catalog-ebook + commerce-price (plans) + commerce-ebook-sub
    // (entitlement); returns the `{ ebooks: [...] }` contract.
    const base = resolveBase(req);
    const custId = (req as any).user?.id != null ? parseEbookId(String((req as any).user.id)) : null;
    const data = await listEbooksWithPlans(
      {
        search: search?.trim() || undefined,
        language: (language as EBookLanguage) || undefined,
        customerId: custId ?? undefined,
      },
      (id) => buildShareUrl("ebooks", id, base)
    );
    logger.info("listEbooks success", { traceId, customerId, count: data.length, source: "mysql" });
    return res.status(200).json({ success: true, data: { ebooks: data } });
  } catch (error: any) {
    logger.error("listEbooks failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/subscriptions
export const listMySubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info("listMySubscriptions invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);

    const custId = userId != null ? parseEbookId(String(userId)) : null;
    if (custId == null) {
      logger.info("listMySubscriptions success", { traceId, customerId: userId, count: 0 });
      return res.status(200).json({ success: true, data: { subscriptions: [] }, pagination: buildPagination(0, page, limit) });
    }

    // Active ebook subscriptions (endAt soonest-first) spread into the ebook
    // DTO + access window. Optional name/author search scopes by ebook.
    const base = resolveBase(req);
    const { subscriptions, total } = await listMyEbookSubscriptions(
      custId,
      { search: search?.trim() || undefined, skip, take: limit },
      (eid) => buildShareUrl("ebooks", eid, base)
    );

    logger.info("listMySubscriptions success", { traceId, customerId: userId, count: subscriptions.length, source: "mysql" });
    return res.status(200).json({ success: true, data: { subscriptions }, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listMySubscriptions failed", { traceId, customerId: userId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/:id
export const getEbookDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  const customerId = (req as any).user?.id;
  logger.info("getEbookDetail invoked", { traceId, path: req.originalUrl, customerId, ebookId: id });

  try {
    // A MySQL ebook id is an int. Ebooks aren't in the promocode appliesTo
    // model, so the availablePromoCode list is always empty.
    const ebookId = parseEbookId(id);
    if (ebookId == null) {
      logger.warn("getEbookDetail invalid id (mysql)", { traceId, customerId, ebookId: id });
      return res.status(400).json({ success: false, message: "Please select valid ebook." });
    }
    const custId = customerId != null ? parseEbookId(String(customerId)) : null;
    const ebookData = await getEbookDetailWithPlans(
      ebookId,
      { customerId: custId ?? undefined },
      (eid) => buildShareUrl("ebooks", eid, resolveBase(req))
    );
    if (!ebookData) {
      logger.warn("getEbookDetail not found (mysql)", { traceId, customerId, ebookId: id });
      return res.status(404).json({ success: false, message: "Ebook not found." });
    }
    logger.info("getEbookDetail success", { traceId, customerId, ebookId: id, isPurchased: ebookData.isPurchased, source: "mysql" });
    return res.status(200).json({
      success: true,
      data: { ebook: ebookData, availablePromoCode: [] },
    });
  } catch (error: any) {
    logger.error("getEbookDetail failed", { traceId, customerId, ebookId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/orders/:orderId/invoice
export const getEbookOrderInvoice = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = (req as any).user?.id;
  const orderId = req.params.orderId as string;
  logger.info("getEbookOrderInvoice invoked", { traceId, path: req.originalUrl, customerId, orderId });

  try {
    if (!customerId) {
      logger.warn("getEbookOrderInvoice unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // Accept a SQL int order id (MySQL id-space) OR a Mongo ObjectId; the
    // receipt builder branches on isMysqlModule and re-validates ownership.
    if (!isObjectId(orderId) && !/^[1-9][0-9]*$/.test(orderId)) {
      logger.warn("getEbookOrderInvoice invalid id", { traceId, customerId, orderId });
      return res.status(400).json({ success: false, message: "Invalid order id." });
    }

    const pdf = await generateEbookReceipt(orderId, customerId);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
    });
    logger.info("getEbookOrderInvoice success", { traceId, customerId, orderId, bytes: pdf.length });
    return res.send(pdf);
  } catch (error: any) {
    const msg = error?.message || "Failed to generate invoice.";
    const code = /not found|invalid|not been paid/i.test(msg) ? 404 : 500;
    if (code === 500) {
      logger.error("getEbookOrderInvoice failed", { traceId, customerId, orderId, error: getErrorMessage(error), stack: error.stack });
    } else {
      logger.warn("getEbookOrderInvoice client error", { traceId, customerId, orderId, msg });
    }
    return res.status(code).json({ success: false, message: msg });
  }
};
