import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import logger from "../../utils/logger";
import * as recentSql from "../../modules/client-recently-added/client-recently-added.service";

// GET /api/v1/client/recently-added?kind=planner,smart,live-course&search=&page=&limit=
// The "View All" feed behind the dashboard's Recently Added section: newest
// Planner packages + Smart packages + live courses, merged by created date desc,
// with server-side search + pagination. Each item carries `kind` + `type` so the
// client can render/filter without a second lookup. `kind` is optional (CSV);
// omitted/invalid → all three kinds.
export const listRecentlyAdded = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listRecentlyAdded invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const { search, page, limit } = parseListQuery(req.query);
    const kinds = recentSql.parseKinds(req.query.kind as string | string[] | undefined);
    const customerId = recentSql.parseCustomerId(String(req.user?.id ?? ""));
    const r = await recentSql.listRecentlyAdded(customerId, { kinds, search: search ?? null, page, limit });
    logger.info("listRecentlyAdded success", { traceId, total: r.total, returned: r.data.length, kinds });
    return success(
      res,
      { data: r.data, kinds, pagination: buildPagination(r.total, r.page, r.limit) },
      "Recently added items fetched."
    );
  } catch (err) {
    logger.error("listRecentlyAdded failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list recently added items.", 500);
  }
};
