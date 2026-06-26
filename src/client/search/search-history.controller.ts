/**
 * Recent Search History — client controllers.
 *
 * Endpoints (all Bearer-auth; mounted under /api/v1/client/search/history):
 *   GET    /            → latest 10 searches (newest first)
 *   DELETE /            → clear all history for the customer
 *   DELETE /:id         → remove a single history entry (scoped to the customer)
 *
 * Recording is NOT done here — it happens automatically (fire-and-forget) inside
 * `globalSearch` whenever a valid `q` is searched. See search.controller.ts.
 */
import { Request, Response } from "express";
import * as historyService from "../../modules/client-search-history/client-search-history.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

const customerIdOf = (req: Request): number | null => {
  const n = req.user?.id ? Number(req.user.id) : null;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
};

// GET /api/v1/client/search/history
export const listSearchHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const customerId = customerIdOf(req);
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const items = await historyService.list(customerId);
    return success(res, { items, total: items.length }, "Recent searches fetched.");
  } catch (error: any) {
    logger.error("listSearchHistory failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return failure(res, getErrorMessage(error), 500);
  }
};

// DELETE /api/v1/client/search/history
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

// DELETE /api/v1/client/search/history/:id
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
