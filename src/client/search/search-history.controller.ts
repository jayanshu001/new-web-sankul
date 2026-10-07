// Client search history: list, clear and delete recent searches.
// History is recorded fire-and-forget inside `globalSearch` (search.controller.ts), not here.
import { Request, Response } from "express";
import * as historyService from "../../modules/client-search-history/client-search-history.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import logger from "../../utils/logger";

const customerIdOf = (req: Request): number | null => {
  const n = req.user?.id ? Number(req.user.id) : null;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
};

export const listSearchHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const customerId = customerIdOf(req);
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const { search, page, limit, skip } = parseListQuery(req.query);
    const { items, total } = await historyService.listPaged(customerId, search, skip, limit);
    return success(res, { items, total, pagination: buildPagination(total, page, limit) }, "Recent searches fetched.");
  } catch (error: any) {
    logger.error("listSearchHistory failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return failure(res, getErrorMessage(error), 500);
  }
};

export const clearSearchHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const customerId = customerIdOf(req);
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const deleted = await historyService.clear(customerId);
    return success(res, { deleted }, "Search history cleared.");
  } catch (error: any) {
    logger.error("clearSearchHistory failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return failure(res, getErrorMessage(error), 500);
  }
};

export const deleteSearchHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const customerId = customerIdOf(req);
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const id = Number(req.params.id);
    const removed = await historyService.removeOne(customerId, id);
    if (!removed) return failure(res, "Search history entry not found.", 404);
    return success(res, {}, "Search history entry removed.");
  } catch (error: any) {
    logger.error("deleteSearchHistory failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return failure(res, getErrorMessage(error), 500);
  }
};
