import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { HttpError } from "../../middlewares/errorHandler";
import { rankPredictorService } from "../../modules/rank-predictor/rank-predictor.service";
import {
  RANK_ERROR,
  type CandidateProfileInput,
  type CasteCategory,
  type Gender,
  type RankExamDto,
} from "../../modules/rank-predictor/rank-predictor.types";
import { getSignedRankPdfUrl } from "../../utils/rankSheetStorage";
import { success } from "../../utils/httpResponse";
import { SheetUrlError, fetchSheetPdf } from "../../utils/sheetUrlFetch";

interface ExamListQuery {
  search?: string;
  page: number;
  limit: number;
}

interface LeaderboardQuery {
  page: number;
  pageSize: number;
  shift?: string;
  category?: CasteCategory;
  gender?: Gender;
  subject?: string;
}

const customerIdOf = (req: Request): number => Number(req.user!.id);

const optionalCustomerIdOf = (req: Request): number | null =>
  req.user?.id ? Number(req.user.id) : null;

const examIdOf = (req: Request): bigint => BigInt(req.params.examId as string);

const submissionIdOf = (req: Request): bigint => BigInt(req.params.submissionId as string);

const requireActiveExam = async (req: Request): Promise<RankExamDto> => {
  const exam = await rankPredictorService.getExam(examIdOf(req));
  if (!exam.is_active) {
    throw new HttpError(404, "That paper is not open right now.", {
      error: RANK_ERROR.EXAM_NOT_FOUND,
    });
  }

  return exam;
};

export const listExams = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit } = req.query as unknown as ExamListQuery;
  const { items, total } = await rankPredictorService.listExams({
    search,
    page,
    limit,
    isActive: true,
  });

  return success(res, { exams: items, total });
});

export const getExam = asyncHandler(async (req: Request, res: Response) =>
  success(res, { exam: await requireActiveExam(req) })
);

export const getLeaderboard = asyncHandler(async (req: Request, res: Response) => {
  await requireActiveExam(req);

  const { page, pageSize, shift, category, gender, subject } = req.query as unknown as LeaderboardQuery;
  const { entries, total } = await rankPredictorService.getLeaderboard({
    examId: examIdOf(req),
    page,
    pageSize,
    scope: { shiftKey: shift, casteCategory: category, gender, subject },
    viewerCustomerId: optionalCustomerIdOf(req),
  });

  return success(res, { entries, total, page, page_size: pageSize });
});

export const createSubmission = asyncHandler(async (req: Request, res: Response) => {
  const { series, sheet_url: sheetUrl } = req.body as {
    series?: string | null;
    sheet_url?: string;
  };

  if (!req.file && !sheetUrl) {
    throw new HttpError(400, "Please choose your response sheet PDF or paste its link.", {
      error: RANK_ERROR.FILE_REQUIRED,
    });
  }

  await requireActiveExam(req);

  let sheet: { buffer: Buffer; fileName: string };
  if (req.file) {
    sheet = { buffer: req.file.buffer, fileName: req.file.originalname };
  } else {
    try {
      sheet = await fetchSheetPdf(sheetUrl as string);
    } catch (error) {
      if (!(error instanceof SheetUrlError)) throw error;
      const unreachable = error.code === RANK_ERROR.SHEET_URL_UNREACHABLE;
      throw new HttpError(
        unreachable ? 422 : 400,
        unreachable
          ? "We could not download a PDF from that link."
          : "That link is not a public https link to a PDF.",
        { error: error.code }
      );
    }
  }

  const result = await rankPredictorService.createSubmission({
    examId: examIdOf(req),
    customerId: customerIdOf(req),
    series: series ?? null,
    fileBuffer: sheet.buffer,
    fileName: sheet.fileName,
  });

  return success(res, result, "Sheet uploaded.", 201);
});

export const createMarksSubmission = asyncHandler(async (req: Request, res: Response) => {
  await requireActiveExam(req);

  const { series, marks, shift } = req.body as {
    series?: string | null;
    marks: number;
    shift?: string | null;
  };
  const result = await rankPredictorService.createMarksSubmission({
    examId: examIdOf(req),
    customerId: customerIdOf(req),
    series: series ?? null,
    marks,
    shiftKey: shift ?? null,
  });

  return success(res, result, "Marks saved.", 201);
});

export const getSubmission = asyncHandler(async (req: Request, res: Response) =>
  success(res, await rankPredictorService.getSubmission(submissionIdOf(req), customerIdOf(req)))
);

export const getSubmissionFile = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.getSubmission(
    submissionIdOf(req),
    customerIdOf(req)
  );
  if (!result.source_pdf_key) {
    throw new HttpError(404, "That sheet is no longer available.", { error: RANK_ERROR.NOT_FOUND });
  }

  return res.redirect(await getSignedRankPdfUrl(result.source_pdf_key));
});

export const confirmSubmission = asyncHandler(async (req: Request, res: Response) => {
  const customerId = customerIdOf(req);
  const submissionId = submissionIdOf(req);

  await rankPredictorService.getSubmission(submissionId, customerId);

  const { corrections, shift } = req.body as {
    corrections: Record<string, number | null>;
    shift?: string | null;
  };
  const result = await rankPredictorService.confirmCorrections({
    submissionId,
    corrections,
    shiftKey: shift ?? null,
    actorCustomerId: customerId,
  });

  return success(res, result, "Answers confirmed.");
});

export const getMyRank = asyncHandler(async (req: Request, res: Response) =>
  success(res, await rankPredictorService.getStanding(examIdOf(req), customerIdOf(req)))
);

export const getMyAnswerReview = asyncHandler(async (req: Request, res: Response) => {
  const review = await rankPredictorService.getMyAnswerReview(examIdOf(req), customerIdOf(req));

  return success(res, { review });
});

export const getMyRanks = asyncHandler(async (req: Request, res: Response) =>
  success(res, { ranks: await rankPredictorService.getMyRanks(customerIdOf(req)) })
);

export const getLeaderboardPrivacy = asyncHandler(async (req: Request, res: Response) =>
  success(res, await rankPredictorService.getLeaderboardPrivacy(customerIdOf(req)))
);

export const setLeaderboardPrivacy = asyncHandler(async (req: Request, res: Response) => {
  const { showRealName } = req.body as { showRealName: boolean };
  const result = await rankPredictorService.setLeaderboardPrivacy(
    customerIdOf(req),
    showRealName
  );

  return success(res, result, "Preference saved.");
});

export const getCandidateProfile = asyncHandler(async (req: Request, res: Response) =>
  success(res, await rankPredictorService.getCandidateProfile(customerIdOf(req)))
);

export const saveCandidateProfile = asyncHandler(async (req: Request, res: Response) => {
  const result = await rankPredictorService.saveCandidateProfile(
    customerIdOf(req),
    req.body as CandidateProfileInput
  );

  return success(res, result, "Details saved.");
});
