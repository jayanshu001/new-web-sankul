export const SUBMISSION_STATUS = {
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
  NEEDS_REVIEW: "needs_review",
} as const;

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
  EXAM_CODE_TAKEN: "exam_code_taken",
  EXAM_NOT_FOUND: "exam_not_found",
  EXTRACTION_UNCONFIGURED: "extraction_unconfigured",
  EXTRACTION_UNREACHABLE: "extraction_unreachable",
  FILE_REQUIRED: "file_required",
  FORBIDDEN: "forbidden",
  IS_ACTIVE_REQUIRED: "is_active_required",
  NOT_FOUND: "not_found",
  NOT_SCORABLE: "not_scorable",
  NOT_SCORED: "not_scored",
  QUESTION_COUNT_MISMATCH: "question_count_mismatch",
  SERIES_HAS_ACTIVE_KEY: "series_has_active_key",
  SERIES_NOT_ENABLED: "series_not_enabled",
  SERIES_REQUIRED: "series_required",
  UNKNOWN_EXTRACTION_ERROR: "unknown_error",
} as const;

export type RankError = (typeof RANK_ERROR)[keyof typeof RANK_ERROR];

export const SUBMISSION_WARNING = {
  NEEDS_REVIEW: "needs_review",
  NO_ACTIVE_ANSWER_KEY: "no_active_answer_key",
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

export const SKIP_OPTION = 5;
export const NEARBY_RANK_RADIUS = 3;
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

export interface AnswerReviewItem {
  questionNo: number;
  chosen: number | null;
  correctOption: number;
  verdict: AnswerVerdict;
  marks: number;
}

export type AnswerMap = Record<string, number | null | undefined>;
export type AnswerKeyMap = Record<string, number>;

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
  is_active: boolean;
  created_at: Date | null;
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
  total_questions: number;
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
  total_questions: number;
}

export interface RankAnswerReviewItemDto {
  question_no: number;
  chosen: number | null;
  correct_option: number;
  verdict: AnswerVerdict;
  marks: number;
}

export interface RankAnswerReviewDto {
  submission_id: string;
  exam_id: string;
  series: string | null;
  answer_key_version: number;
  marks_correct: number;
  marks_wrong: number;
  score: RankScoreDto;
  items: RankAnswerReviewItemDto[];
}

export interface RankSubmissionDto {
  _id: string;
  id: number;
  exam_id: string;
  status: SubmissionStatus;
  extraction_kind: ExtractionKind | null;
  roll_number: string | null;
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

export interface RankNeighbourDto {
  rank: number;
  name: string;
  raw_score: number;
  is_me: boolean;
}

export interface RankStandingDto {
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
  nearby: RankNeighbourDto[];
}

export interface RankLeaderboardEntryDto {
  rank: number;
  name: string;
  raw_score: number;
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

export interface LeaderboardParams {
  examId: bigint;
  page: number;
  pageSize: number;
}

export interface RescoreOutcome {
  rescored: number;
  skipped: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}
