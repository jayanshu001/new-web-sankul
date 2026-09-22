import type { OcrAnswerKey, OcrExam, OcrScore, OcrSubmission } from "@prisma/client";
import { buildAnswerReview, normalizePaperSeries } from "./rank-predictor.scoring";
import {
  CUSTOMER_HANDLE_PREFIX,
  MASKED_NAME_FALLBACK,
  type AnswerKeyMap,
  type AnswerMap,
  type CasteCategory,
  type ExtractionKind,
  type Gender,
  type LeaderboardRow,
  type RankAdminLeaderboardEntryDto,
  type RankAnswerKeyAdminDto,
  type RankAnswerKeyDto,
  type RankAnswerReviewDto,
  type RankCandidateProfileDto,
  type RankCustomerDto,
  type RankExamDto,
  type RankLeaderboardEntryDto,
  type RankScoreDto,
  type RankSubmissionDto,
  type SubmissionStatus,
} from "./rank-predictor.types";

interface CustomerNameRow {
  id: number;
  fullName: string | null;
  phoneNumber: string | null;
  emailAddress: string | null;
}

interface CandidateProfileRow {
  casteCategory: string | null;
  gender: string | null;
  isExServiceman: boolean | null;
}

const trimmedOrNull = (value: string | null | undefined): string | null =>
  (value ?? "").trim() || null;

const lowerOrNull = (value: string | null | undefined): string | null =>
  (value ?? "").trim().toLowerCase() || null;

export const parsePaperSeries = (value: unknown): string[] => normalizePaperSeries(value);

export const maskName = (fullName: string): string => {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return MASKED_NAME_FALLBACK;

  return words
    .map((word) => `${word.slice(0, Math.max(1, Math.floor(word.length / 2)))}${MASKED_NAME_FALLBACK}`)
    .join(" ");
};

export const handleFor = (customerId: number): string => `${CUSTOMER_HANDLE_PREFIX}${customerId}`;

export const displayNameFor = (fullName: string | null, showRealName: boolean): string => {
  const name = trimmedOrNull(fullName);
  if (!name) return MASKED_NAME_FALLBACK;
  return showRealName ? name : maskName(name);
};

export const toRankCustomerDto = (row: CustomerNameRow): RankCustomerDto => ({
  id: row.id,
  name: trimmedOrNull(row.fullName) ?? handleFor(row.id),
  handle: handleFor(row.id),
  phone: trimmedOrNull(row.phoneNumber),
  email: trimmedOrNull(row.emailAddress),
});

export const unknownRankCustomerDto = (customerId: number): RankCustomerDto => ({
  id: customerId,
  name: handleFor(customerId),
  handle: handleFor(customerId),
  phone: null,
  email: null,
});

/** The stored category, read the same way everywhere: trimmed and lower-cased. */
export const casteCategoryOf = (
  row: { casteCategory: string | null } | null | undefined
): CasteCategory | null => lowerOrNull(row?.casteCategory) as CasteCategory | null;

export const toRankCandidateProfileDto = (
  row: CandidateProfileRow | null
): RankCandidateProfileDto => {
  const casteCategory = casteCategoryOf(row);
  const gender = lowerOrNull(row?.gender) as Gender | null;
  const isExServiceman = row?.isExServiceman ?? null;

  return {
    caste_category: casteCategory,
    gender,
    is_ex_serviceman: isExServiceman,
    is_complete: casteCategory !== null && gender !== null && isExServiceman !== null,
  };
};

export const toRankExamDto = (
  row: OcrExam,
  submissionCount: number,
  hasAnswerKey: boolean
): RankExamDto => ({
  _id: String(row.id),
  id: Number(row.id),
  code: row.code,
  name: row.name,
  total_questions: row.totalQuestions,
  category: row.category,
  exam_date: row.examDate,
  paper_series: parsePaperSeries(row.paperSeries),
  submission_count: submissionCount,
  has_answer_key: hasAnswerKey,
  is_active: row.isActive,
  created_at: row.createdAt,
});

