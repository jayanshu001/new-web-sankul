/**
 * Seeder — one fully-populated EXAMPLE rank-predictor paper ("CCE") so the
 * standing card (overall / shift / category / gender / subject) has data to show.
 *
 * Uses the existing customers of whatever DATABASE_URL points at as candidates
 * and fills a rank profile (category + gender) only where one is missing. Scores
 * go through the same resolveSubjects / scoreWithSubjects the live flow uses.
 *
 * Idempotent: if the paper exists it stops. `--reset` deletes it (scores first, then the exam
 * cascades submissions and answer keys) and re-seeds.
 *
 * Usage:  npx tsx scripts/seed-rank-example.ts [--reset]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { percentileFor } from "../src/modules/rank-predictor/rank-predictor.scoring";
import { resolveSubjects, scoreWithSubjects } from "../src/modules/rank-predictor/rank-predictor.subjects";
import type { SyllabusSubject } from "../src/modules/rank-predictor/rank-predictor.types";

const prisma = new PrismaClient();

const CODE = "cce-prelims-2026-example";
const TOTAL = 200;
const SCHEME = { marksCorrect: 1, marksWrong: 0.25 };
const SHIFTS = ["2026-10-04T09:00", "2026-10-04T12:30", "2026-10-04T16:00"];
/** The afternoon paper is set harder, so normalization has something to correct. */
const SHIFT_DIFFICULTY = [0, -0.12, 0.05];
const CATEGORIES = ["open", "sebc", "ews", "sc", "st"];
const GENDERS = ["male", "female"];

const SYLLABUS: SyllabusSubject[] = [
  { name: "History & Culture", marks: 50, from_question: 1, to_question: 50 },
  { name: "Polity & Economy", marks: 50, from_question: 51, to_question: 100 },
  { name: "Geography & Science", marks: 50, from_question: 101, to_question: 150 },
  { name: "Current Affairs", marks: 50, from_question: 151, to_question: 200 },
];

/** Deterministic, so a re-seed gives the same paper. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

async function main(): Promise<void> {
  const existing = await prisma.ocrExam.findUnique({ where: { code: CODE } });
  if (existing && !process.argv.includes("--reset")) {
    console.log(`"${CODE}" already exists (id ${existing.id}); pass --reset to re-seed.`);
    return;
  }
  if (existing) {
    // Scores point at the answer key with NO ACTION, so they go before the exam's cascade.
    await prisma.ocrScore.deleteMany({ where: { examId: existing.id } });
    await prisma.ocrExam.delete({ where: { id: existing.id } });
  }

  const now = new Date();
  const exam = await prisma.ocrExam.create({
    data: {
      code: CODE,
      name: "GPSC CCE Prelims 2026 (Example)",
      totalQuestions: TOTAL,
      category: "GPSC",
      examDate: new Date("2026-10-04"),
      keySource: "admin_key",
      marksCorrect: SCHEME.marksCorrect,
      marksWrong: SCHEME.marksWrong,
      syllabus: SYLLABUS as never,
      rankBy: ["shift", "category", "subject", "normalized"] as never,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const rand = prng(2026);
  const keys: Record<string, number> = {};
  for (let q = 1; q <= TOTAL; q++) keys[String(q)] = 1 + Math.floor(rand() * 4);
  const answerKey = await prisma.ocrAnswerKey.create({
    data: {
      examId: exam.id,
      version: 1,
      keys: keys as never,
      marksCorrect: SCHEME.marksCorrect,
      marksWrong: SCHEME.marksWrong,
      createdAt: now,
    },
  });

  const customers = await prisma.customer.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const profiles = new Map((await prisma.ocrProfile.findMany()).map((p) => [p.customerId, p]));
  const subjects = resolveSubjects(SYLLABUS, Object.keys(keys), {});

  const scored: { scoreId: bigint; rawScore: number }[] = [];
  for (const [index, { id: customerId }] of customers.entries()) {
    if (!profiles.get(customerId)?.casteCategory || !profiles.get(customerId)?.gender) {
      const data = {
        casteCategory: CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
        gender: GENDERS[Math.floor(rand() * GENDERS.length)],
        isExServiceman: false,
      };
      await prisma.ocrProfile.upsert({
        where: { customerId },
        create: { customerId, showRealName: false, ...data, createdAt: now, updatedAt: now },
        update: { ...data, updatedAt: now },
      });
    }

    // Each candidate has their own strength, so the board spreads out.
    const shiftIndex = index % SHIFTS.length;
    const skill = Math.max(0.05, 0.25 + rand() * 0.6 + SHIFT_DIFFICULTY[shiftIndex]);
    const answers: Record<string, number> = {};
    for (let q = 1; q <= TOTAL; q++) {
      const roll = rand();
      if (roll < 0.08) continue; // left blank
      answers[String(q)] = roll < 0.08 + skill * 0.92 ? keys[String(q)] : 1 + Math.floor(rand() * 4);
    }

    const shiftKey = SHIFTS[shiftIndex];
    const result = scoreWithSubjects(answers, keys, SCHEME, subjects);

    const submission = await prisma.ocrSubmission.create({
      data: {
        examId: exam.id,
        customerId,
        extractionKind: "text_layer",
        rawAnswers: answers as never,
        shiftKey,
        entryMode: "sheet",
        status: "processed",
        createdAt: now,
        updatedAt: now,
      },
    });
    const score = await prisma.ocrScore.create({
      data: {
        submissionId: submission.id,
        examId: exam.id,
        customerId,
        answerKeyId: answerKey.id,
        shiftKey,
        correct: result.correct,
        wrong: result.wrong,
        unanswered: result.unanswered,
        rawScore: result.rawScore,
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.ocrSubjectScore.createMany({
      data: result.subjects.map((row, position) => ({
        scoreId: score.id,
        examId: exam.id,
        subject: row.subject,
        position,
        correct: row.correct,
        wrong: row.wrong,
        unanswered: row.unanswered,
        score: row.score,
        maxMarks: row.maxMarks,
      })),
    });
    scored.push({ scoreId: score.id, rawScore: result.rawScore });
  }

  // Snapshot on raw marks; the live standing reads normalized marks.
  for (const { scoreId, rawScore } of scored) {
    const rank = scored.filter((other) => other.rawScore > rawScore).length + 1;
    await prisma.ocrRank.create({
      data: {
        scoreId,
        examId: exam.id,
        rankPosition: rank,
        totalCandidates: scored.length,
        percentile: percentileFor(rank, scored.length),
        computedAt: now,
      },
    });
  }

  console.log(`Seeded "${CODE}" (id ${exam.id}): ${scored.length} candidates, ${SHIFTS.length} shifts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
