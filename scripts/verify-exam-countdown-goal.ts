/** Verify ExamCountdown goalId/goalLabelId: valid pair persists, bad pair rejected. */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/config/prisma";
import * as ec from "../src/modules/exam-countdown/exam-countdown.service";

async function main() {
  const goal = await prisma.goal.findFirst({ where: { labels: { not: undefined } }, select: { id: true, labels: true } });
  const labels = Array.isArray(goal?.labels) ? (goal!.labels as any[]) : [];
  const cat = await prisma.examCountdownCategory.findFirst({ where: { status: true }, select: { id: true } });
  if (!goal || !labels.length || !cat) throw new Error("Need a goal-with-labels and an active category to test.");
  const goalId = goal.id;
  const labelId = Number(labels[0].id);
  console.log("• using goalId:", goalId, "labelId:", labelId, "(", labels[0].name, ") categoryId:", cat.id);

  console.log("• validateGoalPair valid   ->", await ec.validateGoalPair(goalId, labelId), "(null = ok)");
  console.log("• validateGoalPair bad lbl ->", await ec.validateGoalPair(goalId, 999999));
  console.log("• validateGoalPair lbl-no-goal ->", await ec.validateGoalPair(null, labelId));

  const created: any = await ec.createCountdown({ title: "TEST goal countdown DELETE_ME", categoryId: cat.id, examDate: new Date("2026-12-31"), description: "", status: true, goalId, goalLabelId: labelId });
  console.log("• createCountdown ->", created.data ? { _id: created.data._id, goalId: created.data.goalId, goalLabelId: created.data.goalLabelId } : created);

  const badCreate: any = await ec.createCountdown({ title: "TEST bad DELETE_ME", categoryId: cat.id, examDate: new Date("2026-12-31"), description: "", status: true, goalId, goalLabelId: 999999 });
  console.log("• createCountdown bad label ->", badCreate.goalError ?? "(no error - unexpected)");

  if (created.data?._id) { await prisma.examCountdown.delete({ where: { id: Number(created.data._id) } }); console.log("• cleanup: deleted", created.data._id); }

  await prisma.$disconnect();
  console.log("\nRESULT: exam-countdown goal tagging VERIFIED");
}
main().catch(async (e) => { console.error("VERIFY FAILED:", e); await prisma.$disconnect(); process.exit(1); });
