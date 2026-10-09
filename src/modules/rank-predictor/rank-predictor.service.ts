import { isDeepStrictEqual } from "node:util";
import { OCR_SERVICE } from "../../config/ocrService";
import { HttpError } from "../../middlewares/errorHandler";
import {
  OcrExtractionError,
  extractResponseSheet,
  type OcrExtractionResult,
} from "../../utils/ocrExtractionClient";
import logger from "../../utils/logger";
import {
  copyRankPdf,
  deleteRankPdf,
  deleteRankPdfKeys,
  getRankPdf,
  listRankPdfKeys,
  organisedExamPrefix,
  organisedRankSheetKey,
  putRankPdf,
  rankSheetKey,
} from "../../utils/rankSheetStorage";
import { rankPredictorRepository as repo } from "./rank-predictor.repository";
import { enqueueRankSheet, rankSheetBacklog, waitForRankSheet } from "./rank-sheet.queue";
import {
  lowConfidencePct,
  normalizePaperSeries,
  percentileFor,
} from "./rank-predictor.scoring";
import { resolveSubjects, scoreWithSubjects } from "./rank-predictor.subjects";
import {
  answerKeyMapOf,
  answerMapOf,
  casteCategoryOf,
  displayNameFor,
  genderOf,
  examMarkingSchemeOf,
  keySourceOf,
  markingSchemeOf,
  parsePaperSeries,
  rankByOf,
  sectionByQuestionOf,
  sheetKeyMapOf,
  paperShiftsOf,
  submissionModesOf,
  withShiftCancellations,
  syllabusOf,
  toAdminLeaderboardEntryDto,
  toLeaderboardEntryDto,
  toRankAnswerReviewDto,
  toRankCandidateProfileDto,
  toRankCustomerDto,
  toRankExamDto,
  toRankScoreDto,
  toRankSubmissionDto,
  unknownRankCustomerDto,
} from "./rank-predictor.transformer";
import {
  ACTOR_TYPE,
  AUDIT_ACTION,
  AUDIT_ENTITY,
  ENTRY_MODE,
  KEY_SOURCE,
  NEARBY_RANK_RADIUS,
  NORMALIZATION_MIN_SHIFT_CANDIDATES,
  RANK_BY,
  PRISMA_UNIQUE_VIOLATION,
  RANK_ERROR,
  SUBMISSION_MODE,
  SUBMISSION_MODES,
  SUBMISSION_STATUS,
  SUBMISSION_WARNING,
  type ActorType,
  type AnswerKeyPublishInput,
  type AuditAction,
  type AnswerKeyMap,
  type AuditEntity,
  type BoardScope,
  type CandidateProfileInput,
  type KeySource,
  type SubmissionMode,
  type MarkingScheme,
  type PaperShift,
  type RankBy,
  type RankPositionDto,
  type RankSheetJobOutcome,
  type RankSheetStatusDto,
  type RankSubjectStandingDto,
  type SheetCandidate,
  type SubmissionWarning,
  type CasteCategory,
  type Gender,
  type ExamCreateInput,
  type ExamListParams,
  type ExamUpdateInput,
  type LeaderboardParams,
  type Paged,
  type RankAdminLeaderboardEntryDto,
  type RankAnswerReviewDto,
  type RankCandidateProfileDto,
  type RankCustomerDto,
  type RankExamDeletionDto,
  type RankExamDto,
  type RankLeaderboardEntryDto,
  type RankMyExamDto,
  type RankStandingDto,
  type ShiftNormalization,
  type RankSubmissionDeletionDto,
  type RankSubmissionResultDto,
  type RescoreOutcome,
  type MarksSubmissionInput,
  type SubmissionCreateInput,
  type SubmissionListParams,
  type SubmissionStatus,
} from "./rank-predictor.types";

type ExamRow = NonNullable<Awaited<ReturnType<typeof repo.findExamById>>>;

interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string | null;
  actorType: ActorType;
  actorId: number | null;
  metadata?: Record<string, unknown>;
}

const actorTypeFor = (customerId: number | null): ActorType =>
  customerId === null ? ACTOR_TYPE.ADMIN : ACTOR_TYPE.CUSTOMER;

const audit = async (entry: AuditEntry): Promise<void> => {
  try {
    await repo.writeAuditLog({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorType: entry.actorType,
      actorId: entry.actorId,
      metadata: (entry.metadata ?? {}) as never,
      createdAt: new Date(),
    });
  } catch {
    return;
  }
};

const decorateExams = async (rows: ExamRow[]): Promise<RankExamDto[]> => {
  const ids = rows.map((row) => row.id);
  const [counts, withKey] = await Promise.all([
    repo.countCandidatesByExam(ids),
    repo.examIdsWithActiveKey(ids),
  ]);

  return rows.map((row) =>
    toRankExamDto(row, counts.get(String(row.id)) ?? 0, withKey.has(String(row.id)))
  );
};

const decorateExam = async (row: ExamRow): Promise<RankExamDto> => (await decorateExams([row]))[0];

const requireExam = async (examId: bigint): Promise<ExamRow> => {
  const exam = await repo.findExamById(examId);
  if (!exam) throw new HttpError(404, "Exam not found.", { error: RANK_ERROR.EXAM_NOT_FOUND });
  return exam;
};

const requireSubmission = async (submissionId: bigint) => {
  const submission = await repo.findSubmissionWithScore(submissionId);
  if (!submission) throw new HttpError(404, "Submission not found.", { error: RANK_ERROR.NOT_FOUND });
  return submission;
};

const seriesError = (message: string, allowedSeries: string[]) =>
  new HttpError(400, message, {
    error: RANK_ERROR.SERIES_REQUIRED,
    allowed_series: allowedSeries,
  });

const assertSeriesAllowed = (allowedSeries: string[], series: string | null): void => {
  if (!allowedSeries.length) return;
  if (!series) throw seriesError("Please choose your paper series.", allowedSeries);
  if (!allowedSeries.includes(series)) {
    throw seriesError("That paper series is not valid for this exam.", allowedSeries);
  }
};

const failSubmission = async (
  submissionId: bigint,
  customerId: number,
  failureCode: string,
  action: AuditAction,
  metadata: Record<string, unknown>
): Promise<void> => {
  await repo.updateSubmission(submissionId, {
    status: SUBMISSION_STATUS.FAILED,
    failureCode,
    updatedAt: new Date(),
  });

  await audit({
    action,
    entityType: AUDIT_ENTITY.SUBMISSION,
    entityId: String(submissionId),
    actorType: ACTOR_TYPE.CUSTOMER,
    actorId: customerId,
    metadata,
  });
};

/** "YYYY-MM-DDTHH:MM" of the slot the sheet was sat in, or null when the sheet does not say. */
const shiftKeyOf = (candidate: SheetCandidate | null | undefined): string | null =>
  candidate?.test_date && candidate.test_start ? `${candidate.test_date}T${candidate.test_start}` : null;

type FolderProfile = { casteCategory: string | null; gender: string | null } | null;

interface FiledSheet {
  id: bigint;
  shiftKey: string | null;
  rollNumber: string | null;
  exam: { code: string };
}

/** A read sheet's place in the organised exam / shift / category / gender folders. */
const organisedKeyOf = (sheet: FiledSheet, profile: FolderProfile): string =>
  organisedRankSheetKey({
    examCode: sheet.exam.code,
    shiftKey: sheet.shiftKey,
    casteCategory: casteCategoryOf(profile),
    gender: genderOf(profile),
    rollNumber: sheet.rollNumber,
    submissionId: String(sheet.id),
  });

/**
 * Files a copy of the sheet in the organised folders. The copy is for browsing
 * only, so a failure here never fails the student's upload;
 * scripts/sync-rank-sheet-folders.ts files anything missed.
 */
