import type { OcrAnswerKey, OcrExam, OcrScore, OcrSubmission } from "@prisma/client";
import { buildAnswerReview, cancelledCountOf, normalizePaperSeries } from "./rank-predictor.scoring";
import { questionFactorsOf, resolveSubjects } from "./rank-predictor.subjects";
import {
  CANCELLED_QUESTION,
  CUSTOMER_HANDLE_PREFIX,
  KEY_SOURCE,
  LEGACY_RANK_BY,
  RANK_BY_VALUES,
  type KeySource,
  type PaperShift,
  type RankBy,
  type SheetQuestion,
  type SyllabusSubject,
  MASKED_NAME_FALLBACK,
  type AnswerKeyMap,
  type AnswerMap,
  type CasteCategory,
  type EntryMode,
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

export const genderOf = (row: { gender: string | null } | null | undefined): Gender | null =>
  lowerOrNull(row?.gender) as Gender | null;

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

export const keySourceOf = (row: Pick<OcrExam, "keySource">): KeySource =>
  row.keySource === KEY_SOURCE.SHEET || row.keySource === KEY_SOURCE.MARKS_ONLY
    ? row.keySource
    : KEY_SOURCE.ADMIN_KEY;

export const syllabusOf = (row: Pick<OcrExam, "syllabus">): SyllabusSubject[] =>
  Array.isArray(row.syllabus) ? (row.syllabus as unknown as SyllabusSubject[]) : [];

/**
 * The breakdowns a paper shows. A paper with no stored choice is a legacy one and
 * keeps the category rank it always had; once an admin chooses, the choice is all of it.
 */
export const rankByOf = (row: Pick<OcrExam, "rankBy">): RankBy[] =>
  Array.isArray(row.rankBy)
    ? RANK_BY_VALUES.filter((value) => (row.rankBy as unknown[]).includes(value))
    : [...LEGACY_RANK_BY];

export const paperShiftsOf = (row: Pick<OcrExam, "paperShifts">): PaperShift[] =>
  Array.isArray(row.paperShifts) ? (row.paperShifts as unknown as PaperShift[]) : [];

/**
 * A key with the cancellations of the slot the sheet was sat in laid over it, so a
 * question the board dropped for that shift is scored for no one in it. A sheet with
 * no shift, or a shift with nothing cancelled, keeps its key as it is.
 */
export const withShiftCancellations = (
  keys: AnswerKeyMap,
  exam: Pick<OcrExam, "paperShifts">,
  shiftKey: string | null | undefined
): AnswerKeyMap => {
  const cancelled = shiftKey
    ? paperShiftsOf(exam).find((shift) => shift.key === shiftKey)?.cancelled_questions ?? []
    : [];
  if (!cancelled.length) return keys;

  return {
    ...keys,
    ...Object.fromEntries(cancelled.map((question) => [String(question), CANCELLED_QUESTION])),
  };
};

/** The exam-level marking used when a paper scores against the sheet's own key. */
export const examMarkingSchemeOf = (row: Pick<OcrExam, "marksCorrect" | "marksWrong">) => ({
  marksCorrect: row.marksCorrect === null ? 1 : Number(row.marksCorrect),
  marksWrong: row.marksWrong === null ? 0 : Number(row.marksWrong),
});

export const questionMetaOf = (row: Pick<OcrSubmission, "questionMeta">): SheetQuestion[] =>
  Array.isArray(row.questionMeta) ? (row.questionMeta as unknown as SheetQuestion[]) : [];

/** The correct answers the student's own sheet printed, or null when it printed none. */
export const sheetKeyMapOf = (row: Pick<OcrSubmission, "questionMeta">): AnswerKeyMap | null => {
  const entries = questionMetaOf(row)
    .filter((question) => question.correct_option !== null && question.correct_option !== undefined)
    .map((question) => [String(question.question), question.correct_option as number] as const);

  return entries.length ? Object.fromEntries(entries) : null;
};

export const sectionByQuestionOf = (
  row: Pick<OcrSubmission, "questionMeta">
): Record<string, string | null> =>
  Object.fromEntries(questionMetaOf(row).map((question) => [String(question.question), question.section]));

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
  has_answer_key: hasAnswerKey || keySourceOf(row) !== KEY_SOURCE.ADMIN_KEY,
  key_source: keySourceOf(row),
  marks_correct: row.marksCorrect === null ? null : Number(row.marksCorrect),
  marks_wrong: row.marksWrong === null ? null : Number(row.marksWrong),
  syllabus: syllabusOf(row),
  rank_by: rankByOf(row),
  paper_shifts: paperShiftsOf(row),
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
    cancelled_questions: cancelledCountOf(answerKeyMapOf(row)),
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
  entry_mode: row.entryMode as EntryMode,
  roll_number: row.rollNumber,
  candidate_name: row.candidateName,
  series: row.series,
  low_confidence_questions: Array.isArray(row.lowConfidenceQuestions)
    ? (row.lowConfidenceQuestions as number[])
    : [],
  failure_code: row.failureCode,
  created_at: row.createdAt,
});

