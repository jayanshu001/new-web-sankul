import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as dlSql from "../../modules/client-ebook-download/client-ebook-download.service";
import { signMediaToken } from "../../utils/mediaToken";
import { omitList } from "../../utils/pick";

function userId(req: Request): string | null {
  return (req as any).user?.id ?? null;
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

    const cid = dlSql.parseDlId(String(uid));
    const eId = dlSql.parseDlId(ebookId);
    if (cid == null || eId == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ebook = await dlSql.findActiveEbook(eId);
    if (!ebook) return res.status(404).json({ success: false, message: "Ebook not found." });
    if (!(await dlSql.hasActiveSub(cid, eId))) return res.status(403).json({ success: false, message: "Active subscription required to download." });
    if (!ebook.bookUrl) return res.status(404).json({ success: false, message: "This ebook has no downloadable PDF." });
    await dlSql.recordDownload(cid, eId);
    logger.info("recordEbookDownload success (sql)", { traceId, customerId: uid, ebookId });
    // Entitlement already checked above → issue a book media token the client
    // exchanges at /media/resolve for a short-lived presigned URL. No raw URL.
    const mediaToken = signMediaToken({ k: "ebook", id: ebook.id, scope: { kind: "ebook", id: ebook.id }, cust: cid });
    return res.status(200).json({ success: true, message: "Download recorded.", data: { ebookId: String(ebook.id), mediaToken } });
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

    const cid = dlSql.parseDlId(String(uid));
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
    const data = await dlSql.listDownloads(cid);
    logger.info("listEbookDownloads success (sql)", { traceId, customerId: uid, count: data.length });
    // Downloads hub reads only _id/ebookId/name/mediaToken (see
    // docs/api-optimization/GET_client_ebooks_downloads.md); mediaToken preserved.
    return res.status(200).json({ success: true, data: omitList(data, ["author", "image", "thumbnail", "language", "downloadedAt"]) });
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

    const cid = dlSql.parseDlId(String(uid));
    const eId = dlSql.parseDlId(ebookId);
    if (cid == null || eId == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await dlSql.removeDownload(cid, eId);
    if (!ok) return res.status(404).json({ success: false, message: "Download not found." });
    logger.info("removeEbookDownload success (sql)", { traceId, customerId: uid, ebookId });
    return res.status(200).json({ success: true, message: "Removed from downloads." });
  } catch (error: any) {
    logger.error("removeEbookDownload failed", { traceId, customerId: uid, ebookId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Internal helper for the profile dashboard (Step 2): counts only entries
// whose subscription is still active, matching what `listEbookDownloads` shows.
export async function countActiveEbookDownloads(customerId: string): Promise<number> {
  const cid = dlSql.parseDlId(String(customerId));
  return cid == null ? 0 : dlSql.countActiveDownloads(cid);
}
