import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
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
    const {
      categoryId,
      search = "",
      page = "1",
      limit = "20",
      includePast = "false",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

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
      skip, limitNum, pageNum, todayUTC: todayUTC(),
    });
    logger.info("listCountdowns success (sql)", { traceId, total: r.total });
    return res.status(200).json({
      success: true, data: r.data,
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
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
    const requested = parseInt((req.query.limit as string) ?? "5", 10) || 5;
    const limitNum = Math.min(Math.max(requested, 1), 20);

    const data = await ecSql.upcomingCountdownsClient(limitNum, todayUTC());
    logger.info("upcomingCountdowns success (sql)", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("upcomingCountdowns failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