/**
 * Scored questions are exactly the three tallies — cancelled ones count toward
 * none — so the total is read off the score itself rather than the paper. It is
 * then the total this score was actually marked out of, even after the key or
 * the paper changes.
 */
export const scoredQuestionsOf = (row: Pick<OcrScore, "correct" | "wrong" | "unanswered">) =>
  row.correct + row.wrong + row.unanswered;

export const toRankScoreDto = (row: OcrScore): RankScoreDto => ({
  correct: row.correct,
  wrong: row.wrong,
  unanswered: row.unanswered,
  raw_score: Number(row.rawScore),
  total_questions: scoredQuestionsOf(row),
});

export const toLeaderboardEntryDto = (
  row: LeaderboardRow,
  viewerCustomerId: number | null
): RankLeaderboardEntryDto => ({
  rank: row.rank_position,
  name: displayNameFor(row.full_name, row.show_real_name),
  raw_score: row.raw_score,
  normalized_score: row.normalized_score,
  total_questions: row.total_questions,
  is_me: viewerCustomerId !== null && row.customer_id === viewerCustomerId,
  submitted_at: row.submitted_at,
});

export const toAdminLeaderboardEntryDto = (row: LeaderboardRow): RankAdminLeaderboardEntryDto => ({
  rank: row.rank_position,
  customer_id: row.customer_id,
  name: trimmedOrNull(row.full_name) ?? handleFor(row.customer_id),
  shows_real_name: row.show_real_name,
  raw_score: row.raw_score,
  normalized_score: row.normalized_score,
  total_questions: row.total_questions,
  submitted_at: row.submitted_at,
});

/**
 * The key is the one the score was marked on: the admin key version it points at,
 * or — when the paper scores against the sheet's own key — the answers that sheet
 * printed, under the paper's marking.
 */
export const toRankAnswerReviewDto = (
  submission: OcrSubmission & { exam?: OcrExam },
  score: OcrScore,
  answerKey: OcrAnswerKey | null
): RankAnswerReviewDto => {
  const scheme = answerKey
    ? markingSchemeOf(answerKey)
    : examMarkingSchemeOf(submission.exam ?? { marksCorrect: null, marksWrong: null });
  const keys = withShiftCancellations(
    answerKey ? answerKeyMapOf(answerKey) : (sheetKeyMapOf(submission) ?? {}),
    submission.exam ?? { paperShifts: null },
    submission.shiftKey
  );

  // Marks are shown the way they were scored: a subject rescaled to its own
  // maximum scales each of its questions, so the lines still add up to the score.
  const factors = questionFactorsOf(
    keys,
    scheme,
    resolveSubjects(
      submission.exam ? syllabusOf(submission.exam) : [],
      Object.keys(keys),
      sectionByQuestionOf(submission)
    )
  );
  const isUniform = [...factors.values()].every((factor) => factor === 1);

  return {
    submission_id: String(submission.id),
    exam_id: String(submission.examId),
    series: submission.series,
    answer_key_version: answerKey?.version ?? null,
    marks_correct: scheme.marksCorrect,
    marks_wrong: scheme.marksWrong,
    uniform_marking: isUniform,
    score: toRankScoreDto(score),
    items: buildAnswerReview(answerMapOf(submission), keys, scheme).map((item) => ({
      question_no: item.questionNo,
      chosen: item.chosen,
      correct_options: item.correctOptions,
      correct_option: item.correctOptions[0] ?? null,
      verdict: item.verdict,
      marks: item.marks * (factors.get(String(item.questionNo)) ?? 1),
    })),
  };
};