const fileSheetCopy = async (sourceKey: string, targetKey: string, staleKey?: string): Promise<void> => {
  try {
    await copyRankPdf(sourceKey, targetKey);
    if (staleKey && staleKey !== targetKey) await deleteRankPdf(staleKey);
  } catch (error) {
    logger.warn("Rank sheet organised copy failed", {
      sourceKey,
      targetKey,
      error: (error as Error).message,
    });
  }
};

/** A changed category or gender moves the student's sheets to the matching folders. */
const refileCustomerSheets = async (
  customerId: number,
  before: FolderProfile,
  after: FolderProfile
): Promise<void> => {
  if (casteCategoryOf(before) === casteCategoryOf(after) && genderOf(before) === genderOf(after)) return;

  const sheets = await repo.listReadSheets(customerId);
  for (const sheet of sheets) {
    await fileSheetCopy(
      sheet.sourcePdfKey as string,
      organisedKeyOf(sheet, after),
      organisedKeyOf(sheet, before)
    );
  }
};

const positionOf = (board: {
  higher: number;
  candidates: number;
  average: number | null;
}): RankPositionDto => ({
  rank: board.higher + 1,
  percentile: percentileFor(board.higher + 1, board.candidates),
  total_candidates: board.candidates,
  average_marks: board.average,
});

/**
 * SSC-style normalization: each shift's marks are mapped linearly so that its
 * top-share mean (NORMALIZATION_TOP_SHARE, 1%, at least five) and its mean + SD
 * land on the whole field's. Null when the paper
 * does not normalize, has fewer than two shifts, or no shift is big enough.
 */
/**
 * The shift statistics are a window over every score of the paper, and they move
 * by a hair per sheet. Every upload and every result view needs them, so they are
 * held for a short while per paper (and shared by concurrent callers) instead of
 * being recomputed thousands of times in an exam-day rush.
 */
const NORMALIZATION_TTL_MS = 60_000;
const normalizationCache = new Map<string, { at: number; value: Promise<ShiftNormalization | null> }>();

const forgetNormalization = (): void => normalizationCache.clear();

const normalizationFor = async (exam: ExamRow): Promise<ShiftNormalization | null> => {
  if (!rankByOf(exam).includes(RANK_BY.NORMALIZED)) return null;

  const key = String(exam.id);
  const cached = normalizationCache.get(key);
  if (cached && Date.now() - cached.at < NORMALIZATION_TTL_MS) return cached.value;

  const value = computeNormalization(exam).catch((error) => {
    normalizationCache.delete(key);
    throw error;
  });
  normalizationCache.set(key, { at: Date.now(), value });
  return value;
};

const computeNormalization = async (exam: ExamRow): Promise<ShiftNormalization | null> => {
  const rows = await repo.shiftStats(exam.id);
  const field = rows.find((row) => row.shift_key === null);
  const shifts = rows.filter((row) => row.shift_key !== null);
  const fieldSpread = field ? field.top_mean - field.mean_plus_sd : 0;
  if (!field || shifts.length < 2 || fieldSpread <= 0) return null;

  const normalization: ShiftNormalization = new Map();
  for (const shift of shifts) {
    const spread = shift.top_mean - shift.mean_plus_sd;
    if (shift.candidates < NORMALIZATION_MIN_SHIFT_CANDIDATES || spread <= 0) continue;
    const scale = fieldSpread / spread;
    normalization.set(shift.shift_key as string, {
      scale,
      offset: field.mean_plus_sd - scale * shift.mean_plus_sd,
    });
  }

  return normalization.size ? normalization : null;
};

/** A raw mark on the common scale; a shift the normalization leaves out keeps its raw mark. */
const normalizedOf = (
  normalization: ShiftNormalization | null,
  shiftKey: string | null,
  rawScore: number
): number => {
  const map = shiftKey ? normalization?.get(shiftKey) : undefined;
  return map ? map.scale * rawScore + map.offset : rawScore;
};

/** The whole-paper board, on normalized marks when the paper normalizes. */
const overallStanding = async (exam: ExamRow, rawScore: number, shiftKey: string | null) => {
  const normalization = await normalizationFor(exam);
  return repo.rankForExam(exam.id, normalizedOf(normalization, shiftKey, rawScore), {}, normalization);
};

/** One page of a board. Shift and subject boards are within one sitting, so they stay raw. */
const boardPage = async (exam: ExamRow, skip: number, take: number, scope: BoardScope = {}) =>
  repo.leaderboardPage(
    exam.id,
    skip,
    take,
    scope,
    scope.shiftKey || scope.subject ? null : await normalizationFor(exam)
  );

/** Only the cancellations move a score; adding or renaming an empty slot does not. */
const cancellationsOf = (shifts: PaperShift[]): Record<string, number[]> =>
  Object.fromEntries(
    shifts
      .filter((shift) => shift.cancelled_questions.length)
      .map((shift) => [shift.key, shift.cancelled_questions])
  );

/** A marks_only paper takes nothing but typed marks, so switching those off would close it. */
const assertSubmissionModesFor = (keySource: KeySource, modes: SubmissionMode[]): void => {
  if (keySource === KEY_SOURCE.MARKS_ONLY && !modes.includes(SUBMISSION_MODE.MARKS)) {
    throw new HttpError(422, "A marks-only paper must accept typed marks.", {
      error: RANK_ERROR.SUBMISSION_MODES_INVALID,
    });
  }
};

/**
 * A marks_only paper has no sheet to read a slot off, so students pick from the
 * admin's list — which therefore has to exist. A cancelled question has to be on the paper.
 */
const assertShiftsFor = (keySource: KeySource, shifts: PaperShift[], totalQuestions: number): void => {
  if (keySource === KEY_SOURCE.MARKS_ONLY && !shifts.length) {
    throw new HttpError(422, "Add at least one shift: a marks-only paper ranks students by the shift they pick.", {
      error: RANK_ERROR.SHIFTS_REQUIRED,
    });
  }

  const outside = shifts.flatMap((shift) =>
    shift.cancelled_questions.filter((question) => question > totalQuestions)
  );
  if (outside.length) {
    throw new HttpError(422, `Cancelled questions must be between 1 and ${totalQuestions}.`, {
      error: RANK_ERROR.CANCELLED_QUESTION_OUT_OF_RANGE,
      questions: outside,
    });
  }
};

interface ResolvedKey {
  keys: AnswerKeyMap;
  scheme: MarkingScheme;
  answerKeyId: bigint | null;
}

/**
 * The key a sheet is marked against. A paper that opted into `sheet` uses the
 * correct answers printed on the sheet itself — which also stays right when the
 * board shuffles option order per candidate, as a positional admin key would not.
 * Everything else uses the admin's active key for the sheet's series.
 */
const resolveKey = async (
  exam: ExamRow,
  submission: {
    series: string | null;
    questionMeta: unknown;
    shiftKey: string | null;
  }
): Promise<ResolvedKey | { missing: SubmissionWarning }> => {
  if (keySourceOf(exam) === KEY_SOURCE.SHEET) {
    const keys = sheetKeyMapOf(submission as never);
    return keys
      ? {
          keys: withShiftCancellations(keys, exam, submission.shiftKey),
          scheme: examMarkingSchemeOf(exam),
          answerKeyId: null,
        }
      : { missing: SUBMISSION_WARNING.SHEET_HAS_NO_ANSWER_KEY };
  }

  const answerKey = await repo.findActiveAnswerKey(exam.id, submission.series);
  return answerKey
    ? {
        keys: withShiftCancellations(answerKeyMapOf(answerKey), exam, submission.shiftKey),
        scheme: markingSchemeOf(answerKey),
        answerKeyId: answerKey.id,
      }
    : { missing: SUBMISSION_WARNING.NO_ACTIVE_ANSWER_KEY };
};

