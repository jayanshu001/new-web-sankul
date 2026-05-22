import { Request, Response } from "express";
import mongoose from "mongoose";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { EbookDownload } from "../../models/ebook/EbookDownload.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

function userId(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

async function activeSubscriptionEbookIds(
  customerId: string,
  now: Date = new Date(),
  filterEbookIds?: mongoose.Types.ObjectId[]
): Promise<Set<string>> {
  const match: any = {
    customerId: new mongoose.Types.ObjectId(customerId),
    status: true,
    endAt: { $gt: now },
  };
  if (filterEbookIds && filterEbookIds.length) {
    match.ebookId = { $in: filterEbookIds };
  }
  const rows = await EbookSubscription.find(match).select("ebookId").lean();
  return new Set(rows.map((r: any) => String(r.ebookId)));
}

// POST /api/v1/client/ebooks/:id/download
// Records a per-user download row and returns the PDF URL. Idempotent: a
// repeat tap refreshes `downloadedAt` without duplicating the row.
export const recordEbookDownload = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const uid = userId(req);
  const ebookId = String(req.params.id);
  logger.info("recordEbookDownload invoked", { traceId, path: req.originalUrl, customerId: uid, ebookId });

  try {
    if (!uid) {
      logger.warn("recordEbookDownload unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    if (!isObjectId(ebookId)) {
      logger.warn("recordEbookDownload invalid id", { traceId, customerId: uid, ebookId });
      return res.status(400).json({ success: false, message: "Invalid ebook id." });
    }

    const ebook = await Ebook.findOne({ _id: ebookId, status: true })
      .select("_id name bookUrl")
      .lean();
    if (!ebook) {
      logger.warn("recordEbookDownload not found", { traceId, customerId: uid, ebookId });
      return res.status(404).json({ success: false, message: "Ebook not found." });
    }

    const activeIds = await activeSubscriptionEbookIds(uid, new Date(), [
      new mongoose.Types.ObjectId(ebookId),
    ]);
    if (!activeIds.has(String(ebookId))) {
      logger.warn("recordEbookDownload no active subscription", { traceId, customerId: uid, ebookId });
      return res
        .status(403)
        .json({ success: false, message: "Active subscription required to download." });
    }

    if (!ebook.bookUrl) {
      logger.warn("recordEbookDownload no pdf", { traceId, customerId: uid, ebookId });
      return res
        .status(404)
        .json({ success: false, message: "This ebook has no downloadable PDF." });
    }

    await EbookDownload.updateOne(
      { customerId: uid, ebookId },
      { $set: { downloadedAt: new Date() }, $setOnInsert: { customerId: uid, ebookId } },
      { upsert: true }
    );

    logger.info("recordEbookDownload success", { traceId, customerId: uid, ebookId });
    return res.status(200).json({
      success: true,
      message: "Download recorded.",
      data: { ebookId: ebook._id, bookUrl: ebook.bookUrl },
    });
  } catch (error: any) {
    logger.error("recordEbookDownload failed", { traceId, customerId: uid, ebookId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/downloads
// Lists this customer's downloaded ebooks, filtered to those whose subscription
// is still active (matches in-app copy "Downloads are removed when your
// subscription ends.").
export const listEbookDownloads = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const uid = userId(req);
  logger.info("listEbookDownloads invoked", { traceId, path: req.originalUrl, customerId: uid });

  try {
    if (!uid) {
      logger.warn("listEbookDownloads unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const rows = await EbookDownload.find({ customerId: uid })
      .sort({ downloadedAt: -1 })
      .lean();
    if (!rows.length) {
      logger.info("listEbookDownloads empty", { traceId, customerId: uid });
      return res.status(200).json({ success: true, data: [] });
    }

    const ebookIds = rows.map((r: any) => r.ebookId);
    const activeIds = await activeSubscriptionEbookIds(uid, new Date(), ebookIds);
    const ebooks = await Ebook.find({ _id: { $in: ebookIds }, status: true })
      .select("_id name author image thumbnail bookUrl language")
      .lean();
    const ebookById = new Map<string, any>(ebooks.map((e: any) => [String(e._id), e]));

    const data = rows
      .filter((r: any) => activeIds.has(String(r.ebookId)) && ebookById.has(String(r.ebookId)))
      .map((r: any) => {
        const e = ebookById.get(String(r.ebookId));
        return {
          _id: r._id,
          ebookId: e._id,
          name: e.name,
          author: e.author,
          image: e.image ?? null,
          thumbnail: e.thumbnail ?? null,
          language: e.language,
          bookUrl: e.bookUrl ?? null,
          downloadedAt: r.downloadedAt,
        };
      });

    logger.info("listEbookDownloads success", { traceId, customerId: uid, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("listEbookDownloads failed", { traceId, customerId: uid, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/v1/client/ebooks/downloads/:ebookId
export const removeEbookDownload = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const uid = userId(req);
  const ebookId = String(req.params.ebookId);
  logger.info("removeEbookDownload invoked", { traceId, path: req.originalUrl, customerId: uid, ebookId });

  try {
    if (!uid) {
      logger.warn("removeEbookDownload unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    if (!isObjectId(ebookId)) {
      logger.warn("removeEbookDownload invalid id", { traceId, customerId: uid, ebookId });
      return res.status(400).json({ success: false, message: "Invalid ebook id." });
    }

    const result = await EbookDownload.deleteOne({ customerId: uid, ebookId });
    if (!result.deletedCount) {
      logger.warn("removeEbookDownload not found", { traceId, customerId: uid, ebookId });
      return res.status(404).json({ success: false, message: "Download not found." });
    }
    logger.info("removeEbookDownload success", { traceId, customerId: uid, ebookId });
    return res.status(200).json({ success: true, message: "Removed from downloads." });
  } catch (error: any) {
    logger.error("removeEbookDownload failed", { traceId, customerId: uid, ebookId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Internal helper for the profile dashboard (Step 2): counts only entries
// whose subscription is still active, matching what `listEbookDownloads` shows.
export async function countActiveEbookDownloads(customerId: string): Promise<number> {
  const rows = await EbookDownload.find({ customerId }).select("ebookId").lean();
  if (!rows.length) return 0;
  const ebookIds = rows.map((r: any) => r.ebookId);
  const [activeIds, liveEbooks] = await Promise.all([
    activeSubscriptionEbookIds(customerId, new Date(), ebookIds),
    Ebook.find({ _id: { $in: ebookIds }, status: true }).select("_id").lean(),
  ]);
  const liveIds = new Set(liveEbooks.map((e: any) => String(e._id)));
  return rows.reduce(
    (n: number, r: any) =>
      activeIds.has(String(r.ebookId)) && liveIds.has(String(r.ebookId)) ? n + 1 : n,
    0
  );
}
