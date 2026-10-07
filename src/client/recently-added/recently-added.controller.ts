// Client recently added: dashboard "View All" list handler.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import logger from "../../utils/logger";
import * as recentSql from "../../modules/client-recently-added/client-recently-added.service";
import { omitList } from "../../utils/pick";

// "View All" behind the dashboard's Recently Added: planner + smart packages + live
// courses merged by created date desc. `kind` is an optional CSV; omitted/invalid
// means all three.
export const listRecentlyAdded = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listRecentlyAdded invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const { search, page, limit } = parseListQuery(req.query);
    const kinds = recentSql.parseKinds(req.query.kind as string | string[] | undefined);
    const customerId = recentSql.parseCustomerId(String(req.user?.id ?? ""));
    const r = await recentSql.listRecentlyAdded(customerId, { kinds, search: search ?? null, page, limit });
    logger.info("listRecentlyAdded success", { traceId, total: r.total, returned: r.data.length, kinds });
    // `packageType` and `kinds` are dropped; the app reads neither.
    return success(
      res,
      { data: omitList(r.data, ["packageType"]), pagination: buildPagination(r.total, r.page, r.limit) },
      "Recently added items fetched."
    );
  } catch (err) {
    logger.error("listRecentlyAdded failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list recently added items.", 500);
  }
};
