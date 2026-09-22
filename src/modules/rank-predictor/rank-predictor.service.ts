import { OCR_SERVICE } from "../../config/ocrService";
import { HttpError } from "../../middlewares/errorHandler";
import {
  OcrExtractionError,
  extractResponseSheet,
  type OcrExtractionResult,
} from "../../utils/ocrExtractionClient";
import { deleteRankPdf, putRankPdf, rankSheetKey } from "../../utils/rankSheetStorage";
import { rankPredictorRepository as repo } from "./rank-predictor.repository";
import {
  lowConfidencePct,
  normalizePaperSeries,
  percentileFor,
  scoreSubmission,
} from "./rank-predictor.scoring";
import {
  answerKeyMapOf,
  answerMapOf,
  casteCategoryOf,
  displayNameFor,
  markingSchemeOf,
  parsePaperSeries,
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
  NEARBY_RANK_RADIUS,
  PRISMA_UNIQUE_VIOLATION,
  RANK_ERROR,
  SUBMISSION_STATUS,
  SUBMISSION_WARNING,
  type ActorType,
  type AnswerKeyPublishInput,
  type AuditAction,
  type AuditEntity,
  type CandidateProfileInput,
  type CasteCategory,
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
  type RankSubmissionDeletionDto,
  type RankSubmissionResultDto,
  type RescoreOutcome,
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

const rescoreSeries = async (
  examId: bigint,
  series: string | null,
  adminId: number | null
): Promise<RescoreOutcome> => {
  const submissions = await repo.listScoredSubmissions(examId, series);
  let rescored = 0;
  let skipped = 0;

  for (const submission of submissions) {
    try {
      await rankPredictorService.scoreAndPublish(submission.id, null);
      rescored += 1;
    } catch (error) {
      skipped += 1;
      console.error(
        `[rank-predictor] rescore failed for submission ${submission.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

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

  getExam: async (examId: bigint): Promise<RankExamDto> => decorateExam(await requireExam(examId)),

  createSubmission: async (params: SubmissionCreateInput): Promise<RankSubmissionResultDto> => {
    const exam = await requireExam(params.examId);
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

    let extraction: OcrExtractionResult;
    try {
      extraction = await extractResponseSheet(params.fileBuffer, params.fileName);
    } catch (error) {
      const code =
        error instanceof OcrExtractionError ? error.code : RANK_ERROR.EXTRACTION_UNREACHABLE;

      await failSubmission(
        submission.id,
        params.customerId,
        code,
        AUDIT_ACTION.SUBMISSION_EXTRACTION_FAILED,
        { code }
      );

      throw new HttpError(422, "We could not read that sheet.", { error: code });
    }

    if (extraction.total_questions !== exam.totalQuestions) {
      await failSubmission(
        submission.id,
        params.customerId,
        RANK_ERROR.QUESTION_COUNT_MISMATCH,
        AUDIT_ACTION.SUBMISSION_QUESTION_COUNT_MISMATCH,
        { expected: exam.totalQuestions, detected: extraction.total_questions }
      );

      throw new HttpError(422, "That sheet does not match this exam.", {
        error: RANK_ERROR.QUESTION_COUNT_MISMATCH,
        expected: exam.totalQuestions,
        detected: extraction.total_questions,
      });
    }

    const sourcePdfKey = rankSheetKey(params.customerId, String(submission.id));
    await putRankPdf(sourcePdfKey, params.fileBuffer);

    const lowConfidence = extraction.low_confidence_questions ?? [];
    const needsReview =
      lowConfidencePct(lowConfidence.length, exam.totalQuestions) >
      OCR_SERVICE.LOW_CONFIDENCE_THRESHOLD_PCT;

    await repo.updateSubmission(submission.id, {
      sourcePdfKey,
      extractionKind: extraction.kind,
      rollNumber: extraction.roll_number,
      rawAnswers: extraction.answers as never,
      lowConfidenceQuestions: lowConfidence as never,
      status: needsReview ? SUBMISSION_STATUS.NEEDS_REVIEW : SUBMISSION_STATUS.PROCESSED,
      updatedAt: new Date(),
    });

    await audit({
      action: AUDIT_ACTION.SUBMISSION_EXTRACTED,
      entityType: AUDIT_ENTITY.SUBMISSION,
      entityId: String(submission.id),
      actorType: ACTOR_TYPE.CUSTOMER,
      actorId: params.customerId,
      metadata: {
        kind: extraction.kind,
        low_confidence: lowConfidence.length,
        needs_review: needsReview,
      },
    });

    if (needsReview) {
      return {
        submission_id: String(submission.id),
        status: SUBMISSION_STATUS.NEEDS_REVIEW,
        low_confidence_questions: lowConfidence,
        score: null,
        warning: SUBMISSION_WARNING.NEEDS_REVIEW,
      };
    }

    return rankPredictorService.scoreAndPublish(submission.id, params.customerId);
  },

  scoreAndPublish: async (
    submissionId: bigint,
    actorCustomerId: number | null
  ): Promise<RankSubmissionResultDto> => {
    const submission = await requireSubmission(submissionId);

    if (submission.status !== SUBMISSION_STATUS.PROCESSED) {
      throw new HttpError(409, "That sheet is not in a scorable state.", {
        error: RANK_ERROR.NOT_SCORABLE,
        status: submission.status,
      });
    }

    const exam = submission.exam;
    const answerKey = await repo.findActiveAnswerKey(exam.id, submission.series);

    if (!answerKey) {
      if (submission.score) {
        await repo.deleteScoreBySubmission(submission.id);
        await audit({
          action: AUDIT_ACTION.SUBMISSION_SCORE_CLEARED,
          entityType: AUDIT_ENTITY.SUBMISSION,
          entityId: String(submission.id),
          actorType: actorTypeFor(actorCustomerId),
          actorId: actorCustomerId,
          metadata: { reason: SUBMISSION_WARNING.NO_ACTIVE_ANSWER_KEY },
        });
      }

      return {
        submission_id: String(submission.id),
        status: submission.status as SubmissionStatus,
        score: null,
        rank: null,
        warning: SUBMISSION_WARNING.NO_ACTIVE_ANSWER_KEY,
      };
    }

    const result = scoreSubmission(
      answerMapOf(submission),
      answerKeyMapOf(answerKey),
      markingSchemeOf(answerKey)
    );

    const score = await repo.upsertScore(
      submission.id,
      {
        submissionId: submission.id,
        examId: exam.id,
        customerId: submission.customerId,
        answerKeyId: answerKey.id,
        correct: result.correct,
        wrong: result.wrong,
        unanswered: result.unanswered,
        rawScore: result.rawScore,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        answerKeyId: answerKey.id,
        correct: result.correct,
        wrong: result.wrong,
        unanswered: result.unanswered,
        rawScore: result.rawScore,
        updatedAt: new Date(),
      }
    );

    const { higher, candidates } = await repo.rankForExam(exam.id, result.rawScore);
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
      score: toRankScoreDto(score, exam.totalQuestions),
      rank,
      percentile,
      total_candidates: candidates,
    };
  },

  confirmCorrections: async (params: {
    submissionId: bigint;
    corrections: Record<string, number | null>;
    actorCustomerId: number | null;
  }): Promise<RankSubmissionResultDto> => {
    const submission = await repo.findSubmissionById(params.submissionId);
    if (!submission) {
      throw new HttpError(404, "Submission not found.", { error: RANK_ERROR.NOT_FOUND });
    }

    await repo.updateSubmission(submission.id, {
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
    const [score, profile] = await Promise.all([
      repo.findScoreForCustomer(examId, customerId),
      repo.findProfile(customerId),
    ]);
    const casteCategory: CasteCategory | null = casteCategoryOf(profile);

    if (!score) {
      return {
        rank: null,
        percentile: null,
        total_candidates: await repo.countCandidates(examId),
        caste_category: casteCategory,
        category_rank: null,
        category_total_candidates: null,
        nearby: [],
      };
    }

    const rawScore = Number(score.rawScore);
    // The category standing is a second count over the same scores, so it is
    // worth issuing beside the global one rather than after it.
    const [{ higher, candidates }, category] = await Promise.all([
      repo.rankForExam(examId, rawScore),
      casteCategory ? repo.categoryRankForExam(examId, rawScore, casteCategory) : null,
    ]);
    const rank = higher + 1;
    const skip = Math.max(0, rank - 1 - NEARBY_RANK_RADIUS);
    const rows = await repo.leaderboardPage(examId, skip, NEARBY_RANK_RADIUS * 2 + 1);

    return {
      rank,
      percentile: percentileFor(rank, candidates),
      total_candidates: candidates,
      caste_category: casteCategory,
      category_rank: category ? category.higher + 1 : null,
      category_total_candidates: category?.candidates ?? null,
      nearby: rows.map((row) => ({
        rank: row.rank_position,
        name: displayNameFor(row.full_name, row.show_real_name),
        raw_score: row.raw_score,
        is_me: row.customer_id === customerId,
      })),
    };
  },

  getLeaderboard: async (
    params: LeaderboardParams & { viewerCustomerId: number | null }
  ): Promise<{ entries: RankLeaderboardEntryDto[]; total: number }> => {
    const [rows, total] = await Promise.all([
      repo.leaderboardPage(params.examId, (params.page - 1) * params.pageSize, params.pageSize),
      repo.countCandidates(params.examId),
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

        const { higher, candidates } = await repo.rankForExam(
          submission.examId,
          Number(submission.score.rawScore)
        );
        const rank = higher + 1;

        return {
          exam,
          rank,
          percentile: percentileFor(rank, candidates),
          total_candidates: candidates,
          score: toRankScoreDto(submission.score, submission.exam.totalQuestions),
          submitted_at: submission.createdAt,
          status,
        };
      })
    );
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
        ? toRankScoreDto(submission.score, submission.exam.totalQuestions)
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

    return toRankAnswerReviewDto(
      score.submission,
      score,
      score.answerKey,
      score.submission.exam.totalQuestions
    );
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

    return toRankCandidateProfileDto(profile);
  },

  forgetCandidateProfile: async (customerId: number): Promise<void> => {
    const { count } = await repo.deleteProfile(customerId);
    if (!count) return;

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

    const exam = await repo.createExam({
      code: input.code,
      name: input.name,
      totalQuestions: input.totalQuestions,
      category: input.category ?? null,
      examDate: input.examDate ?? null,
      paperSeries: normalizePaperSeries(input.paperSeries) as never,
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

    return decorateExam(updated);
  },

  deleteExam: async (examId: bigint, adminId: number | null): Promise<RankExamDeletionDto> => {
    const exam = await requireExam(examId);
    const pdfKeys = await repo.findExamStoredPdfKeys(examId);
    const deleted = await repo.deleteExamCascade(examId);

    await Promise.all(pdfKeys.map(deleteRankPdf));

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
    const [rows, total] = await Promise.all([
      repo.leaderboardPage(params.examId, (params.page - 1) * params.pageSize, params.pageSize),
      repo.countCandidates(params.examId),
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

    if (submission.sourcePdfKey) await deleteRankPdf(submission.sourcePdfKey);

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
