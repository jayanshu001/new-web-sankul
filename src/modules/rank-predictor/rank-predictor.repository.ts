import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import {
  ENTRY_MODE,
  NORMALIZATION_MIN_TOP_COUNT,
  NORMALIZATION_TOP_SHARE,
  SUBMISSION_STATUS,
  type BoardScope,
  type LeaderboardRow,
  type RankViewer,
  type ShiftNormalization,
  type ShiftStatsRow,
  type SubjectScoreRow,
} from "./rank-predictor.types";

type CountRow = { c: unknown };

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const countOf = (rows: CountRow[] | undefined): number => asNumber(rows?.[0]?.c);

const byProfile = (scope: BoardScope): boolean =>
  Boolean(scope.casteCategory || scope.gender || scope.exServiceman);

/**
 * The scores a board covers: the whole paper, narrowed by shift, caste
 * category, gender and/or ex-serviceman status. The profile join is inner for a
 * category or gender board — a candidate with no category answered is in neither
 * the numerator nor the denominator there, though they still count towards the
 * overall rank — and outer otherwise. The customer join supplies the date of
 * birth (`cu.dob`) that breaks ties.
 */
const scopedScores = (examId: bigint, scope: BoardScope = {}) => Prisma.sql`
  FROM ws_ocr_scores s
  ${byProfile(scope) ? Prisma.sql`JOIN` : Prisma.sql`LEFT JOIN`} ws_ocr_profiles p ON p.customer_id = s.customer_id
  LEFT JOIN ws_customer cu ON cu.id = s.customer_id
  WHERE s.exam_id = ${examId}
  ${scope.shiftKey ? Prisma.sql`AND s.shift_key = ${scope.shiftKey}` : Prisma.empty}
  ${scope.casteCategory ? Prisma.sql`AND p.caste_category = ${scope.casteCategory}` : Prisma.empty}
  ${scope.gender ? Prisma.sql`AND p.gender = ${scope.gender}` : Prisma.empty}
  ${scope.exServiceman ? Prisma.sql`AND p.is_ex_serviceman = 1` : Prisma.empty}`;

const countScores = (examId: bigint, scope?: BoardScope) =>
  prisma.$queryRaw<CountRow[]>`SELECT COUNT(*) c ${scopedScores(examId, scope)}`;

/**
 * The mark a board orders on: raw, or each shift's raw mapped onto the common
 * scale. Normalized marks are rounded to the stored 4 places so that the board's
 * RANK() and a viewer's own count (rankForExam) agree on what is a tie.
 */
const boardScore = (normalization?: ShiftNormalization | null) =>
  normalization?.size
    ? Prisma.sql`ROUND(CASE s.shift_key ${Prisma.join(
        [...normalization].map(
          ([key, { scale, offset }]) => Prisma.sql`WHEN ${key} THEN s.raw_score * ${scale} + ${offset}`
        ),
        " "
      )} ELSE s.raw_score END, 4)`
    : Prisma.sql`s.raw_score`;

/**
 * Marks sit on a 0.0001 grid (see boardScore), so half a step apart is the
 * narrowest real lead; anything closer is the same mark read through floats.
 */
const SCORE_EPSILON = 0.00005;

/** A viewer's mark on the same grid as boardScore. */
const onGrid = (score: number): number => Math.round(score * 10_000) / 10_000;

/**
 * Government merit lists break a tie on marks by age: the elder ranks higher.
 * Every board orders on its mark, then date of birth earliest first; a candidate
 * who has not given one sorts after everyone on the same mark who has. The date
 * is the customer's own `ws_customer.dob` — the one their account profile edits.
 */
const tieOrder = (dob: Prisma.Sql) => Prisma.sql`${dob} IS NULL, ${dob} ASC`;

/** Ahead of a viewer born on `dob` when on the same mark. */
const elderThan = (dob: string | null, column: Prisma.Sql = Prisma.sql`cu.dob`) =>
  dob === null ? Prisma.sql`${column} IS NOT NULL` : Prisma.sql`${column} < ${dob}`;

const isoDate = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

