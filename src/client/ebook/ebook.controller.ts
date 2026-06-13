import { Request, Response } from "express";
import mongoose from "mongoose";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { generateEbookReceipt } from "../../libs/core/generate";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { isNewItem } from "../../utils/isNew";
import { buildSearchFilter } from "../../utils/searchFilter";
import { parseListQuery, buildPagination } from "../../utils/listQuery";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

// GET /api/v1/client/ebooks
export const listEbooks = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = (req as any).user?.id;
  logger.info("listEbooks invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { language } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);
    const filter: any = { status: true };
    Object.assign(filter, buildSearchFilter(search, ["name", "author"]));
    if (language) filter.language = language;

    const [ebooks, total] = await Promise.all([
      Ebook.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Ebook.countDocuments(filter),
    ]);
    const ebookIds = ebooks.map((e) => e._id);

    const plans = await EbookPrice.find({
      ebookId: { $in: ebookIds },
      status: true,
    })
      .sort({ duration: 1 })
      .lean();

    const plansByEbook: Record<string, any[]> = {};
    plans.forEach((p) => {
      const key = String(p.ebookId);
      (plansByEbook[key] ||= []).push(p);
    });

    // Ebook access is time-bound: only currently-active subscriptions count
    // as "purchased". Endpoint also returns the soonest expiry so the catalog
    // card can show "X days left" without a second call.
    const now = new Date();
    const activeByEbook = new Map<string, Date>();
    if (customerId && ebookIds.length) {
      const subs = await EbookSubscription.find({
        customerId,
        ebookId: { $in: ebookIds },
        status: true,
        endAt: { $gt: now },
      })
        .select("ebookId endAt")
        .lean();
      subs.forEach((s: any) => {
        const key = String(s.ebookId);
        const prev = activeByEbook.get(key);
        // If a customer somehow has two overlapping subs for the same ebook,
        // keep the LATEST endAt — that's the access window they actually have.
        if (!prev || s.endAt.getTime() > prev.getTime()) {
          activeByEbook.set(key, s.endAt);
        }
      });
    }

    const base = resolveBase(req);
    const data = ebooks.map((e) => {
      const endAt = activeByEbook.get(String(e._id)) || null;
      const ePlans = plansByEbook[String(e._id)] || [];
      // `isPaid` is now an admin-controlled field on the Ebook (default true).
      // It is the source of truth. Legacy rows that predate the field (absent
      // after backfill is impossible, but defensive) fall back to the old
      // price-derived rule: paid when ≥1 active plan costs > 0.
      const isPaid =
        typeof (e as any).isPaid === "boolean"
          ? (e as any).isPaid
          : ePlans.some((p: any) => (p.price ?? 0) > 0);
      return {
        ...e,
        plans: ePlans,
        details: [
          { id: 1, mainText: "Language", subText: e.language },
          { id: 2, mainText: "Author", subText: e.author },
          { id: 3, mainText: "Publisher", subText: e.publisher },
        ],
        isPaid,
        isPurchased: !!endAt,
        isNew: isNewItem(e.createdAt, now),
        subscriptionEndAt: endAt,
        daysLeft: endAt ? daysBetween(now, endAt) : null,
        shareableLink: buildShareUrl("ebooks", String(e._id), base),
      };
    });

    logger.info("listEbooks success", { traceId, customerId, count: data.length });
    return res.status(200).json({ success: true, data: { ebooks: data }, pagination: buildPagination(total, page, limit) });
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
    const now = new Date();
    const { search, page, limit, skip } = parseListQuery(req.query);

    // Optional search by ebook name/author — resolve matching ebook ids first,
    // then scope the subscription query to them (the searchable text lives on
    // the populated Ebook, not the subscription row).
    const baseFilter: any = { customerId: userId, endAt: { $gt: now }, status: true };
    const searchFilter = buildSearchFilter(search, ["name", "author"]);
    if (Object.keys(searchFilter).length) {
      const matchedIds = await Ebook.find({ status: true, ...searchFilter }).select("_id").lean();
      baseFilter.ebookId = { $in: matchedIds.map((e: any) => e._id) };
    }

    const [subs, total] = await Promise.all([
      EbookSubscription.find(baseFilter)
        .populate("ebookId")
        .sort({ endAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EbookSubscription.countDocuments(baseFilter),
    ]);

    const base = resolveBase(req);
    const subscriptions = subs
      .filter((s: any) => s.ebookId)
      .map((s: any) => ({
        ...s.ebookId,
        startAt: s.startAt,
        endAt: s.endAt,
        daysLeft: daysBetween(now, s.endAt),
        shareableLink: buildShareUrl("ebooks", String(s.ebookId._id), base),
      }));

    logger.info("listMySubscriptions success", { traceId, customerId: userId, count: subscriptions.length });
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
    if (!isObjectId(id)) {
      logger.warn("getEbookDetail invalid id", { traceId, customerId, ebookId: id });
      return res.status(400).json({ success: false, message: "Please select valid ebook." });
    }

    const ebook = await Ebook.findOne({ _id: id, status: true }).lean();
    if (!ebook) {
      logger.warn("getEbookDetail not found", { traceId, customerId, ebookId: id });
      return res.status(404).json({ success: false, message: "Ebook not found." });
    }

    const plans = await EbookPrice.find({ ebookId: id, status: true })
      .sort({ duration: 1 })
      .lean();

    // Active subscription lookup — same rule as listEbooks: latest endAt wins.
    const nowAccess = new Date();
    let subscriptionEndAt: Date | null = null;
    if (customerId) {
      const sub = await EbookSubscription.findOne({
        customerId,
        ebookId: id,
        status: true,
        endAt: { $gt: nowAccess },
      })
        .select("endAt")
        .sort({ endAt: -1 })
        .lean();
      if (sub) subscriptionEndAt = sub.endAt;
    }

    // Ebooks aren't in the new `appliesTo` enum, so no promocode can target an
    // ebook directly. List stays empty until the enum is extended.
    const availablePromoCode: Array<{
      title: string;
      promocode: string;
      description: string;
    }> = [];

    logger.info("getEbookDetail success", { traceId, customerId, ebookId: id, isPurchased: !!subscriptionEndAt });
    return res.status(200).json({
      success: true,
      data: {
        ebook: {
          ...ebook,
          plans,
          // Admin-controlled `isPaid` field is the source of truth (default
          // true); fall back to the price-derived rule only if it's absent.
          isPaid:
            typeof (ebook as any).isPaid === "boolean"
              ? (ebook as any).isPaid
              : plans.some((p: any) => (p.price ?? 0) > 0),
          isPurchased: !!subscriptionEndAt,
          isNew: isNewItem(ebook.createdAt, nowAccess),
          subscriptionEndAt,
          daysLeft: subscriptionEndAt ? daysBetween(nowAccess, subscriptionEndAt) : null,
          shareableLink: buildShareUrl("ebooks", id, resolveBase(req)),
        },
        availablePromoCode,
      },
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

    if (!isObjectId(orderId)) {
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
