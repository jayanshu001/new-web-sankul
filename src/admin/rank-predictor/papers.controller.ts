import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { rankPredictorService } from "../../modules/rank-predictor/rank-predictor.service";
import {
  examCreateSchema,
  examUpdateSchema,
} from "../../modules/rank-predictor/rank-predictor.validation";
import { buildPagination, parseListQuery } from "../../utils/listQuery";
import { success } from "../../utils/httpResponse";
import { adminIdOf, bigIntParam, requireStatusFlag } from "./rank-predictor.helpers";

export const listPapers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const isActive =
    req.query.isActive === undefined ? undefined : String(req.query.isActive) === "true";

  const { items, total } = await rankPredictorService.listExams({ search, page, limit, isActive });

  return res.json({ success: true, data: items, pagination: buildPagination(total, page, limit) });
});

export const getPaper = asyncHandler(async (req: Request, res: Response) =>
  success(res, await rankPredictorService.getExam(bigIntParam(req, "id")))
);

export const createPaper = asyncHandler(async (req: Request, res: Response) => {
  const body = examCreateSchema.parse(req.body);
  const exam = await rankPredictorService.createExam({ ...body, adminId: adminIdOf(req) });

  return success(res, exam, "Exam created.", 201);
});

export const updatePaper = asyncHandler(async (req: Request, res: Response) => {
  const body = examUpdateSchema.parse(req.body);
  const exam = await rankPredictorService.updateExam(
    bigIntParam(req, "id"),
    body,
    adminIdOf(req)
  );

  return success(res, exam, "Exam updated.");
});

export const setPaperStatus = asyncHandler(async (req: Request, res: Response) => {
  const exam = await rankPredictorService.updateExam(
    bigIntParam(req, "id"),
    { isActive: requireStatusFlag(req.body) },
    adminIdOf(req)
  );

  return success(res, exam, "Status updated.");
});

export const deletePaper = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.deleteExam(bigIntParam(req, "id"), adminIdOf(req));

  return success(res, result, "Paper deleted.");
});

export const getPaperLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { entries, total } = await rankPredictorService.getAdminLeaderboard({
    examId: bigIntParam(req, "examId"),
    page,
    pageSize: limit,
  });

  return res.json({
    success: true,
    data: entries,
    pagination: buildPagination(total, page, limit),
  });
});
