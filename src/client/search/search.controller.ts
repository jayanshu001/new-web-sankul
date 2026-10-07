// Client search: global search across catalog entity types.
import { Request, Response } from "express";
import * as searchSql from "../../modules/client-search/client-search.service";
import * as searchHistory from "../../modules/client-search-history/client-search-history.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// Omit `type` (or pass an unknown one) to search ALL six entity types at once.
export const globalSearch = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("globalSearch invoked", { traceId, path: req.originalUrl, userId: req.user?.id, q: req.query.q, type: req.query.type });

  try {
    const { q, type } = req.query as Record<string, string>;
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 50);

    const skip = (page - 1) * limit;

    // Fire-and-forget: history must never block or fail the search. Only page 1 is
    // recorded so paginating doesn't re-stamp the term.
    const historyCustomerId = req.user?.id ? Number(req.user.id) : null;
    if (page === 1 && historyCustomerId) {
      searchHistory
        .record(historyCustomerId, q)
        .catch((err) => logger.warn("search history record failed", { traceId, error: getErrorMessage(err) }));
    }

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