/**
 * What a typed-in total may reach: the syllabus marks when every subject has
 * them, otherwise one mark scheme over every question.
 */
const maxMarksOf = async (exam: ExamRow): Promise<number> => {
  const syllabus = syllabusOf(exam);
  if (syllabus.length && syllabus.every((subject) => subject.marks !== undefined)) {
    return syllabus.reduce((sum, subject) => sum + (subject.marks as number), 0);
  }

  if (keySourceOf(exam) !== KEY_SOURCE.ADMIN_KEY) {
    return exam.totalQuestions * examMarkingSchemeOf(exam).marksCorrect;
  }

  const [latest] = await repo.listAnswerKeys(exam.id);
  return exam.totalQuestions * (latest ? markingSchemeOf(latest).marksCorrect : 1);
};

/** A board the admin has not switched on is refused rather than silently served. */
const assertBoardEnabled = (exam: ExamRow, scope: BoardScope | undefined): void => {
  const enabled = rankByOf(exam);
  const wanted: [boolean, RankBy][] = [
    [Boolean(scope?.shiftKey), RANK_BY.SHIFT],
    [Boolean(scope?.casteCategory), RANK_BY.CATEGORY],
    [Boolean(scope?.subject), RANK_BY.SUBJECT],
  ];

  for (const [requested, breakdown] of wanted) {
    if (requested && !enabled.includes(breakdown)) {
      throw new HttpError(400, `This paper does not rank by ${breakdown}.`, {
        error: RANK_ERROR.RANK_BREAKDOWN_DISABLED,
        breakdown,
      });
    }
  }

  if (scope?.subject && (scope.shiftKey || scope.casteCategory || scope.gender || scope.exServiceman)) {
    throw new HttpError(400, "A subject board cannot be narrowed by shift, category, gender or ex-serviceman.", {
      error: RANK_ERROR.RANK_BREAKDOWN_DISABLED,
      breakdown: RANK_BY.SUBJECT,
    });
  }
};

/** Sheets re-marked at once; each is a handful of queries, so a few in flight keep the pool busy, not full. */
const RESCORE_CONCURRENCY = Number(process.env.RANK_RESCORE_CONCURRENCY) || 8;

/**
 * Re-marks the given sheets, a few at a time. A sheet that fails is counted and
 * logged, never fatal: the rest of the paper still moves.
 */
