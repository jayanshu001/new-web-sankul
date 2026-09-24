import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import { rankPredictorService } from "../../modules/rank-predictor/rank-predictor.service";
import {
  toRankAnswerKeyAdminDto,
  toRankAnswerKeyDto,
} from "../../modules/rank-predictor/rank-predictor.transformer";
import {
  RANK_ERROR,
  type AnswerKeyMap,
} from "../../modules/rank-predictor/rank-predictor.types";
import { answerKeyUploadSchema } from "../../modules/rank-predictor/rank-predictor.validation";
import {
  OcrExtractionError,
  extractResponseSheet,
  type OcrExtractionResult,
} from "../../utils/ocrExtractionClient";
import { answerKeyPdfKey, putRankPdf } from "../../utils/rankSheetStorage";
import { success } from "../../utils/httpResponse";
import {
  adminIdOf,
  bigIntParam,
  requireStatusFlag,
  rescoreMessage,
} from "./rank-predictor.helpers";

const markedAnswersOf = (extraction: OcrExtractionResult): AnswerKeyMap =>
  Object.fromEntries(
    Object.entries(extraction.answers).filter(([, option]) => option !== null)
  ) as AnswerKeyMap;

const keysFromPdf = async (file: Express.Multer.File): Promise<AnswerKeyMap> => {
  let extraction: OcrExtractionResult;
  try {
    extraction = await extractResponseSheet(file.buffer, file.originalname);
  } catch (error) {
    const code =
      error instanceof OcrExtractionError ? error.code : RANK_ERROR.EXTRACTION_UNREACHABLE;
    throw new HttpError(422, "We could not read that answer key.", { error: code });
  }

  const embedded = extraction.embedded_key_for_reference_only;

  return embedded && Object.keys(embedded).length ? embedded : markedAnswersOf(extraction);
};

export const listAnswerKeys = asyncHandler(async (req: Request, res: Response) => {
  const keys = await rankPredictorService.listAnswerKeys(bigIntParam(req, "examId"));

  return success(res, { answer_keys: keys.map(toRankAnswerKeyAdminDto) });
});

export const publishAnswerKey = asyncHandler(async (req: Request, res: Response) => {
  const examId = bigIntParam(req, "examId");
  const body = answerKeyUploadSchema.parse(req.body);
  const series = body.series ?? null;

  const keys = req.file ? await keysFromPdf(req.file) : (body.keys as AnswerKeyMap | undefined);

  if (!keys || !Object.keys(keys).length) {
    throw new HttpError(400, "Upload the answer key PDF, or paste the key.", {
      error: RANK_ERROR.ANSWER_KEY_REQUIRED,
    });
  }

  const { key, rescored, skipped } = await rankPredictorService.publishAnswerKey({
    examId,
    series,
    keys,
    marksCorrect: body.marksCorrect,
    marksWrong: body.marksWrong,
    sourcePdfKey: null,
    adminId: adminIdOf(req),
  });

  let sourcePdfKey: string | null = null;
  if (req.file) {
    sourcePdfKey = answerKeyPdfKey(String(examId), key.version, series);
    await putRankPdf(sourcePdfKey, req.file.buffer);
  }

  return success(
    res,
    toRankAnswerKeyDto({ ...key, sourcePdfKey }),
    rescoreMessage("Answer key published.", { rescored, skipped }),
    201
  );
});

export const setAnswerKeyStatus = asyncHandler(async (req: Request, res: Response) => {
  const { key, rescored, skipped } = await rankPredictorService.setAnswerKeyActive(
    bigIntParam(req, "id"),
    requireStatusFlag(req.body),
    adminIdOf(req)
  );

  return success(
    res,
    toRankAnswerKeyDto(key),
    rescoreMessage("Status updated.", { rescored, skipped })
  );
});