const toLeaderboardRow = (row: Record<string, unknown>): LeaderboardRow => ({
  customer_id: asNumber(row.customer_id),
  raw_score: asNumber(row.raw_score),
  normalized_score:
    row.normalized_score == null ? null : Math.round(asNumber(row.normalized_score) * 100) / 100,
  total_questions: asNumber(row.total_questions),
  rank_position: asNumber(row.rank_position),
  submitted_at: (row.submitted_at as Date | null) ?? null,
  full_name: (row.full_name as string | null) ?? null,
  show_real_name: Boolean(asNumber(row.show_real_name)),
  entry_mode: (row.entry_mode as string | null) ?? null,
  max_marks: row.max_marks == null ? null : asNumber(row.max_marks),
  date_of_birth: isoDate(row.date_of_birth),
  caste_category: (row.caste_category as string | null) ?? null,
  gender: (row.gender as string | null) ?? null,
});

export const rankPredictorRepository = {
  listExams: (where: Prisma.OcrExamWhereInput, skip: number, take: number) =>
    Promise.all([
      prisma.ocrExam.findMany({
        where,
        orderBy: [{ examDate: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.ocrExam.count({ where }),
    ]),

  findExamById: (id: bigint) => prisma.ocrExam.findUnique({ where: { id } }),

  findExamByCode: (code: string) => prisma.ocrExam.findUnique({ where: { code } }),

  createExam: (data: Prisma.OcrExamCreateInput) => prisma.ocrExam.create({ data }),

  updateExam: (id: bigint, data: Prisma.OcrExamUpdateInput) =>
    prisma.ocrExam.update({ where: { id }, data }),

  findExamStoredPdfKeys: async (examId: bigint): Promise<string[]> => {
    const [submissions, answerKeys] = await Promise.all([
      prisma.ocrSubmission.findMany({
        where: { examId, sourcePdfKey: { not: null } },
        select: { sourcePdfKey: true },
      }),
      prisma.ocrAnswerKey.findMany({
        where: { examId, sourcePdfKey: { not: null } },
        select: { sourcePdfKey: true },
      }),
    ]);

    return [...submissions, ...answerKeys]
      .map((row) => row.sourcePdfKey)
      .filter((key): key is string => Boolean(key));
  },

  deleteExamCascade: (id: bigint) =>
    prisma.$transaction(async (tx) => {
      const scores = await tx.ocrScore.deleteMany({ where: { examId: id } });
      const submissions = await tx.ocrSubmission.deleteMany({ where: { examId: id } });
      const answerKeys = await tx.ocrAnswerKey.deleteMany({ where: { examId: id } });
      await tx.ocrExam.delete({ where: { id } });

      return {
        scores: scores.count,
        submissions: submissions.count,
        answerKeys: answerKeys.count,
      };
    }),

  countCandidatesByExam: async (examIds: bigint[]): Promise<Map<string, number>> => {
    if (!examIds.length) return new Map();

    const rows = await prisma.ocrScore.groupBy({
      by: ["examId"],
      where: { examId: { in: examIds } },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [String(row.examId), row._count._all]));
  },

  examIdsWithActiveKey: async (examIds: bigint[]): Promise<Set<string>> => {
    if (!examIds.length) return new Set();

    const rows = await prisma.ocrAnswerKey.findMany({
      where: { examId: { in: examIds }, isActive: true },
      select: { examId: true },
      distinct: ["examId"],
    });

    return new Set(rows.map((row) => String(row.examId)));
  },

  listAnswerKeys: (examId: bigint) =>
    prisma.ocrAnswerKey.findMany({ where: { examId }, orderBy: { version: "desc" } }),

  findAnswerKeyById: (id: bigint) => prisma.ocrAnswerKey.findUnique({ where: { id } }),

  findActiveAnswerKey: (examId: bigint, series: string | null) =>
    prisma.ocrAnswerKey.findFirst({
      where: { examId, isActive: true, series },
      orderBy: { version: "desc" },
    }),

  nextAnswerKeyVersion: async (examId: bigint): Promise<number> => {
    const latest = await prisma.ocrAnswerKey.findFirst({
      where: { examId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    return (latest?.version ?? 0) + 1;
  },

  publishAnswerKey: (examId: bigint, series: string | null, data: Prisma.OcrAnswerKeyCreateInput) =>
    prisma.$transaction(async (tx) => {
      await tx.ocrAnswerKey.updateMany({
        where: { examId, series, isActive: true },
        data: { isActive: false },
      });

      return tx.ocrAnswerKey.create({ data });
    }),

  setAnswerKeyActive: (id: bigint, isActive: boolean) =>
    prisma.ocrAnswerKey.update({ where: { id }, data: { isActive } }),

  activateAnswerKeyExclusively: (examId: bigint, series: string | null, id: bigint) =>
    prisma.$transaction(async (tx) => {
      await tx.ocrAnswerKey.updateMany({
        where: { examId, series, isActive: true, NOT: { id } },
        data: { isActive: false },
      });

      return tx.ocrAnswerKey.update({ where: { id }, data: { isActive: true } });
    }),

  countActiveKeysForSeries: (examId: bigint, series: string) =>
    prisma.ocrAnswerKey.count({ where: { examId, series, isActive: true } }),

  findSubmissionById: (id: bigint) => prisma.ocrSubmission.findUnique({ where: { id } }),

  findSubmissionWithScore: (id: bigint) =>
    prisma.ocrSubmission.findUnique({ where: { id }, include: { score: true, exam: true } }),

  /**
   * Sheets that were read and are still stored, with what files them in the
   * organised folders. Narrowed to one customer when their profile changes;
   * unnarrowed for the folder sync script.
   */
  listReadSheets: (customerId?: number) =>
    prisma.ocrSubmission.findMany({
      where: {
        ...(customerId === undefined ? {} : { customerId }),
        status: { in: [SUBMISSION_STATUS.PROCESSED, SUBMISSION_STATUS.NEEDS_REVIEW] },
        sourcePdfKey: { not: null },
      },
      select: {
        id: true,
        customerId: true,
        sourcePdfKey: true,
        shiftKey: true,
        rollNumber: true,
        exam: { select: { code: true } },
      },
      orderBy: { id: "asc" },
    }),

  findProfilesFor: (customerIds: number[]) =>
    customerIds.length === 0
      ? Promise.resolve([])
      : prisma.ocrProfile.findMany({
          where: { customerId: { in: customerIds } },
          select: { customerId: true, casteCategory: true, gender: true },
        }),

  findSubmissionWithExam: (id: bigint) =>
    prisma.ocrSubmission.findUnique({ where: { id }, include: { exam: true } }),

  /**
   * Sheets stored but not yet read — what a crash or a deploy leaves behind.
   * Bounded to the last day: anything older was already settled as failed.
   */
  listPendingSheetSubmissionIds: async (): Promise<bigint[]> => {
    const rows = await prisma.ocrSubmission.findMany({
      where: {
        status: SUBMISSION_STATUS.PROCESSING,
        entryMode: ENTRY_MODE.SHEET,
        sourcePdfKey: { not: null },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 10_000,
    });
    return rows.map((row) => row.id);
  },

  /** The student's latest sheet on a paper, as little as a status poll needs. */
  findLatestSubmissionStatus: (examId: bigint, customerId: number) =>
    prisma.ocrSubmission.findFirst({
      where: { examId, customerId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, failureCode: true, score: { select: { id: true } } },
    }),

  findActiveSubmission: (examId: bigint, customerId: number) =>
    prisma.ocrSubmission.findFirst({
      where: { examId, customerId, status: { not: SUBMISSION_STATUS.FAILED } },
      select: { id: true, createdAt: true, status: true },
    }),

  createSubmission: (data: Prisma.OcrSubmissionUncheckedCreateInput) =>
    prisma.ocrSubmission.create({ data }),

  updateSubmission: (id: bigint, data: Prisma.OcrSubmissionUpdateInput) =>
    prisma.ocrSubmission.update({ where: { id }, data }),

  deleteSubmission: (id: bigint) => prisma.ocrSubmission.delete({ where: { id } }),

  listSubmissions: (where: Prisma.OcrSubmissionWhereInput, skip: number, take: number) =>
    Promise.all([
      prisma.ocrSubmission.findMany({
        where,
        orderBy: { id: "desc" },
        skip,
        take,
        include: { exam: true, score: true },
      }),
      prisma.ocrSubmission.count({ where }),
    ]),

  listMySubmissions: (customerId: number) =>
    prisma.ocrSubmission.findMany({
      where: { customerId, status: { not: SUBMISSION_STATUS.FAILED } },
      orderBy: { id: "desc" },
      include: { exam: true, score: true },
    }),

  listScoredSubmissions: (examId: bigint, series: string | null) =>
    prisma.ocrSubmission.findMany({
      where: { examId, series, status: SUBMISSION_STATUS.PROCESSED, entryMode: ENTRY_MODE.SHEET },
      select: { id: true },
      orderBy: { id: "asc" },
    }),

  upsertScore: (
    submissionId: bigint,
    create: Prisma.OcrScoreUncheckedCreateInput,
    update: Prisma.OcrScoreUncheckedUpdateInput
  ) => prisma.ocrScore.upsert({ where: { submissionId }, create, update }),

  findScoreBySubmission: (submissionId: bigint) =>
    prisma.ocrScore.findUnique({ where: { submissionId } }),

  deleteScoreBySubmission: (submissionId: bigint) =>
    prisma.ocrScore.deleteMany({ where: { submissionId } }),

  findScoreForCustomer: (examId: bigint, customerId: number) =>
    prisma.ocrScore.findUnique({ where: { examId_customerId: { examId, customerId } } }),

  findScoreForReview: (examId: bigint, customerId: number) =>
    prisma.ocrScore.findUnique({
      where: { examId_customerId: { examId, customerId } },
      include: { submission: { include: { exam: true } }, answerKey: true },
    }),

  /**
   * How many candidates are on a board and how many of them rank above the
   * viewer: a higher mark, or the same mark and an earlier date of birth (see
   * tieOrder). Rank is `higher + 1`, so only the same mark AND the same birthday
   * share a rank. With a normalization, `score` is the viewer's normalized mark
   * and the board (and its average) is read on that scale.
   *
   * With `viewer.scoreId`, `tiedBefore` also counts the candidates still tied with
   * the viewer that the board lists ahead of them (it breaks those on the score
   * id), so `higher + tiedBefore` is the viewer's row on the board.
   */
  rankForExam: async (
    examId: bigint,
    score: number,
    scope: BoardScope,
    normalization: ShiftNormalization | null,
    viewer: RankViewer
  ): Promise<{ higher: number; candidates: number; average: number | null; tiedBefore: number }> => {
    const mark = boardScore(normalization);
    const viewerMark = onGrid(score);
    const sameMark = Prisma.sql`ABS(${mark} - ${viewerMark}) <= ${SCORE_EPSILON}`;
    // One pass over the board for all the numbers: a result page asks for up to
    // eight boards, and a query each would hold a pool connection each.
    const [row] = await prisma.$queryRaw<
      { candidates: unknown; higher: unknown; average: unknown; tied_before: unknown }[]
    >`
      SELECT COUNT(*) AS candidates,
             COALESCE(SUM(${mark} > ${viewerMark + SCORE_EPSILON} OR (${sameMark} AND ${elderThan(viewer.dateOfBirth)})), 0) AS higher,
             AVG(${mark}) AS average,
             ${
               viewer.scoreId === undefined
                 ? Prisma.sql`0`
                 : Prisma.sql`COALESCE(SUM(${sameMark} AND cu.dob <=> ${viewer.dateOfBirth} AND s.id < ${viewer.scoreId}), 0)`
             } AS tied_before
        ${scopedScores(examId, scope)}
    `;
    const mean = row?.average;

    return {
      candidates: row ? asNumber(row.candidates) : 0,
      higher: row ? asNumber(row.higher) : 0,
      average: mean == null ? null : Math.round(asNumber(mean) * 100) / 100,
      tiedBefore: row ? asNumber(row.tied_before) : 0,
    };
  },

  countCandidates: async (examId: bigint, scope?: BoardScope): Promise<number> =>
    countOf(await countScores(examId, scope)),

  /** The same standing inside one subject's board, ties broken the same way. */
  subjectRankForExam: async (
    examId: bigint,
    subject: string,
    score: number,
    dateOfBirth: string | null
  ): Promise<{ higher: number; candidates: number }> => {
    const [row] = await prisma.$queryRaw<{ candidates: unknown; higher: unknown }[]>`
      SELECT COUNT(*) AS candidates,
             COALESCE(SUM(ss.score > ${score} OR (ss.score = ${score} AND ${elderThan(dateOfBirth)})), 0) AS higher
        FROM ws_ocr_subject_scores ss
        JOIN ws_ocr_scores s    ON s.id = ss.score_id
        LEFT JOIN ws_customer cu ON cu.id = s.customer_id
       WHERE ss.exam_id = ${examId} AND ss.subject = ${subject}
    `;

    return { candidates: row ? asNumber(row.candidates) : 0, higher: row ? asNumber(row.higher) : 0 };
  },

  countSubjectCandidates: async (examId: bigint, subject: string): Promise<number> =>
    countOf(
      await prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*) c FROM ws_ocr_subject_scores WHERE exam_id = ${examId} AND subject = ${subject}
      `
    ),

  /** Replaces a score's subject rows in one go, so a re-score never leaves stale subjects behind. */
  replaceSubjectScores: (scoreId: bigint, examId: bigint, rows: SubjectScoreRow[]) =>
    prisma.$transaction([
      prisma.ocrSubjectScore.deleteMany({ where: { scoreId } }),
      prisma.ocrSubjectScore.createMany({
        data: rows.map((row, position) => ({
          scoreId,
          examId,
          subject: row.subject,
          position,
          correct: row.correct,
          wrong: row.wrong,
          unanswered: row.unanswered,
          score: row.score,
          maxMarks: row.maxMarks,
        })),
      }),
    ]),

  listSubjectScores: (scoreId: bigint) =>
    prisma.ocrSubjectScore.findMany({ where: { scoreId }, orderBy: { position: "asc" } }),

  /**
   * Each shift's spread plus one row (`shift_key` null) for everyone who has a
   * shift — the inputs of the normalization formula.
   */
  shiftStats: async (examId: bigint): Promise<ShiftStatsRow[]> => {
    // Only marked sheets count: a typed-in total is self-reported, and letting it
    // set a shift's scale would let anyone move everyone else's normalized marks.
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      WITH ranked AS (
        SELECT s.shift_key, s.raw_score,
               ROW_NUMBER() OVER (PARTITION BY s.shift_key ORDER BY s.raw_score DESC) AS shift_pos,
               COUNT(*)     OVER (PARTITION BY s.shift_key)                           AS shift_n,
               ROW_NUMBER() OVER (ORDER BY s.raw_score DESC)                          AS all_pos,
               COUNT(*)     OVER ()                                                   AS all_n
          FROM ws_ocr_scores s
          JOIN ws_ocr_submissions sub ON sub.id = s.submission_id
         WHERE s.exam_id = ${examId} AND s.shift_key IS NOT NULL AND sub.entry_mode = ${ENTRY_MODE.SHEET}
      )
      SELECT shift_key, COUNT(*) AS candidates,
             AVG(raw_score) + STDDEV_POP(raw_score) AS mean_plus_sd,
             AVG(CASE WHEN shift_pos <= GREATEST(CEIL(shift_n * ${NORMALIZATION_TOP_SHARE}), ${NORMALIZATION_MIN_TOP_COUNT}) THEN raw_score END) AS top_mean
        FROM ranked GROUP BY shift_key
      UNION ALL
      SELECT NULL, COUNT(*),
             AVG(raw_score) + STDDEV_POP(raw_score),
             AVG(CASE WHEN all_pos <= GREATEST(CEIL(all_n * ${NORMALIZATION_TOP_SHARE}), ${NORMALIZATION_MIN_TOP_COUNT}) THEN raw_score END)
        FROM ranked
    `;

    return rows.map((row) => ({
      shift_key: (row.shift_key as string | null) ?? null,
      candidates: asNumber(row.candidates),
      mean_plus_sd: asNumber(row.mean_plus_sd),
      top_mean: asNumber(row.top_mean),
    }));
  },

  /** The slots people actually sat, read off their scored sheets. */
  listShifts: async (examId: bigint): Promise<{ key: string; candidates: number }[]> => {
    const rows = await prisma.ocrScore.groupBy({
      by: ["shiftKey"],
      where: { examId, shiftKey: { not: null } },
      _count: { _all: true },
      orderBy: { shiftKey: "asc" },
    });

    return rows.map((row) => ({ key: row.shiftKey as string, candidates: row._count._all }));
  },

  /** Subjects that have scores on this paper, in paper order — what a subject filter can offer. */
  listSubjects: async (examId: bigint): Promise<string[]> => {
    const rows = await prisma.ocrSubjectScore.groupBy({
      by: ["subject"],
      where: { examId },
      _min: { position: true },
      orderBy: { _min: { position: "asc" } },
    });

    return rows.map((row) => row.subject);
  },

  /** Another student's non-failed sheet carrying this participant id on this paper. */
  findSheetOwnedByOther: (examId: bigint, rollNumber: string, customerId: number) =>
    prisma.ocrSubmission.findFirst({
      where: {
        examId,
        rollNumber,
        customerId: { not: customerId },
        status: { notIn: [SUBMISSION_STATUS.FAILED, SUBMISSION_STATUS.PROCESSING] },
      },
      select: { id: true },
    }),

  listProcessedSubmissionIds: (examId: bigint) =>
    prisma.ocrSubmission.findMany({
      where: { examId, status: SUBMISSION_STATUS.PROCESSED, entryMode: ENTRY_MODE.SHEET },
      select: { id: true },
      orderBy: { id: "asc" },
    }),

  leaderboardPage: async (
    examId: bigint,
    skip: number,
    take: number,
    scope: BoardScope = {},
    normalization?: ShiftNormalization | null
  ): Promise<LeaderboardRow[]> => {
    if (scope.subject) return rankPredictorRepository.subjectLeaderboardPage(examId, scope.subject, skip, take);

    const mark = boardScore(normalization);
    const dob = Prisma.sql`fc.dob`;
    // Rank and page on the scores alone, then join names for just the page: the
    // board is read on every refresh, and joining customers and submissions for
    // every candidate before keeping twenty was most of its cost. The customer is
    // joined inside too because the order needs their date of birth.
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT r.customer_id, r.raw_score, r.normalized_score, r.total_questions, r.rank_position,
             sub.created_at                AS submitted_at,
             sub.entry_mode                AS entry_mode,
             c.full_name,
             COALESCE(p.show_real_name, 0) AS show_real_name,
             DATE_FORMAT(c.dob, '%Y-%m-%d') AS date_of_birth,
             p.caste_category,
             p.gender
        FROM (
          SELECT s.id, s.customer_id, s.submission_id, s.raw_score,
                 ${normalization?.size ? mark : Prisma.sql`NULL`} AS normalized_score,
                 s.correct + s.wrong + s.unanswered   AS total_questions,
                 RANK() OVER (ORDER BY ${mark} DESC, ${tieOrder(dob)}) AS rank_position,
                 ${mark} AS board_mark,
                 fc.dob AS dob
            FROM ws_ocr_scores s
            ${byProfile(scope) ? Prisma.sql`JOIN` : Prisma.sql`LEFT JOIN`} ws_ocr_profiles fp ON fp.customer_id = s.customer_id
            LEFT JOIN ws_customer fc ON fc.id = s.customer_id
           WHERE s.exam_id = ${examId}
           ${scope.shiftKey ? Prisma.sql`AND s.shift_key = ${scope.shiftKey}` : Prisma.empty}
           ${scope.casteCategory ? Prisma.sql`AND fp.caste_category = ${scope.casteCategory}` : Prisma.empty}
           ${scope.gender ? Prisma.sql`AND fp.gender = ${scope.gender}` : Prisma.empty}
           ${scope.exServiceman ? Prisma.sql`AND fp.is_ex_serviceman = 1` : Prisma.empty}
           ORDER BY ${mark} DESC, ${tieOrder(dob)}, s.id ASC
           LIMIT ${take} OFFSET ${skip}
        ) r
        JOIN ws_ocr_submissions sub ON sub.id = r.submission_id
        LEFT JOIN ws_customer c     ON c.id = r.customer_id
        LEFT JOIN ws_ocr_profiles p ON p.customer_id = r.customer_id
       ORDER BY r.board_mark DESC, ${tieOrder(Prisma.sql`r.dob`)}, r.id ASC
    `;

    return rows.map(toLeaderboardRow);
  },

  /** One subject's board, ranked on the subject score then age. `raw_score` carries that score. */
  subjectLeaderboardPage: async (
    examId: bigint,
    subject: string,
    skip: number,
    take: number
  ): Promise<LeaderboardRow[]> => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT s.customer_id,
             ss.score AS raw_score,
             NULL     AS normalized_score,
             ss.correct + ss.wrong + ss.unanswered AS total_questions,
             RANK() OVER (ORDER BY ss.score DESC, ${tieOrder(Prisma.sql`c.dob`)}) AS rank_position,
             ss.max_marks                  AS max_marks,
             sub.created_at                AS submitted_at,
             sub.entry_mode                AS entry_mode,
             c.full_name,
             COALESCE(p.show_real_name, 0) AS show_real_name,
             DATE_FORMAT(c.dob, '%Y-%m-%d') AS date_of_birth,
             p.caste_category,
             p.gender
        FROM ws_ocr_subject_scores ss
        JOIN ws_ocr_scores s        ON s.id = ss.score_id
        JOIN ws_ocr_submissions sub ON sub.id = s.submission_id
        LEFT JOIN ws_customer c     ON c.id = s.customer_id
        LEFT JOIN ws_ocr_profiles p ON p.customer_id = s.customer_id
       WHERE ss.exam_id = ${examId} AND ss.subject = ${subject}
       ORDER BY ss.score DESC, ${tieOrder(Prisma.sql`c.dob`)}, s.id ASC
       LIMIT ${take} OFFSET ${skip}
    `;

    return rows.map(toLeaderboardRow);
  },

  findCustomersByIds: (ids: number[]) =>
    ids.length === 0
      ? Promise.resolve([])
      : prisma.customer.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, phoneNumber: true, emailAddress: true },
        }),

  findProfile: (customerId: number) => prisma.ocrProfile.findUnique({ where: { customerId } }),

  /** The rank profile with the customer's own date of birth (`ws_customer.dob`) beside it. */
  findCandidateProfile: async (customerId: number) => {
    const [profile, customer] = await Promise.all([
      prisma.ocrProfile.findUnique({ where: { customerId } }),
      prisma.customer.findUnique({ where: { id: customerId }, select: { birthDate: true } }),
    ]);
    return {
      casteCategory: profile?.casteCategory ?? null,
      gender: profile?.gender ?? null,
      isExServiceman: profile?.isExServiceman ?? null,
      dateOfBirth: customer?.birthDate ?? null,
    };
  },

  upsertProfile: (customerId: number, showRealName: boolean) =>
    prisma.ocrProfile.upsert({
      where: { customerId },
      create: { customerId, showRealName, createdAt: new Date(), updatedAt: new Date() },
      update: { showRealName, updatedAt: new Date() },
    }),

  upsertCandidateProfile: (
    customerId: number,
    { dateOfBirth, ...data }: { casteCategory: string; gender: string; isExServiceman: boolean; dateOfBirth: Date }
  ) =>
    // The date of birth is the customer's own, so the account profile shows the same one.
    prisma
      .$transaction([
        prisma.customer.update({
          where: { id: customerId },
          data: { birthDate: dateOfBirth },
          select: { birthDate: true },
        }),
        prisma.ocrProfile.upsert({
          where: { customerId },
          create: { customerId, ...data, createdAt: new Date(), updatedAt: new Date() },
          update: { ...data, updatedAt: new Date() },
        }),
      ])
      .then(([customer, profile]) => ({ ...profile, dateOfBirth: customer.birthDate })),

  deleteProfile: (customerId: number) => prisma.ocrProfile.deleteMany({ where: { customerId } }),

  writeAuditLog: (data: Prisma.OcrAuditLogCreateInput) => prisma.ocrAuditLog.create({ data }),

  upsertRankSnapshot: (
    scoreId: bigint,
    examId: bigint,
    rankPosition: number,
    totalCandidates: number,
    percentile: number
  ) =>
    prisma.ocrRank.upsert({
      where: { scoreId },
      create: {
        scoreId,
        examId,
        rankPosition,
        totalCandidates,
        percentile,
        computedAt: new Date(),
      },
      update: { rankPosition, totalCandidates, percentile, computedAt: new Date() },
    }),
};