const rescoreMany = async (submissionIds: bigint[]): Promise<RescoreOutcome> => {
  let rescored = 0;
  let skipped = 0;
  let next = 0;

  const lane = async (): Promise<void> => {
    while (next < submissionIds.length) {
      const submissionId = submissionIds[next++];
      try {
        await rankPredictorService.scoreAndPublish(submissionId, null, { bulk: true });
        rescored += 1;
      } catch (error) {
        skipped += 1;
        logger.warn("Rank rescore failed for a sheet", {
          submissionId: String(submissionId),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(RESCORE_CONCURRENCY, submissionIds.length) }, lane));
  forgetNormalization();
  return { rescored, skipped };
};

const rescoreSeries = async (
  examId: bigint,
  series: string | null,
  adminId: number | null
): Promise<RescoreOutcome> => {
  const submissions = await repo.listScoredSubmissions(examId, series);
  const { rescored, skipped } = await rescoreMany(submissions.map((submission) => submission.id));

  if (submissions.length) {
    await audit({
      action: AUDIT_ACTION.ANSWER_KEY_RESCORE,
      entityType: AUDIT_ENTITY.EXAM,
      entityId: String(examId),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: adminId,
      metadata: { series, rescored, skipped },
    });
  }

  return { rescored, skipped };
};

/**
 * Re-marks every processed sheet of a paper after its key source, marking or
 * syllabus changed, so totals, subject scores and every board describe the
 * current setup. Inline like `rescoreSeries`, and with the same scale caveat.
 */
const rescoreExam = async (examId: bigint, adminId: number | null): Promise<RescoreOutcome> => {
  const submissions = await repo.listProcessedSubmissionIds(examId);
  const { rescored, skipped } = await rescoreMany(submissions.map((submission) => submission.id));

  if (submissions.length) {
    await audit({
      action: AUDIT_ACTION.EXAM_RESCORED,
      entityType: AUDIT_ENTITY.EXAM,
      entityId: String(examId),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: adminId,
      metadata: { rescored, skipped },
    });
  }

  return { rescored, skipped };
};

const settled = (status: number, message: string, details: Record<string, unknown>): RankSheetJobOutcome => ({
  ok: false,
  status,
  message,
  details,
});

/**
 * Reads, checks and scores one stored sheet. Every reason a sheet is unusable is
 * settled here as a failed outcome, once; only a passing failure (storage or the
 * OCR service unreachable, overloaded or timed out, a database blip) is thrown,
 * so the queue retries it. Safe to run twice for the same sheet: a sheet already
 * read is only scored again.
 */
const readQueuedSheet = async (
  submissionId: bigint,
  fileBuffer?: Buffer
): Promise<RankSheetJobOutcome> => {
  const submission = await repo.findSubmissionWithExam(submissionId);
  if (!submission) return settled(404, "Submission not found.", { error: RANK_ERROR.NOT_FOUND });

  if (submission.status === SUBMISSION_STATUS.PROCESSED) {
    return { ok: true, result: await rankPredictorService.scoreAndPublish(submission.id, submission.customerId) };
  }
  if (submission.status === SUBMISSION_STATUS.NEEDS_REVIEW) {
    return {
      ok: true,
      result: {
        submission_id: String(submission.id),
        status: SUBMISSION_STATUS.NEEDS_REVIEW,
        low_confidence_questions: (submission.lowConfidenceQuestions ?? []) as number[],
        score: null,
        warning: SUBMISSION_WARNING.NEEDS_REVIEW,
      },
    };
  }
  if (submission.status !== SUBMISSION_STATUS.PROCESSING || !submission.sourcePdfKey) {
    return settled(422, "We could not read that sheet.", {
      error: submission.failureCode ?? RANK_ERROR.UNKNOWN_EXTRACTION_ERROR,
    });
  }

  const exam = submission.exam;
  const customerId = submission.customerId;
  const sourcePdfKey = submission.sourcePdfKey;

  /** A sheet that will never read: fail it and drop the stored copy. */
  const reject = async (
    code: string,
    action: AuditAction,
    metadata: Record<string, unknown>,
    outcome: RankSheetJobOutcome
  ): Promise<RankSheetJobOutcome> => {
    await failSubmission(submission.id, customerId, code, action, metadata);
    await deleteRankPdf(sourcePdfKey);
    await repo.updateSubmission(submission.id, { sourcePdfKey: null, updatedAt: new Date() });
    return outcome;
  };

  let extraction: OcrExtractionResult;
  try {
    extraction = await extractResponseSheet(fileBuffer ?? (await getRankPdf(sourcePdfKey)), `${submission.id}.pdf`);
  } catch (error) {
    // Anything but a typed refusal from the reader is passing — let the queue retry.
    if (!(error instanceof OcrExtractionError)) throw error;
    return reject(
      error.code,
      AUDIT_ACTION.SUBMISSION_EXTRACTION_FAILED,
      { code: error.code },
      settled(422, "We could not read that sheet.", { error: error.code })
    );
  }

  if (extraction.total_questions !== exam.totalQuestions) {
    const details = {
      error: RANK_ERROR.QUESTION_COUNT_MISMATCH,
      expected: exam.totalQuestions,
      detected: extraction.total_questions,
    };
    return reject(
      RANK_ERROR.QUESTION_COUNT_MISMATCH,
      AUDIT_ACTION.SUBMISSION_QUESTION_COUNT_MISMATCH,
      { expected: exam.totalQuestions, detected: extraction.total_questions },
      settled(422, "That sheet does not match this exam.", details)
    );
  }

  // The same sheet from a second account would put one candidate on the board
  // twice, and a participant id is unique per candidate, so it is the tell.
  if (extraction.kind === "text_layer" && extraction.roll_number) {
    const owner = await repo.findSheetOwnedByOther(exam.id, extraction.roll_number, customerId);
    if (owner) {
      return reject(
        RANK_ERROR.SHEET_ALREADY_SUBMITTED,
        AUDIT_ACTION.SUBMISSION_EXTRACTION_FAILED,
        { code: RANK_ERROR.SHEET_ALREADY_SUBMITTED, roll_number: extraction.roll_number },
        settled(409, "That sheet has already been submitted by another student.", {
          error: RANK_ERROR.SHEET_ALREADY_SUBMITTED,
        })
      );
    }
  }

  const lowConfidence = extraction.low_confidence_questions ?? [];
  const needsReview =
    lowConfidencePct(lowConfidence.length, exam.totalQuestions) >
    OCR_SERVICE.LOW_CONFIDENCE_THRESHOLD_PCT;

  await repo.updateSubmission(submission.id, {
    extractionKind: extraction.kind,
    rollNumber: extraction.roll_number,
    rawAnswers: extraction.answers as never,
    shiftKey: shiftKeyOf(extraction.candidate),
    candidate: (extraction.candidate ?? undefined) as never,
    candidateName: extraction.candidate?.name?.trim().slice(0, 255) || null,
    questionMeta: (extraction.questions?.length ? extraction.questions : undefined) as never,
    lowConfidenceQuestions: lowConfidence as never,
    status: needsReview ? SUBMISSION_STATUS.NEEDS_REVIEW : SUBMISSION_STATUS.PROCESSED,
    updatedAt: new Date(),
  });

  await fileSheetCopy(
    sourcePdfKey,
    organisedKeyOf(
      { id: submission.id, shiftKey: shiftKeyOf(extraction.candidate), rollNumber: extraction.roll_number, exam },
      await repo.findProfile(customerId)
    )
  );

  await audit({
    action: AUDIT_ACTION.SUBMISSION_EXTRACTED,
    entityType: AUDIT_ENTITY.SUBMISSION,
    entityId: String(submission.id),
    actorType: ACTOR_TYPE.CUSTOMER,
    actorId: customerId,
    metadata: {
      kind: extraction.kind,
      low_confidence: lowConfidence.length,
      needs_review: needsReview,
    },
  });

  if (needsReview) {
    return {
      ok: true,
      result: {
        submission_id: String(submission.id),
        status: SUBMISSION_STATUS.NEEDS_REVIEW,
        low_confidence_questions: lowConfidence,
        score: null,
        warning: SUBMISSION_WARNING.NEEDS_REVIEW,
      },
    };
  }

  return { ok: true, result: await rankPredictorService.scoreAndPublish(submission.id, customerId) };
};

export const rankPredictorService = {
  listExams: async (params: ExamListParams): Promise<Paged<RankExamDto>> => {
    const where = {
      ...(params.isActive === undefined ? {} : { isActive: params.isActive }),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search } },
              { code: { contains: params.search } },
              { category: { contains: params.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await repo.listExams(
      where,
      (params.page - 1) * params.limit,
      params.limit
    );

    return { items: await decorateExams(rows), total };
  },

  getExam: async (examId: bigint): Promise<RankExamDto> => {
    const exam = await requireExam(examId);
    const [dto, sat, subjects] = await Promise.all([
      decorateExam(exam),
      repo.listShifts(examId),
      repo.listSubjects(examId),
    ]);

    // The admin's slots are on offer before anyone has sat them, so a student
    // typing marks can pick theirs; a marks_only paper offers only those.
    const configured = paperShiftsOf(exam).map((shift) => shift.key);
    const satCount = new Map(sat.map((shift) => [shift.key, shift.candidates]));
    const keys =
      keySourceOf(exam) === KEY_SOURCE.MARKS_ONLY && configured.length
        ? configured
        : [...new Set([...configured, ...satCount.keys()])].sort();
    const shifts = keys.map((key) => ({ key, candidates: satCount.get(key) ?? 0 }));

    return { ...dto, shifts, subjects };
  },

  /**
   * Takes the sheet and queues it. The reading happens in the worker process at
   * a fixed concurrency (rank-sheet.queue.ts), so a thousand uploads at once
   * queue up instead of overrunning the OCR service. The request waits a short
   * while for its own sheet: under normal load the student still gets their
   * result in this response; in a rush they are told it is queued.
   */
  createSubmission: async (params: SubmissionCreateInput): Promise<RankSubmissionResultDto> => {
    const exam = await requireExam(params.examId);
    if (keySourceOf(exam) === KEY_SOURCE.MARKS_ONLY) {
      throw new HttpError(422, "This paper takes your total marks, not a sheet.", {
        error: RANK_ERROR.SHEET_NOT_ACCEPTED,
      });
    }

    const allowedSeries = parsePaperSeries(exam.paperSeries);
    assertSeriesAllowed(allowedSeries, params.series);

    const existing = await repo.findActiveSubmission(params.examId, params.customerId);
    if (existing) {
      throw new HttpError(409, "You have already submitted your sheet for this exam.", {
        error: RANK_ERROR.ALREADY_SUBMITTED,
        submission_id: String(existing.id),
        submitted_at: existing.createdAt,
      });
    }

    let submission;
    try {
      submission = await repo.createSubmission({
        examId: params.examId,
        customerId: params.customerId,
        series: allowedSeries.length ? params.series : null,
        rawAnswers: {},
        status: SUBMISSION_STATUS.PROCESSING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      if ((error as { code?: string })?.code === PRISMA_UNIQUE_VIOLATION) {
        throw new HttpError(409, "You have already submitted your sheet for this exam.", {
          error: RANK_ERROR.ALREADY_SUBMITTED,
        });
      }
      throw error;
    }

    // Stored before it is read: the worker reads it from storage, not from this
    // request's memory, so a crash or a deploy loses nothing.
    const sourcePdfKey = rankSheetKey(params.customerId, String(submission.id));
    await putRankPdf(sourcePdfKey, params.fileBuffer);
    await repo.updateSubmission(submission.id, { sourcePdfKey, updatedAt: new Date() });

    let outcome: RankSheetJobOutcome | null;
    try {
      const job = await enqueueRankSheet(submission.id);
      // Waiting holds this request, and the sheet in its memory, open. In a rush
      // the sheet would not be reached within the wait anyway, so answer "queued"
      // at once and let the request go.
      const backlog = await rankSheetBacklog();
      outcome =
        backlog <= OCR_SERVICE.UPLOAD_WAIT_MAX_BACKLOG
          ? await waitForRankSheet(job, OCR_SERVICE.UPLOAD_WAIT_MS)
          : null;
    } catch (error) {
      // Queue unavailable (Redis down): read it here rather than lose the upload.
      logger.warn("Rank sheet queue unavailable, reading inline", {
        submissionId: String(submission.id),
        error: (error as Error).message,
      });
      outcome = await readQueuedSheet(submission.id, params.fileBuffer);
    }

    if (!outcome) {
      return {
        submission_id: String(submission.id),
        status: SUBMISSION_STATUS.PROCESSING,
        score: null,
        warning: SUBMISSION_WARNING.QUEUED,
      };
    }
    if (!outcome.ok) throw new HttpError(outcome.status, outcome.message, outcome.details);
    return outcome.result;
  },

  /** The worker's half of an upload — see readQueuedSheet. */
  processQueuedSheet: (submissionId: bigint): Promise<RankSheetJobOutcome> =>
    readQueuedSheet(submissionId),

  /** Retries are spent on a passing failure: free the student to upload again. */
  giveUpQueuedSheet: async (submissionId: bigint, error: Error): Promise<void> => {
    const submission = await repo.findSubmissionById(submissionId);
    if (!submission || submission.status !== SUBMISSION_STATUS.PROCESSING) return;
    await failSubmission(
      submissionId,
      submission.customerId,
      RANK_ERROR.EXTRACTION_UNREACHABLE,
      AUDIT_ACTION.SUBMISSION_EXTRACTION_FAILED,
      { code: RANK_ERROR.EXTRACTION_UNREACHABLE, reason: error.message }
    );
  },

  /** Sheets a crash or a deploy left half-way, for the worker to queue again on boot. */
  pendingQueuedSheets: (): Promise<bigint[]> => repo.listPendingSheetSubmissionIds(),

  createMarksSubmission: async (params: MarksSubmissionInput): Promise<RankSubmissionResultDto> => {
    const exam = await requireExam(params.examId);
    const allowedSeries = parsePaperSeries(exam.paperSeries);
    assertSeriesAllowed(allowedSeries, params.series);

    // A marks_only paper is ranked by the slot its admin set up, so the slot is
    // required and must be one of them; elsewhere it is needed only for a shift rank.
    const isMarksOnly = keySourceOf(exam) === KEY_SOURCE.MARKS_ONLY;
    if ((isMarksOnly || rankByOf(exam).includes(RANK_BY.SHIFT)) && !params.shiftKey) {
      throw new HttpError(422, "Please pick the shift you sat.", {
        error: RANK_ERROR.SHIFT_REQUIRED,
      });
    }
    const configuredShifts = paperShiftsOf(exam).map((shift) => shift.key);
    if (isMarksOnly && configuredShifts.length && !configuredShifts.includes(params.shiftKey as string)) {
      throw new HttpError(422, "Please pick one of the shifts listed for this paper.", {
        error: RANK_ERROR.SHIFT_NOT_LISTED,
        shifts: configuredShifts,
      });
    }

    const maxMarks = await maxMarksOf(exam);
    if (params.marks > maxMarks || params.marks < -maxMarks) {
      throw new HttpError(422, `Marks must be between -${maxMarks} and ${maxMarks} for this paper.`, {
        error: RANK_ERROR.MARKS_OUT_OF_RANGE,
        max_marks: maxMarks,
      });
    }

    const existing = await repo.findActiveSubmission(params.examId, params.customerId);
    if (existing) {
      throw new HttpError(409, "You have already submitted your result for this exam.", {
        error: RANK_ERROR.ALREADY_SUBMITTED,
        submission_id: String(existing.id),
        submitted_at: existing.createdAt,
      });
    }

    let submission;
    try {
      submission = await repo.createSubmission({
        examId: params.examId,
        customerId: params.customerId,
        series: allowedSeries.length ? params.series : null,
        entryMode: ENTRY_MODE.MARKS,
        shiftKey: params.shiftKey,
        rawAnswers: {},
        status: SUBMISSION_STATUS.PROCESSED,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      if ((error as { code?: string })?.code === PRISMA_UNIQUE_VIOLATION) {
        throw new HttpError(409, "You have already submitted your result for this exam.", {
          error: RANK_ERROR.ALREADY_SUBMITTED,
        });
      }
      throw error;
    }

    const score = await repo.upsertScore(
      submission.id,
      {
        submissionId: submission.id,
        examId: exam.id,
        customerId: params.customerId,
        answerKeyId: null,
        shiftKey: params.shiftKey,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        rawScore: params.marks,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { rawScore: params.marks, updatedAt: new Date() }
    );

    const { higher, candidates } = await overallStanding(exam, params.marks, params.shiftKey);
    const rank = higher + 1;
    const percentile = percentileFor(rank, candidates);
    await repo.upsertRankSnapshot(score.id, exam.id, rank, candidates, percentile);

    await audit({
      action: AUDIT_ACTION.SUBMISSION_SCORED,
      entityType: AUDIT_ENTITY.SUBMISSION,
      entityId: String(submission.id),
      actorType: ACTOR_TYPE.CUSTOMER,
      actorId: params.customerId,
      metadata: { raw_score: params.marks, rank, total_candidates: candidates, entry_mode: "marks" },
    });

    return {
      submission_id: String(submission.id),
      status: SUBMISSION_STATUS.PROCESSED,
      score: toRankScoreDto(score),
      rank,
      percentile,
      total_candidates: candidates,
    };
  },

  /**
   * `bulk` is a re-mark of many sheets at once: the score and subject rows are
   * written, but the per-sheet rank count, snapshot and audit row are skipped —
   * ranks are always read live, and the run writes one audit row of its own.
   */
  scoreAndPublish: async (
    submissionId: bigint,
    actorCustomerId: number | null,
    options: { bulk?: boolean } = {}
  ): Promise<RankSubmissionResultDto> => {
    const submission = await requireSubmission(submissionId);

    // A typed total has no answers to mark; re-marking it would zero the score.
    if (submission.entryMode === ENTRY_MODE.MARKS) {
      throw new HttpError(409, "That entry was typed in as marks, so there is nothing to re-mark.", {
        error: RANK_ERROR.NOT_SCORABLE,
        status: submission.status,
      });
    }

    if (submission.status !== SUBMISSION_STATUS.PROCESSED) {
      throw new HttpError(409, "That sheet is not in a scorable state.", {
        error: RANK_ERROR.NOT_SCORABLE,
        status: submission.status,
      });
    }

    const exam = submission.exam;
    const resolved = await resolveKey(exam, submission);

    if ("missing" in resolved) {
      if (submission.score) {
        await repo.deleteScoreBySubmission(submission.id);
        await audit({
          action: AUDIT_ACTION.SUBMISSION_SCORE_CLEARED,
          entityType: AUDIT_ENTITY.SUBMISSION,
          entityId: String(submission.id),
          actorType: actorTypeFor(actorCustomerId),
          actorId: actorCustomerId,
          metadata: { reason: resolved.missing },
        });
      }

      return {
        submission_id: String(submission.id),
        status: submission.status as SubmissionStatus,
        score: null,
        rank: null,
        warning: resolved.missing,
      };
    }

    const result = scoreWithSubjects(
      answerMapOf(submission),
      resolved.keys,
      resolved.scheme,
      resolveSubjects(
        syllabusOf(exam),
        Object.keys(resolved.keys),
        sectionByQuestionOf(submission)
      )
    );

    const score = await repo.upsertScore(
      submission.id,
      {
        submissionId: submission.id,
        examId: exam.id,
        customerId: submission.customerId,
        answerKeyId: resolved.answerKeyId,
        shiftKey: submission.shiftKey,
        correct: result.correct,
        wrong: result.wrong,
        unanswered: result.unanswered,
        rawScore: result.rawScore,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        answerKeyId: resolved.answerKeyId,
        shiftKey: submission.shiftKey,
        correct: result.correct,
        wrong: result.wrong,
        unanswered: result.unanswered,
        rawScore: result.rawScore,
        updatedAt: new Date(),
      }
    );

    await repo.replaceSubjectScores(score.id, exam.id, result.subjects);

    if (options.bulk) {
      return {
        submission_id: String(submission.id),
        status: SUBMISSION_STATUS.PROCESSED,
        score: toRankScoreDto(score),
      };
    }

    const { higher, candidates } = await overallStanding(exam, result.rawScore, submission.shiftKey);
    const rank = higher + 1;
    const percentile = percentileFor(rank, candidates);

    await repo.upsertRankSnapshot(score.id, exam.id, rank, candidates, percentile);

    await audit({
      action: AUDIT_ACTION.SUBMISSION_SCORED,
      entityType: AUDIT_ENTITY.SUBMISSION,
      entityId: String(submission.id),
      actorType: actorTypeFor(actorCustomerId),
      actorId: actorCustomerId,
      metadata: { raw_score: result.rawScore, rank, total_candidates: candidates },
    });

    return {
      submission_id: String(submission.id),
      status: SUBMISSION_STATUS.PROCESSED,
      score: toRankScoreDto(score),
      rank,
      percentile,
      total_candidates: candidates,
    };
  },

  confirmCorrections: async (params: {
    submissionId: bigint;
    corrections: Record<string, number | null>;
    /** Only fills a shift the sheet did not print; what the sheet says wins. */
    shiftKey?: string | null;
    actorCustomerId: number | null;
  }): Promise<RankSubmissionResultDto> => {
    const submission = await repo.findSubmissionById(params.submissionId);
    if (!submission) {
      throw new HttpError(404, "Submission not found.", { error: RANK_ERROR.NOT_FOUND });
    }

    await repo.updateSubmission(submission.id, {
      ...(!submission.shiftKey && params.shiftKey ? { shiftKey: params.shiftKey } : {}),
      rawAnswers: { ...answerMapOf(submission), ...params.corrections } as never,
      lowConfidenceQuestions: [] as never,
      status: SUBMISSION_STATUS.PROCESSED,
      updatedAt: new Date(),
    });

    await audit({
      action: AUDIT_ACTION.SUBMISSION_CONFIRMED,
      entityType: AUDIT_ENTITY.SUBMISSION,
      entityId: String(submission.id),
      actorType: actorTypeFor(params.actorCustomerId),
      actorId: params.actorCustomerId,
      metadata: { corrected: Object.keys(params.corrections).length },
    });

    return rankPredictorService.scoreAndPublish(submission.id, params.actorCustomerId);
  },

  getStanding: async (examId: bigint, customerId: number): Promise<RankStandingDto> => {
    const [exam, score, profile] = await Promise.all([
      requireExam(examId),
      repo.findScoreForCustomer(examId, customerId),
      repo.findProfile(customerId),
    ]);
    const casteCategory: CasteCategory | null = casteCategoryOf(profile);
    const gender = genderOf(profile);
    const exServiceman = profile?.isExServiceman === true;
    const enabled = rankByOf(exam);

    if (!score) {
      return {
        raw_score: null,
        normalized_score: null,
        rank: null,
        percentile: null,
        total_candidates: await repo.countCandidates(examId),
        caste_category: casteCategory,
        category_rank: null,
        category_total_candidates: null,
        category_percentile: null,
        average_marks: null,
        category_average_marks: null,
        gender,
        overall_gender: null,
        shift_gender: null,
        category_gender: null,
        ex_serviceman: null,
        shift: null,
        shift_category: null,
        subjects: null,
        nearby: [],
      };
    }

    const rawScore = Number(score.rawScore);
    const shiftKey = enabled.includes(RANK_BY.SHIFT) ? score.shiftKey : null;
    const categoryOn = enabled.includes(RANK_BY.CATEGORY) && casteCategory !== null;
    // Boards that span shifts compare normalized marks; boards inside one shift stay raw.
    const normalization = await normalizationFor(exam);
    const normalized = normalizedOf(normalization, score.shiftKey, rawScore);
    const across = (scope: BoardScope = {}) =>
      repo.rankForExam(examId, normalized, scope, normalization);

    // Each standing is its own count over the same scores, so they are issued
    // together rather than one after another.
    const [
      overall,
      category,
      shift,
      shiftCategory,
      overallGender,
      shiftGender,
      categoryGender,
      exServicemanBoard,
      subjectRows,
    ] = await Promise.all([
      across(),
      categoryOn ? across({ casteCategory }) : null,
      shiftKey ? repo.rankForExam(examId, rawScore, { shiftKey }) : null,
      shiftKey && categoryOn
        ? repo.rankForExam(examId, rawScore, { shiftKey, casteCategory })
        : null,
      gender ? across({ gender }) : null,
      gender && shiftKey ? repo.rankForExam(examId, rawScore, { shiftKey, gender }) : null,
      gender && categoryOn ? across({ casteCategory, gender }) : null,
      exServiceman ? across({ exServiceman }) : null,
      enabled.includes(RANK_BY.SUBJECT) ? repo.listSubjectScores(score.id) : null,
    ]);

    const subjects: RankSubjectStandingDto[] | null = subjectRows
      ? await Promise.all(
          subjectRows.map(async (row) => {
            const standing = await repo.subjectRankForExam(examId, row.subject, Number(row.score));
            return {
              name: row.subject,
              score: Number(row.score),
              max_marks: Number(row.maxMarks),
              correct: row.correct,
              wrong: row.wrong,
              unanswered: row.unanswered,
              rank: standing.higher + 1,
              total_candidates: standing.candidates,
            };
          })
        )
      : null;

    const rank = overall.higher + 1;
    const skip = Math.max(0, rank - 1 - NEARBY_RANK_RADIUS);
    const rows = await boardPage(exam, skip, NEARBY_RANK_RADIUS * 2 + 1);

    return {
      raw_score: rawScore,
      normalized_score: normalization ? Math.round(normalized * 100) / 100 : null,
      rank,
      percentile: percentileFor(rank, overall.candidates),
      total_candidates: overall.candidates,
      caste_category: casteCategory,
      category_rank: category ? category.higher + 1 : null,
      category_total_candidates: category?.candidates ?? null,
      category_percentile: category ? percentileFor(category.higher + 1, category.candidates) : null,
      average_marks: overall.average,
      category_average_marks: category?.average ?? null,
      gender,
      overall_gender: overallGender ? positionOf(overallGender) : null,
      shift_gender: shiftGender ? positionOf(shiftGender) : null,
      category_gender: categoryGender ? positionOf(categoryGender) : null,
      ex_serviceman: exServicemanBoard ? positionOf(exServicemanBoard) : null,
      shift: shift && shiftKey ? { key: shiftKey, ...positionOf(shift) } : null,
      shift_category: shiftCategory ? positionOf(shiftCategory) : null,
      subjects,
      nearby: rows.map((row) => ({
        rank: row.rank_position,
        name: displayNameFor(row.full_name, row.show_real_name),
        raw_score: row.raw_score,
        normalized_score: row.normalized_score,
        is_me: row.customer_id === customerId,
      })),
    };
  },

  getLeaderboard: async (
    params: LeaderboardParams & { viewerCustomerId: number | null }
  ): Promise<{ entries: RankLeaderboardEntryDto[]; total: number }> => {
    const exam = await requireExam(params.examId);
    assertBoardEnabled(exam, params.scope);

    const [rows, total] = await Promise.all([
      boardPage(exam, (params.page - 1) * params.pageSize, params.pageSize, params.scope),
      params.scope?.subject
        ? repo.countSubjectCandidates(params.examId, params.scope.subject)
        : repo.countCandidates(params.examId, params.scope),
    ]);

    return {
      entries: rows.map((row) => toLeaderboardEntryDto(row, params.viewerCustomerId)),
      total,
    };
  },

  getMyRanks: async (customerId: number): Promise<RankMyExamDto[]> => {
    const submissions = await repo.listMySubmissions(customerId);

    return Promise.all(
      submissions.map(async (submission) => {
        const exam = await decorateExam(submission.exam);
        const status = submission.status as SubmissionStatus;

        if (!submission.score) {
          return {
            exam,
            rank: null,
            percentile: null,
            total_candidates: await repo.countCandidates(submission.examId),
            score: null,
            submitted_at: submission.createdAt,
            status,
          };
        }

        const { higher, candidates } = await overallStanding(
          submission.exam,
          Number(submission.score.rawScore),
          submission.score.shiftKey
        );
        const rank = higher + 1;

        return {
          exam,
          rank,
          percentile: percentileFor(rank, candidates),
          total_candidates: candidates,
          score: toRankScoreDto(submission.score),
          submitted_at: submission.createdAt,
          status,
        };
      })
    );
  },

  /**
   * Polled every few seconds while a queued sheet is read, so it is one indexed
   * row and nothing else — the page re-reads its full standing only once this moves.
   */
  getMySheetStatus: async (examId: bigint, customerId: number): Promise<RankSheetStatusDto> => {
    const latest = await repo.findLatestSubmissionStatus(examId, customerId);
    return {
      submission_id: latest ? String(latest.id) : null,
      status: (latest?.status as SubmissionStatus | undefined) ?? null,
      failure_code: latest?.failureCode ?? null,
      scored: Boolean(latest?.score),
    };
  },

  getSubmission: async (submissionId: bigint, customerId: number | null) => {
    const submission = await requireSubmission(submissionId);

    if (customerId !== null && submission.customerId !== customerId) {
      throw new HttpError(403, "That submission belongs to another student.", {
        error: RANK_ERROR.FORBIDDEN,
      });
    }

    return {
      submission: toRankSubmissionDto(submission),
      score: submission.score
        ? toRankScoreDto(submission.score)
        : null,
      answers: answerMapOf(submission),
      source_pdf_key: submission.sourcePdfKey,
      customer_id: submission.customerId,
    };
  },

  getMyAnswerReview: async (
    examId: bigint,
    customerId: number
  ): Promise<RankAnswerReviewDto> => {
    const score = await repo.findScoreForReview(examId, customerId);
    if (!score) {
      throw new HttpError(404, "There is no scored sheet for you on this paper yet.", {
        error: RANK_ERROR.NOT_SCORED,
      });
    }

    if (score.submission.entryMode === ENTRY_MODE.MARKS) {
      throw new HttpError(404, "You entered marks directly, so there is no answer review.", {
        error: RANK_ERROR.REVIEW_UNAVAILABLE,
      });
    }

    return toRankAnswerReviewDto(score.submission, score, score.answerKey);
  },

  getLeaderboardPrivacy: async (customerId: number): Promise<{ show_real_name: boolean }> => {
    const profile = await repo.findProfile(customerId);
    return { show_real_name: profile?.showRealName ?? false };
  },

  setLeaderboardPrivacy: async (
    customerId: number,
    showRealName: boolean
  ): Promise<{ show_real_name: boolean }> => {
    const profile = await repo.upsertProfile(customerId, showRealName);
    return { show_real_name: profile.showRealName };
  },

  getCandidateProfile: async (customerId: number): Promise<RankCandidateProfileDto> =>
    toRankCandidateProfileDto(await repo.findProfile(customerId)),

  saveCandidateProfile: async (
    customerId: number,
    input: CandidateProfileInput
  ): Promise<RankCandidateProfileDto> => {
    const before = await repo.findProfile(customerId);
    const profile = await repo.upsertCandidateProfile(customerId, {
      casteCategory: input.casteCategory,
      gender: input.gender,
      isExServiceman: input.isExServiceman,
    });

    await audit({
      action: AUDIT_ACTION.CANDIDATE_PROFILE_SAVED,
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: String(customerId),
      actorType: ACTOR_TYPE.CUSTOMER,
      actorId: customerId,
      metadata: {
        caste_category: input.casteCategory,
        gender: input.gender,
        is_ex_serviceman: input.isExServiceman,
      },
    });

    await refileCustomerSheets(customerId, before, profile);

    return toRankCandidateProfileDto(profile);
  },

  forgetCandidateProfile: async (customerId: number): Promise<void> => {
    const before = await repo.findProfile(customerId);
    const { count } = await repo.deleteProfile(customerId);
    if (!count) return;

    await refileCustomerSheets(customerId, before, null);

    await audit({
      action: AUDIT_ACTION.CANDIDATE_PROFILE_FORGOTTEN,
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: String(customerId),
      actorType: ACTOR_TYPE.SYSTEM,
      actorId: null,
    });
  },

  createExam: async (
    input: ExamCreateInput & { adminId: number | null }
  ): Promise<RankExamDto> => {
    if (await repo.findExamByCode(input.code)) {
      throw new HttpError(409, "An exam with that code already exists.", {
        error: RANK_ERROR.EXAM_CODE_TAKEN,
      });
    }

    assertShiftsFor(input.keySource ?? KEY_SOURCE.ADMIN_KEY, input.paperShifts ?? [], input.totalQuestions);
    assertSubmissionModesFor(input.keySource ?? KEY_SOURCE.ADMIN_KEY, input.submissionModes ?? [...SUBMISSION_MODES]);

    const exam = await repo.createExam({
      code: input.code,
      name: input.name,
      totalQuestions: input.totalQuestions,
      category: input.category ?? null,
      examDate: input.examDate ?? null,
      paperSeries: normalizePaperSeries(input.paperSeries) as never,
      keySource: input.keySource ?? KEY_SOURCE.ADMIN_KEY,
      marksCorrect: input.marksCorrect ?? null,
      marksWrong: input.marksWrong ?? null,
      syllabus: (input.syllabus ?? []) as never,
      // An unset choice stays null so the paper keeps its legacy (category-only) behaviour.
      ...(input.rankBy === undefined ? {} : { rankBy: input.rankBy as never }),
      paperShifts: (input.paperShifts ?? []) as never,
      // Unset stays null: every way to submit, as before.
      ...(input.submissionModes === undefined ? {} : { submissionModes: input.submissionModes as never }),
      isActive: input.isActive ?? true,
      createdBy: input.adminId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await audit({
      action: AUDIT_ACTION.EXAM_CREATED,
      entityType: AUDIT_ENTITY.EXAM,
      entityId: String(exam.id),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: input.adminId,
      metadata: { code: exam.code },
    });

    return decorateExam(exam);
  },

  updateExam: async (
    examId: bigint,
    input: ExamUpdateInput,
    adminId: number | null
  ): Promise<RankExamDto> => {
    const exam = await requireExam(examId);
    assertShiftsFor(
      input.keySource ?? keySourceOf(exam),
      input.paperShifts ?? paperShiftsOf(exam),
      input.totalQuestions ?? exam.totalQuestions
    );
    assertSubmissionModesFor(
      input.keySource ?? keySourceOf(exam),
      input.submissionModes ?? submissionModesOf(exam)
    );

    if (input.paperSeries) {
      const next = normalizePaperSeries(input.paperSeries);
      const removed = parsePaperSeries(exam.paperSeries).filter((s) => !next.includes(s));

      for (const series of removed) {
        if (await repo.countActiveKeysForSeries(examId, series)) {
          throw new HttpError(409, `Series ${series} already has a published answer key.`, {
            error: RANK_ERROR.SERIES_HAS_ACTIVE_KEY,
            series,
          });
        }
      }
    }

    const updated = await repo.updateExam(examId, {
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.totalQuestions === undefined ? {} : { totalQuestions: input.totalQuestions }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.examDate === undefined ? {} : { examDate: input.examDate }),
      ...(input.paperSeries === undefined
        ? {}
        : { paperSeries: normalizePaperSeries(input.paperSeries) as never }),
      ...(input.keySource === undefined ? {} : { keySource: input.keySource }),
      ...(input.marksCorrect === undefined ? {} : { marksCorrect: input.marksCorrect }),
      ...(input.marksWrong === undefined ? {} : { marksWrong: input.marksWrong }),
      ...(input.syllabus === undefined ? {} : { syllabus: input.syllabus as never }),
      ...(input.rankBy === undefined ? {} : { rankBy: input.rankBy as never }),
      ...(input.paperShifts === undefined ? {} : { paperShifts: input.paperShifts as never }),
      ...(input.submissionModes === undefined
        ? {}
        : { submissionModes: input.submissionModes as never }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: new Date(),
    });

    await audit({
      action: AUDIT_ACTION.EXAM_UPDATED,
      entityType: AUDIT_ENTITY.EXAM,
      entityId: String(examId),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: adminId,
      metadata: { ...input },
    });

    // Anything that changes what a sheet is worth has to move the scores already
    // banked, in this request, for the same reason a key publish does.
    // The admin form resends every field on each save, so compare against what was
    // stored: an unchanged setup must not re-mark every sheet.
    const sameMarks = (next: number | null | undefined, stored: unknown): boolean =>
      next === undefined || (next === null ? stored === null : stored !== null && Number(stored) === next);
    const changesMarking =
      (input.keySource !== undefined && input.keySource !== exam.keySource) ||
      !sameMarks(input.marksCorrect, exam.marksCorrect) ||
      !sameMarks(input.marksWrong, exam.marksWrong) ||
      (input.syllabus !== undefined &&
        !isDeepStrictEqual(JSON.parse(JSON.stringify(input.syllabus)), exam.syllabus ?? [])) ||
      (input.paperShifts !== undefined &&
        !isDeepStrictEqual(cancellationsOf(input.paperShifts), cancellationsOf(paperShiftsOf(exam))));
    if (changesMarking) await rescoreExam(examId, adminId);

    return decorateExam(updated);
  },

  deleteExam: async (examId: bigint, adminId: number | null): Promise<RankExamDeletionDto> => {
    const exam = await requireExam(examId);
    const pdfKeys = await repo.findExamStoredPdfKeys(examId);
    const deleted = await repo.deleteExamCascade(examId);

    await Promise.all(pdfKeys.map(deleteRankPdf));
    await deleteRankPdfKeys(await listRankPdfKeys(organisedExamPrefix(exam.code))).catch((error) =>
      logger.warn("Rank sheet organised folder cleanup failed", {
        examId: String(examId),
        error: (error as Error).message,
      })
    );

    await audit({
      action: AUDIT_ACTION.EXAM_DELETED,
      entityType: AUDIT_ENTITY.EXAM,
      entityId: String(examId),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: adminId,
      metadata: {
        code: exam.code,
        name: exam.name,
        submissions_deleted: deleted.submissions,
        scores_deleted: deleted.scores,
        answer_keys_deleted: deleted.answerKeys,
        pdfs_deleted: pdfKeys.length,
      },
    });

    return {
      _id: String(examId),
      id: Number(examId),
      code: exam.code,
      name: exam.name,
      submissions_deleted: deleted.submissions,
      scores_deleted: deleted.scores,
      answer_keys_deleted: deleted.answerKeys,
    };
  },

  publishAnswerKey: async (params: AnswerKeyPublishInput) => {
    const exam = await requireExam(params.examId);
    const allowedSeries = parsePaperSeries(exam.paperSeries);
    const series = params.series ?? null;

    if (allowedSeries.length && (!series || !allowedSeries.includes(series))) {
      throw new HttpError(400, "That paper series is not enabled for this exam.", {
        error: RANK_ERROR.SERIES_REQUIRED,
        allowed_series: allowedSeries,
      });
    }

    if (!allowedSeries.length && series) {
      throw new HttpError(400, "This exam has a single paper, so it takes no series.", {
        error: RANK_ERROR.SERIES_NOT_ENABLED,
      });
    }

    const keyCount = Object.keys(params.keys).length;
    if (keyCount !== exam.totalQuestions) {
      throw new HttpError(400, "The answer key does not cover every question.", {
        error: RANK_ERROR.QUESTION_COUNT_MISMATCH,
        expected: exam.totalQuestions,
        detected: keyCount,
      });
    }

    const version = await repo.nextAnswerKeyVersion(params.examId);
    const key = await repo.publishAnswerKey(params.examId, series, {
      exam: { connect: { id: params.examId } },
      version,
      isActive: true,
      series,
      keys: params.keys as never,
      marksCorrect: params.marksCorrect,
      marksWrong: params.marksWrong,
      sourcePdfKey: params.sourcePdfKey,
      uploadedBy: params.adminId,
      createdAt: new Date(),
    });

    await audit({
      action: AUDIT_ACTION.ANSWER_KEY_UPLOADED,
      entityType: AUDIT_ENTITY.ANSWER_KEY,
      entityId: String(key.id),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: params.adminId,
      metadata: { exam_id: String(params.examId), series, version },
    });

    return { key, ...(await rescoreSeries(params.examId, series, params.adminId)) };
  },

  listAnswerKeys: (examId: bigint) => repo.listAnswerKeys(examId),

  setAnswerKeyActive: async (id: bigint, isActive: boolean, adminId: number | null) => {
    const key = await repo.findAnswerKeyById(id);
    if (!key) throw new HttpError(404, "Answer key not found.", { error: RANK_ERROR.NOT_FOUND });

    const updated = isActive
      ? await repo.activateAnswerKeyExclusively(key.examId, key.series, id)
      : await repo.setAnswerKeyActive(id, isActive);

    await audit({
      action: AUDIT_ACTION.ANSWER_KEY_STATUS_CHANGED,
      entityType: AUDIT_ENTITY.ANSWER_KEY,
      entityId: String(id),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: adminId,
      metadata: { is_active: isActive, exam_id: String(key.examId), series: key.series },
    });

    return { key: updated, ...(await rescoreSeries(key.examId, key.series, adminId)) };
  },

  listSubmissions: async (params: SubmissionListParams) => {
    const where = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.examId ? { examId: params.examId } : {}),
    };

    const [rows, total] = await repo.listSubmissions(
      where,
      (params.page - 1) * params.limit,
      params.limit
    );

    return { rows, total };
  },

  getAdminLeaderboard: async (
    params: LeaderboardParams
  ): Promise<{ entries: RankAdminLeaderboardEntryDto[]; total: number }> => {
    // Staff see every board, whatever the paper shows students, so no gate here.
    const exam = await requireExam(params.examId);
    const [rows, total] = await Promise.all([
      boardPage(exam, (params.page - 1) * params.pageSize, params.pageSize, params.scope),
      params.scope?.subject
        ? repo.countSubjectCandidates(params.examId, params.scope.subject)
        : repo.countCandidates(params.examId, params.scope),
    ]);

    return { entries: rows.map(toAdminLeaderboardEntryDto), total };
  },

  resolveCustomers: async (customerIds: number[]): Promise<Map<number, RankCustomerDto>> => {
    const unique = [...new Set(customerIds)];
    const rows = await repo.findCustomersByIds(unique);
    const byId = new Map(rows.map((row) => [row.id, toRankCustomerDto(row)]));

    for (const id of unique) {
      if (!byId.has(id)) byId.set(id, unknownRankCustomerDto(id));
    }

    return byId;
  },

  deleteSubmission: async (
    submissionId: bigint,
    adminId: number | null
  ): Promise<RankSubmissionDeletionDto> => {
    const submission = await requireSubmission(submissionId);

    await repo.deleteSubmission(submission.id);

    if (submission.sourcePdfKey) {
      await deleteRankPdf(submission.sourcePdfKey);
      await deleteRankPdf(organisedKeyOf(submission, await repo.findProfile(submission.customerId)));
    }

    await audit({
      action: AUDIT_ACTION.SUBMISSION_DELETED,
      entityType: AUDIT_ENTITY.SUBMISSION,
      entityId: String(submission.id),
      actorType: ACTOR_TYPE.ADMIN,
      actorId: adminId,
      metadata: {
        previous_status: submission.status,
        previous_score: submission.score ? Number(submission.score.rawScore) : null,
        exam_id: String(submission.examId),
        customer_id: submission.customerId,
        source_pdf_key: submission.sourcePdfKey,
      },
    });

    return {
      _id: String(submission.id),
      exam_id: String(submission.examId),
      customer_id: submission.customerId,
      score_removed: submission.score !== null,
    };
  },

  rescoreSubmission: (submissionId: bigint): Promise<RankSubmissionResultDto> =>
    rankPredictorService.scoreAndPublish(submissionId, null),
};
