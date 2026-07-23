import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { omit } from "../../utils/pick";
import * as ecSql from "../../modules/exam-countdown/exam-countdown.service";

// UTC midnight of "now" — anchor for daysLeft math (timezone-stable).
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// GET /client/exam-countdowns/categories
export const listCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCategories invoked", { traceId, path: req.originalUrl });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const r = await ecSql.listCategoriesClient({ search: search || null, skip, limit, page });
    const data = r.data;
    const total = r.total;
    logger.info("listCategories success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("listCategories failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdowns?categoryId=&search=&page=1&limit=20&includePast=false
export const listCountdowns = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCountdowns invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);
    const { categoryId, includePast = "false" } = req.query as Record<string, string>;

    let catId: number | null = null;
    if (categoryId) {
      catId = ecSql.parseEcId(categoryId);
      if (catId == null) {
        logger.warn("listCountdowns invalid categoryId", { traceId, categoryId });
        return res.status(400).json({ success: false, message: "Invalid categoryId." });
      }
    }
    const r = await ecSql.listCountdownsClient({
      categoryId: catId, search: search || null, includePast: includePast === "true",
      skip, limitNum: limit, pageNum: page, todayUTC: todayUTC(),
    });
    logger.info("listCountdowns success (sql)", { traceId, total: r.total });
    // ExamCountdownListing cards never read category._id (see docs/api-optimization).
    const data = (r.data ?? []).map((row: any) =>
      row?.category ? { ...row, category: omit(row.category, ["_id"]) } : row
    );
    return res.status(200).json({
      success: true, data,
      pagination: buildPagination(r.total, page, limit),
    });
  } catch (error: any) {
    logger.error("listCountdowns failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdowns/upcoming?limit=5
export const upcomingCountdowns = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("upcomingCountdowns invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query);

    const r = await ecSql.upcomingCountdownsClient({
      search: search || null, skip, limit, page, todayUTC: todayUTC(),
    });
    logger.info("upcomingCountdowns success (sql)", { traceId, count: r.data.length });
    return res.status(200).json({
      success: true, data: r.data,
      pagination: buildPagination(r.total, page, limit),
    });
  } catch (error: any) {
    logger.error("upcomingCountdowns failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
