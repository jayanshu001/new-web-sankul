import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { SUBMISSION_STATUS, type LeaderboardRow } from "./rank-predictor.types";

type CountRow = { c: unknown };

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const countOf = (rows: CountRow[] | undefined): number => asNumber(rows?.[0]?.c);

const countScores = (examId: bigint) =>
  prisma.$queryRaw<CountRow[]>`SELECT COUNT(*) c FROM ws_ocr_scores WHERE exam_id = ${examId}`;

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
      where: { examId, series, status: SUBMISSION_STATUS.PROCESSED },
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

  rankForExam: async (
    examId: bigint,
    rawScore: number
  ): Promise<{ higher: number; candidates: number }> => {
    const [candidates, higher] = await Promise.all([
      countScores(examId),
      prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*) c FROM ws_ocr_scores WHERE exam_id = ${examId} AND raw_score > ${rawScore}
      `,
    ]);

    return { candidates: countOf(candidates), higher: countOf(higher) };
  },

  countCandidates: async (examId: bigint): Promise<number> => countOf(await countScores(examId)),

  /**
   * The same standing, counted only among candidates who answered the same
   * caste category. The join is deliberately inner: a candidate who has not
   * answered the profile gate has no category to be ranked within, so they sit
   * in neither the numerator nor the denominator here. They still count
   * towards the global rank, which is why the two totals differ.
   */
  categoryRankForExam: async (
    examId: bigint,
    rawScore: number,
    casteCategory: string
  ): Promise<{ higher: number; candidates: number }> => {
    const [candidates, higher] = await Promise.all([
      prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*) c
          FROM ws_ocr_scores s
          JOIN ws_ocr_profiles p ON p.customer_id = s.customer_id
         WHERE s.exam_id = ${examId} AND p.caste_category = ${casteCategory}
      `,
      prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*) c
          FROM ws_ocr_scores s
          JOIN ws_ocr_profiles p ON p.customer_id = s.customer_id
         WHERE s.exam_id = ${examId}
           AND p.caste_category = ${casteCategory}
           AND s.raw_score > ${rawScore}
      `,
    ]);

    return { candidates: countOf(candidates), higher: countOf(higher) };
  },

  leaderboardPage: async (
    examId: bigint,
    skip: number,
    take: number
  ): Promise<LeaderboardRow[]> => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT s.customer_id,
             s.raw_score,
             RANK() OVER (ORDER BY s.raw_score DESC) AS rank_position,
             sub.created_at                AS submitted_at,
             c.full_name,
             COALESCE(p.show_real_name, 0) AS show_real_name
        FROM ws_ocr_scores s
        JOIN ws_ocr_submissions sub ON sub.id = s.submission_id
        LEFT JOIN ws_customer c     ON c.id = s.customer_id
        LEFT JOIN ws_ocr_profiles p ON p.customer_id = s.customer_id
       WHERE s.exam_id = ${examId}
       ORDER BY s.raw_score DESC, s.id ASC
       LIMIT ${take} OFFSET ${skip}
    `;

    return rows.map((row) => ({
      customer_id: asNumber(row.customer_id),
      raw_score: asNumber(row.raw_score),
      rank_position: asNumber(row.rank_position),
      submitted_at: (row.submitted_at as Date | null) ?? null,
      full_name: (row.full_name as string | null) ?? null,
      show_real_name: Boolean(asNumber(row.show_real_name)),
    }));
  },

  findCustomersByIds: (ids: number[]) =>
    ids.length === 0
      ? Promise.resolve([])
      : prisma.customer.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, phoneNumber: true, emailAddress: true },
        }),

  findProfile: (customerId: number) => prisma.ocrProfile.findUnique({ where: { customerId } }),

  upsertProfile: (customerId: number, showRealName: boolean) =>
    prisma.ocrProfile.upsert({
      where: { customerId },
      create: { customerId, showRealName, createdAt: new Date(), updatedAt: new Date() },
      update: { showRealName, updatedAt: new Date() },
    }),

  upsertCandidateProfile: (
    customerId: number,
    data: { casteCategory: string; gender: string; isExServiceman: boolean }
  ) =>
    prisma.ocrProfile.upsert({
      where: { customerId },
      create: { customerId, ...data, createdAt: new Date(), updatedAt: new Date() },
      update: { ...data, updatedAt: new Date() },
    }),

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
