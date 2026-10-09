export const SUBMISSION_STATUS = {
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
  NEEDS_REVIEW: "needs_review",
} as const;

export const ENTRY_MODE = {
  SHEET: "sheet",
  /** The student typed their total; there is no sheet to re-mark or review. */
  MARKS: "marks",
} as const;

export type EntryMode = (typeof ENTRY_MODE)[keyof typeof ENTRY_MODE];

export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];

export const SUBMISSION_STATUSES = Object.values(SUBMISSION_STATUS) as readonly SubmissionStatus[];

export const isSubmissionStatus = (value: unknown): value is SubmissionStatus =>
  typeof value === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(value);

export const EXTRACTION_KIND = {
  TEXT_LAYER: "text_layer",
  OMR: "omr",
} as const;

export type ExtractionKind = (typeof EXTRACTION_KIND)[keyof typeof EXTRACTION_KIND];

export const ANSWER_VERDICT = {
  CORRECT: "correct",
  WRONG: "wrong",
  UNANSWERED: "unanswered",
  CANCELLED: "cancelled",
} as const;

export type AnswerVerdict = (typeof ANSWER_VERDICT)[keyof typeof ANSWER_VERDICT];

export const ACTOR_TYPE = {
  CUSTOMER: "customer",
  ADMIN: "admin",
  SYSTEM: "system",
} as const;

export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];

export const AUDIT_ENTITY = {
  EXAM: "exam",
  ANSWER_KEY: "answer_key",
  SUBMISSION: "submission",
  CUSTOMER: "customer",
} as const;

export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];

