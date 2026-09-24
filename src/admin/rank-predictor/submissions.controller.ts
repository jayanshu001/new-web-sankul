import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import { rankPredictorService } from "../../modules/rank-predictor/rank-predictor.service";
import {
  toRankScoreDto,
  toRankSubmissionDto,
} from "../../modules/rank-predictor/rank-predictor.transformer";
import {
  RANK_ERROR,
  isSubmissionStatus,
} from "../../modules/rank-predictor/rank-predictor.types";
import { correctionsSchema } from "../../modules/rank-predictor/rank-predictor.validation";
import { getSignedRankPdfUrl } from "../../utils/rankSheetStorage";
import { buildPagination, parseListQuery } from "../../utils/listQuery";
import { success } from "../../utils/httpResponse";
import { adminIdOf, bigIntParam } from "./rank-predictor.helpers";

export const listSubmissions = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parseListQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
  const status = isSubmissionStatus(req.query.status) ? req.query.status : undefined;

  const { rows, total } = await rankPredictorService.listSubmissions({
    status,
    examId: req.query.examId ? BigInt(String(req.query.examId)) : undefined,
    page,
    limit,
  });

  const customers = await rankPredictorService.resolveCustomers(rows.map((row) => row.customerId));

  const data = rows.map((row) => ({
    ...toRankSubmissionDto(row),
    exam_name: row.exam.name,
    exam_code: row.exam.code,
    customer_id: row.customerId,
    customer: customers.get(row.customerId) ?? null,
    score: row.score ? toRankScoreDto(row.score, row.exam.totalQuestions) : null,
  }));

  return res.json({ success: true, data, pagination: buildPagination(total, page, limit) });
});

export const getSubmission = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.getSubmission(bigIntParam(req, "id"), null);
  const customers = await rankPredictorService.resolveCustomers([result.customer_id]);

  return success(res, { ...result, customer: customers.get(result.customer_id) ?? null });
});

export const getSubmissionFile = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.getSubmission(bigIntParam(req, "id"), null);
  if (!result.source_pdf_key) {
    throw new HttpError(404, "That sheet is no longer available.", { error: RANK_ERROR.NOT_FOUND });
  }

  return res.redirect(await getSignedRankPdfUrl(result.source_pdf_key));
});

export const correctAnswers = asyncHandler(async (req: Request, res: Response) => {
  const body = correctionsSchema.parse(req.body);
  const result = await rankPredictorService.confirmCorrections({
    submissionId: bigIntParam(req, "id"),
    corrections: body.corrections,
    actorCustomerId: null,
  });

  return success(res, result, "Answers corrected.");
});

export const deleteSubmission = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.deleteSubmission(
    bigIntParam(req, "id"),
    adminIdOf(req)
  );

  return success(
    res,
    result,
    result.score_removed
      ? "Submission deleted. The published score was removed and the student can upload again."
      : "Submission deleted. The student can upload again."
  );
});

export const rescoreSubmission = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.rescoreSubmission(bigIntParam(req, "id"));

  return success(res, result, "Submission rescored.");
});