export const answerKeyMapOf = (row: Pick<OcrAnswerKey, "keys">): AnswerKeyMap =>
  (row.keys ?? {}) as AnswerKeyMap;

export const answerMapOf = (row: Pick<OcrSubmission, "rawAnswers">): AnswerMap =>
  (row.rawAnswers ?? {}) as AnswerMap;

export const markingSchemeOf = (row: Pick<OcrAnswerKey, "marksCorrect" | "marksWrong">) => ({
  marksCorrect: Number(row.marksCorrect),
  marksWrong: Number(row.marksWrong),
});

export const toRankAnswerKeyDto = (row: OcrAnswerKey): RankAnswerKeyDto => {
  const scheme = markingSchemeOf(row);

  return {
    _id: String(row.id),
    id: Number(row.id),
    exam_id: String(row.examId),
    version: row.version,
    is_active: row.isActive,
    series: row.series,
    marks_correct: scheme.marksCorrect,
    marks_wrong: scheme.marksWrong,
    total_questions: Object.keys(answerKeyMapOf(row)).length,
    has_source_pdf: Boolean(row.sourcePdfKey),
    created_at: row.createdAt,
  };
};

export const toRankAnswerKeyAdminDto = (row: OcrAnswerKey): RankAnswerKeyAdminDto => ({
  ...toRankAnswerKeyDto(row),
  keys: answerKeyMapOf(row),
});

export const toRankSubmissionDto = (row: OcrSubmission): RankSubmissionDto => ({
  _id: String(row.id),
  id: Number(row.id),
  exam_id: String(row.examId),
  status: row.status as SubmissionStatus,
  extraction_kind: row.extractionKind as ExtractionKind | null,
  roll_number: row.rollNumber,
  series: row.series,
  low_confidence_questions: Array.isArray(row.lowConfidenceQuestions)
    ? (row.lowConfidenceQuestions as number[])
    : [],
  failure_code: row.failureCode,
  created_at: row.createdAt,
});

export const toRankScoreDto = (row: OcrScore, totalQuestions: number): RankScoreDto => ({
  correct: row.correct,
  wrong: row.wrong,
  unanswered: row.unanswered,
  raw_score: Number(row.rawScore),
  total_questions: totalQuestions,
});

export const toLeaderboardEntryDto = (
  row: LeaderboardRow,
  viewerCustomerId: number | null
): RankLeaderboardEntryDto => ({
  rank: row.rank_position,
  name: displayNameFor(row.full_name, row.show_real_name),
  raw_score: row.raw_score,
  is_me: viewerCustomerId !== null && row.customer_id === viewerCustomerId,
  submitted_at: row.submitted_at,
});

export const toAdminLeaderboardEntryDto = (row: LeaderboardRow): RankAdminLeaderboardEntryDto => ({
  rank: row.rank_position,
  customer_id: row.customer_id,
  name: trimmedOrNull(row.full_name) ?? handleFor(row.customer_id),
  shows_real_name: row.show_real_name,
  raw_score: row.raw_score,
  submitted_at: row.submitted_at,
});

export const toRankAnswerReviewDto = (
  submission: OcrSubmission,
  score: OcrScore,
  answerKey: OcrAnswerKey,
  totalQuestions: number
): RankAnswerReviewDto => {
  const scheme = markingSchemeOf(answerKey);

  return {
    submission_id: String(submission.id),
    exam_id: String(submission.examId),
    series: submission.series,
    answer_key_version: answerKey.version,
    marks_correct: scheme.marksCorrect,
    marks_wrong: scheme.marksWrong,
    score: toRankScoreDto(score, totalQuestions),
    items: buildAnswerReview(answerMapOf(submission), answerKeyMapOf(answerKey), scheme).map(
      (item) => ({
        question_no: item.questionNo,
        chosen: item.chosen,
        correct_option: item.correctOption,
        verdict: item.verdict,
        marks: item.marks,
      })
    ),
  };
};