export const AUDIT_ACTION = {
  EXAM_CREATED: "exam_created",
  EXAM_UPDATED: "exam_updated",
  EXAM_DELETED: "exam_deleted",
  ANSWER_KEY_UPLOADED: "answer_key_uploaded",
  ANSWER_KEY_STATUS_CHANGED: "answer_key_status_changed",
  ANSWER_KEY_RESCORE: "answer_key_rescore",
  SUBMISSION_EXTRACTED: "submission_extracted",
  SUBMISSION_EXTRACTION_FAILED: "submission_extraction_failed",
  SUBMISSION_QUESTION_COUNT_MISMATCH: "submission_question_count_mismatch",
  EXAM_RESCORED: "exam_rescored",
  SUBMISSION_SCORED: "submission_scored",
  SUBMISSION_SCORE_CLEARED: "submission_score_cleared",
  SUBMISSION_CONFIRMED: "submission_confirmed",
  SUBMISSION_DELETED: "submission_deleted",
  CANDIDATE_PROFILE_SAVED: "candidate_profile.save",
  CANDIDATE_PROFILE_FORGOTTEN: "candidate_profile.forget",
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const RANK_ERROR = {
  ALREADY_SUBMITTED: "already_submitted",
  ANSWER_KEY_REQUIRED: "answer_key_required",
  CANCELLED_QUESTION_OUT_OF_RANGE: "cancelled_question_out_of_range",
  EXAM_CODE_TAKEN: "exam_code_taken",
  EXAM_NOT_FOUND: "exam_not_found",
  EXTRACTION_UNCONFIGURED: "extraction_unconfigured",
  EXTRACTION_UNREACHABLE: "extraction_unreachable",
  FILE_REQUIRED: "file_required",
  FORBIDDEN: "forbidden",
  IS_ACTIVE_REQUIRED: "is_active_required",
  MARKS_OUT_OF_RANGE: "marks_out_of_range",
  NOT_FOUND: "not_found",
  NOT_SCORABLE: "not_scorable",
  NOT_SCORED: "not_scored",
  QUESTION_COUNT_MISMATCH: "question_count_mismatch",
  RANK_BREAKDOWN_DISABLED: "rank_breakdown_disabled",
  REVIEW_UNAVAILABLE: "review_unavailable",
  SHEET_ALREADY_SUBMITTED: "sheet_already_submitted",
  SHEET_NOT_ACCEPTED: "sheet_not_accepted",
  SHEET_URL_INVALID: "sheet_url_invalid",
  SHEET_URL_UNREACHABLE: "sheet_url_unreachable",
  SERIES_HAS_ACTIVE_KEY: "series_has_active_key",
  SERIES_NOT_ENABLED: "series_not_enabled",
  SERIES_REQUIRED: "series_required",
  SHIFT_REQUIRED: "shift_required",
  SHIFT_NOT_LISTED: "shift_not_listed",
  SHIFTS_REQUIRED: "shifts_required",
  SUBMISSION_MODE_DISABLED: "submission_mode_disabled",
  SUBMISSION_MODES_INVALID: "submission_modes_invalid",
  UNKNOWN_EXTRACTION_ERROR: "unknown_error",
} as const;

export type RankError = (typeof RANK_ERROR)[keyof typeof RANK_ERROR];

export const SUBMISSION_WARNING = {
  NEEDS_REVIEW: "needs_review",
  NO_ACTIVE_ANSWER_KEY: "no_active_answer_key",
  /** The paper scores against the sheet's own key, and this sheet printed none. */
  SHEET_HAS_NO_ANSWER_KEY: "sheet_has_no_answer_key",
  /** Uploaded and queued; the result lands when the sheet has been read. */
  QUEUED: "queued",
} as const;

export type SubmissionWarning = (typeof SUBMISSION_WARNING)[keyof typeof SUBMISSION_WARNING];

export const CASTE_CATEGORY = {
  OPEN: "open",
  SEBC: "sebc",
  EWS: "ews",
  SC: "sc",
  ST: "st",
} as const;

export type CasteCategory = (typeof CASTE_CATEGORY)[keyof typeof CASTE_CATEGORY];

export const CASTE_CATEGORIES = Object.values(CASTE_CATEGORY) as [CasteCategory, ...CasteCategory[]];

export const GENDER = {
  MALE: "male",
  FEMALE: "female",
} as const;

export type Gender = (typeof GENDER)[keyof typeof GENDER];

export const GENDERS = Object.values(GENDER) as [Gender, ...Gender[]];

export const KEY_SOURCE = {
  ADMIN_KEY: "admin_key",
  SHEET: "sheet",
  /** No OMR and no key: students type their total; nothing is uploaded or marked. */
  MARKS_ONLY: "marks_only",
} as const;

export type KeySource = (typeof KEY_SOURCE)[keyof typeof KEY_SOURCE];

export const KEY_SOURCES = Object.values(KEY_SOURCE) as [KeySource, ...KeySource[]];

/** The breakdowns an admin can switch on for a paper. */
export const RANK_BY = {
  SHIFT: "shift",
  CATEGORY: "category",
  SUBJECT: "subject",
  /** Boards that span shifts rank on SSC-style normalized marks instead of raw marks. */
  NORMALIZED: "normalized",
} as const;

export type RankBy = (typeof RANK_BY)[keyof typeof RANK_BY];

export const RANK_BY_VALUES = Object.values(RANK_BY) as [RankBy, ...RankBy[]];

/** The ways a student can hand in a result; an admin can switch each off per paper. */
export const SUBMISSION_MODE = {
  /** The `file` field: a PDF, or a Digialm page the app downloaded. */
  PDF: "pdf",
  URL: "url",
  MARKS: "marks",
} as const;

export type SubmissionMode = (typeof SUBMISSION_MODE)[keyof typeof SUBMISSION_MODE];

export const SUBMISSION_MODES = Object.values(SUBMISSION_MODE) as [SubmissionMode, ...SubmissionMode[]];

/** What a paper that predates `rank_by` shows: the category rank it always had. */
export const LEGACY_RANK_BY: readonly RankBy[] = [RANK_BY.CATEGORY];

export const OTHER_SUBJECT = "Other";
export const MAX_SYLLABUS_SUBJECTS = 30;
export const MAX_PAPER_SHIFTS = 100;

export const SKIP_OPTION = 5;
/**
 * A question the board dropped. It stays in the key, so the key still covers
 * every question on the paper, but it is scored for no one: a 200-question paper
 * with one cancellation is marked out of 199.
 */
export const CANCELLED_QUESTION = "*";
export const NEARBY_RANK_RADIUS = 3;
/**
 * A shift smaller than this is too thin to normalize; its marks are used as they are.
 * Papers can have dozens of shifts and only some candidates upload, so a shift needs
 * enough people before its spread means anything.
 */
export const NORMALIZATION_MIN_SHIFT_CANDIDATES = 30;
/**
 * The "top" of a shift is its best 1%, but never fewer than this many people: the
 * classic top-0.1% of a few hundred uploads is a single candidate, and one lucky
 * or typed-in score would then move the whole shift.
 */
export const NORMALIZATION_TOP_SHARE = 0.01;
export const NORMALIZATION_MIN_TOP_COUNT = 5;
export const MASKED_NAME_FALLBACK = "***";
export const CUSTOMER_HANDLE_PREFIX = "ws_";
export const PRISMA_UNIQUE_VIOLATION = "P2002";
export const MAX_PAPER_SERIES = 8;
export const MAX_TOTAL_QUESTIONS = 1000;

export interface MarkingScheme {
  marksCorrect: number;
  marksWrong: number;
}

export interface ScoreResult {
  correct: number;
  wrong: number;
  unanswered: number;
  rawScore: number;
}

/**
 * One subject of a paper's syllabus. Only `name` is required.
 *  - `marks`   the subject's maximum; each of its questions is then worth marks / count,
 *              with the wrong-answer penalty scaled by the same factor.
 *  - `section` the section heading printed on the sheet to read from (defaults to `name`).
 *  - `from_question` / `to_question`  a question-number range, for sheets with no sections.
 */
export interface SyllabusSubject {
  name: string;
  marks?: number;
  section?: string;
  from_question?: number;
  to_question?: number;
}

/**
 * One slot an admin set up for the paper.
 *  - `key` "YYYY-MM-DDTHH:MM", the same form a sheet's shift is read as.
 *  - `cancelled_questions` question numbers the board dropped for that slot only;
 *    scored for no one who sat it, the same as `*` in an admin key.
 */
export interface PaperShift {
  key: string;
  cancelled_questions: number[];
}

export interface ResolvedSubject {
  name: string;
  questions: string[];
  marks: number | null;
}

export interface SubjectScoreRow {
  subject: string;
  correct: number;
  wrong: number;
  unanswered: number;
  score: number;
  maxMarks: number;
}

export interface ScoreWithSubjects extends ScoreResult {
  subjects: SubjectScoreRow[];
}

/** What the sheet states about one question; `correctOption` is only set when the sheet colour-codes it. */
export interface SheetQuestion {
  question: number;
  question_id: string;
  section: string | null;
  option_ids: string[];
  chosen_option_id: string | null;
  correct_option: number | null;
  correct_option_id: string | null;
  status: string | null;
}

export interface SheetCandidate {
  participant_id: string | null;
  name: string | null;
  test_center: string | null;
  test_date: string | null;
  test_time: string | null;
  test_start: string | null;
  exam_title: string | null;
  subject: string | null;
}

export interface AnswerReviewItem {
  questionNo: number;
  chosen: number | null;
  /** Every option that scores; more than one when the board accepted several. Empty when cancelled. */
  correctOptions: number[];
  verdict: AnswerVerdict;
  marks: number;
}

export type AnswerMap = Record<string, number | null | undefined>;
/** One option, several accepted options (any of them scores), or cancelled. */
export type AnswerKeyEntry = number | number[] | typeof CANCELLED_QUESTION;
export type AnswerKeyMap = Record<string, AnswerKeyEntry>;

export interface RankExamDto {
  _id: string;
  id: number;
  code: string;
  name: string;
  total_questions: number;
  category: string | null;
  exam_date: Date | null;
  paper_series: string[];
  submission_count: number;
  has_answer_key: boolean;
  key_source: KeySource;
  marks_correct: number | null;
  marks_wrong: number | null;
  syllabus: SyllabusSubject[];
  rank_by: RankBy[];
  /** Slots the admin set up, with any per-slot cancellations. Required on a marks_only paper. */
  paper_shifts: PaperShift[];
  /** How students may submit. A paper that never chose takes all three. */
  submission_modes: SubmissionMode[];
  is_active: boolean;
  created_at: Date | null;
  /** Slots on offer: the admin's, plus any read off scored sheets. Only on the single-paper read. */
  shifts?: RankShiftDto[];
  /** Subjects that have scores, in paper order. Only on the single-paper read. */
  subjects?: string[];
}

export interface RankShiftDto {
  key: string;
  candidates: number;
}

export interface RankAnswerKeyDto {
  _id: string;
  id: number;
  exam_id: string;
  version: number;
  is_active: boolean;
  series: string | null;
  marks_correct: number;
  marks_wrong: number;
  /** Questions the key covers, cancelled ones included — compared against the paper's count. */
  total_questions: number;
  cancelled_questions: number;
  has_source_pdf: boolean;
  created_at: Date | null;
}

export interface RankAnswerKeyAdminDto extends RankAnswerKeyDto {
  keys: AnswerKeyMap;
}

export interface RankScoreDto {
  correct: number;
  wrong: number;
  unanswered: number;
  raw_score: number;
  /** Questions this score was marked out of — the paper's count less any cancelled. */
  total_questions: number;
}

export interface RankAnswerReviewItemDto {
  question_no: number;
  chosen: number | null;
  correct_options: number[];
  /** The first of `correct_options`, for clients that predate multi-answer keys. Null when cancelled. */
  correct_option: number | null;
  verdict: AnswerVerdict;
  marks: number;
}

export interface RankAnswerReviewDto {
  submission_id: string;
  exam_id: string;
  series: string | null;
  /** Null when the paper scores against the key printed on the student's own sheet. */
  answer_key_version: number | null;
  marks_correct: number;
  marks_wrong: number;
  /**
   * False when a syllabus subject is rescaled to its own maximum marks, so
   * correct × marks_correct − wrong × marks_wrong no longer adds up to the score
   * and a client should not present it as the arithmetic.
   */
  uniform_marking: boolean;
  score: RankScoreDto;
  items: RankAnswerReviewItemDto[];
}

export interface RankSubmissionDto {
  _id: string;
  id: number;
  exam_id: string;
  status: SubmissionStatus;
  extraction_kind: ExtractionKind | null;
  entry_mode: EntryMode;
  roll_number: string | null;
  /** Name printed on the sheet, when it prints one. */
  candidate_name: string | null;
  series: string | null;
  low_confidence_questions: number[];
  failure_code: string | null;
  created_at: Date | null;
}

export interface RankSubmissionResultDto {
  submission_id: string;
  status: SubmissionStatus;
  score: RankScoreDto | null;
  rank?: number | null;
  percentile?: number | null;
  total_candidates?: number;
  low_confidence_questions?: number[];
  warning?: SubmissionWarning;
}

export interface RankSheetStatusDto {
  submission_id: string | null;
  status: SubmissionStatus | null;
  /** Why the sheet failed, when it did — a RANK_ERROR / OCR code the student copy covers. */
  failure_code: string | null;
  scored: boolean;
}

/** What reading one queued sheet came to: its result, or the error the upload should answer with. */
export type RankSheetJobOutcome =
  | { ok: true; result: RankSubmissionResultDto }
  | { ok: false; status: number; message: string; details: Record<string, unknown> };

export interface RankNeighbourDto {
  rank: number;
  name: string;
  raw_score: number;
  /** What the board is ordered on when the paper normalizes across shifts; null otherwise. */
  normalized_score: number | null;
  is_me: boolean;
}

export interface RankPositionDto {
  rank: number | null;
  percentile: number | null;
  total_candidates: number;
  /** Mean raw score of everyone on this board; null when the board is empty. */
  average_marks: number | null;
}

export interface RankSubjectStandingDto {
  name: string;
  score: number;
  max_marks: number;
  correct: number;
  wrong: number;
  unanswered: number;
  rank: number | null;
  total_candidates: number;
}

export interface RankStandingDto {
  /** The viewer's own marks; `normalized_score` is null unless the paper normalizes across shifts. */
  raw_score: number | null;
  normalized_score: number | null;
  rank: number | null;
  percentile: number | null;
  total_candidates: number;
  /**
   * The viewer's own caste category, echoed so the client can label the rank
   * below without a second read. Null until the profile gate is answered.
   */
  caste_category: CasteCategory | null;
  /**
   * Rank among candidates who answered the same category. Null whenever there
   * is no category to rank within — the gate is unanswered, or this sheet is
   * not scored yet.
   */
  category_rank: number | null;
  category_total_candidates: number | null;
  category_percentile: number | null;
  /** Mean raw score of the whole paper / of the viewer's category board. */
  average_marks: number | null;
  category_average_marks: number | null;
  /** The viewer's own gender, echoed like `caste_category`; null until the profile gate is answered. */
  gender: Gender | null;
  /** Same boards narrowed to the viewer's gender; null when gender is unanswered or the board is off. */
  overall_gender: RankPositionDto | null;
  shift_gender: RankPositionDto | null;
  category_gender: RankPositionDto | null;
  /** Standing among ex-servicemen; null unless the viewer's profile says they are one. */
  ex_serviceman: RankPositionDto | null;
  /** Standing within the viewer's own shift; null unless the paper ranks by shift and the sheet names one. */
  shift: (RankPositionDto & { key: string }) | null;
  /** Standing within the viewer's shift AND category together. */
  shift_category: RankPositionDto | null;
  /** Subject-wise score and rank; null unless the paper ranks by subject. */
  subjects: RankSubjectStandingDto[] | null;
  nearby: RankNeighbourDto[];
}

export interface RankLeaderboardEntryDto {
  rank: number;
  name: string;
  raw_score: number;
  normalized_score: number | null;
  total_questions: number;
  is_me: boolean;
  submitted_at: Date | null;
}

export interface RankCustomerDto {
  id: number;
  name: string;
  handle: string;
  phone: string | null;
  email: string | null;
}

export interface RankAdminLeaderboardEntryDto {
  rank: number;
  customer_id: number;
  name: string;
  shows_real_name: boolean;
  raw_score: number;
  normalized_score: number | null;
  total_questions: number;
  submitted_at: Date | null;
}

export interface RankMyExamDto {
  exam: RankExamDto;
  rank: number | null;
  percentile: number | null;
  total_candidates: number;
  score: RankScoreDto | null;
  submitted_at: Date | null;
  status: SubmissionStatus;
}

export interface RankExamDeletionDto {
  _id: string;
  id: number;
  code: string;
  name: string;
  submissions_deleted: number;
  scores_deleted: number;
  answer_keys_deleted: number;
}

export interface RankSubmissionDeletionDto {
  _id: string;
  exam_id: string;
  customer_id: number;
  score_removed: boolean;
}

export interface LeaderboardRow {
  customer_id: number;
  raw_score: number;
  normalized_score: number | null;
  total_questions: number;
  rank_position: number;
  submitted_at: Date | null;
  full_name: string | null;
  show_real_name: boolean;
}

export interface RankCandidateProfileDto {
  caste_category: CasteCategory | null;
  gender: Gender | null;
  is_ex_serviceman: boolean | null;
  is_complete: boolean;
}

export interface CandidateProfileInput {
  casteCategory: CasteCategory;
  gender: Gender;
  isExServiceman: boolean;
}

export interface ExamCreateInput {
  code: string;
  name: string;
  totalQuestions: number;
  category?: string | null;
  examDate?: Date | null;
  paperSeries?: string[];
  keySource?: KeySource;
  marksCorrect?: number | null;
  marksWrong?: number | null;
  syllabus?: SyllabusSubject[];
  rankBy?: RankBy[];
  paperShifts?: PaperShift[];
  submissionModes?: SubmissionMode[];
  isActive?: boolean;
}

export type ExamUpdateInput = Partial<ExamCreateInput>;

export interface AnswerKeyPublishInput {
  examId: bigint;
  series: string | null;
  keys: AnswerKeyMap;
  marksCorrect: number;
  marksWrong: number;
  sourcePdfKey: string | null;
  adminId: number | null;
}

export interface MarksSubmissionInput {
  examId: bigint;
  customerId: number;
  series: string | null;
  marks: number;
  /** The slot the student sat; required when the paper ranks by shift. */
  shiftKey: string | null;
}

export interface SubmissionCreateInput {
  examId: bigint;
  customerId: number;
  series: string | null;
  fileBuffer: Buffer;
  fileName: string;
}

export interface ExamListParams {
  search?: string;
  page: number;
  limit: number;
  isActive?: boolean;
}

export interface SubmissionListParams {
  status?: SubmissionStatus;
  examId?: bigint;
  page: number;
  limit: number;
}

/** Which part of the field a board covers. Empty = the whole paper. */
export interface BoardScope {
  shiftKey?: string | null;
  casteCategory?: CasteCategory | null;
  gender?: Gender | null;
  /** Only `true` narrows: the board of candidates who answered they are ex-servicemen. */
  exServiceman?: boolean | null;
  subject?: string | null;
}

/** Per-shift linear map onto the common scale: normalized = scale × raw + offset. */
export type ShiftNormalization = Map<string, { scale: number; offset: number }>;

/** A shift's (or, with `shift_key` null, the whole field's) spread, as normalization reads it. */
export interface ShiftStatsRow {
  shift_key: string | null;
  candidates: number;
  /** Mean + standard deviation. */
  mean_plus_sd: number;
  /** Mean of the top 0.1% (at least one candidate). */
  top_mean: number;
}

export interface LeaderboardParams {
  examId: bigint;
  page: number;
  pageSize: number;
  scope?: BoardScope;
}

export interface RescoreOutcome {
  rescored: number;
  skipped: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}
