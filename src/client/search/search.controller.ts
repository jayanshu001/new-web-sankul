import { Request, Response } from "express";
import * as searchSql from "../../modules/client-search/client-search.service";
import * as searchHistory from "../../modules/client-search-history/client-search-history.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// GET /api/v1/client/search?q=&type=courses|packages|liveCourses|books|ebooks&page=&limit=
// Omit `type` (or pass an unknown one) to search ALL five entity types at once.
export const globalSearch = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("globalSearch invoked", { traceId, path: req.originalUrl, userId: req.user?.id, q: req.query.q, type: req.query.type });

  try {
    const { q, type } = req.query as Record<string, string>;
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);

    const skip = (page - 1) * limit;

    // Record this term in the customer's recent-search history (dedupe →
    // move-to-top → trim to newest 10). Fire-and-forget: history persistence
    // must never block or fail the actual search response. Only the first page
    // is recorded so paginating an existing query doesn't re-stamp it.
    const historyCustomerId = req.user?.id ? Number(req.user.id) : null;
    if (page === 1 && historyCustomerId) {
      searchHistory
        .record(historyCustomerId, q)
        .catch((err) => logger.warn("search history record failed", { traceId, error: getErrorMessage(err) }));
    }

    // ─── SQL branch (int id-space) ───
    const userNum = req.user?.id ? Number(req.user.id) : null;
    const cid = Number.isInteger(userNum) ? userNum : null;
    if (!type || !searchSql.SEARCH_TYPES.includes(type as any)) {
      const results = await Promise.all(
        searchSql.SEARCH_TYPES.map(async (key) => {
          const { items, total } = await searchSql.searchType(key, q, cid, skip, limit);
          return [key, { items, total, hasMore: skip + items.length < total }] as const;
        })
      );
      const data = Object.fromEntries(results);
      const grandTotal = results.reduce((sum, [, v]) => sum + v.total, 0);
      return res.status(200).json({ success: true, data: { type: "all", page, limit, total: grandTotal, results: data } });
    }
    const { items, total } = await searchSql.searchType(type as any, q, cid, skip, limit);
    return res.status(200).json({ success: true, data: { type, items, total, page, limit, hasMore: skip + items.length < total } });
  } catch (error: any) {
    logger.error("globalSearch failed", { traceId, q: req.query.q, type: req.query.type, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
