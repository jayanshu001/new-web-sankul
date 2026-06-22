/*
 * Backfill the Mongo-only Package fields onto ws_package (catalog-package):
 *   goal_id, goal_label_id, is_paid, is_smart_course, is_planner_course.
 *
 * Package matched Mongo<->SQL by NATURAL KEY (name) — no stored id map.
 *   goal_id        ← Mongo Package.goalId (ObjectId) -> Goal.title -> ws_goal.id
 *   goal_label_id  ← Mongo Package.goalLabelId (ObjectId) -> the label's NAME in
 *                    its Goal.labels[] -> the SQL goal's synthetic per-name label
 *                    id (mirrors goal.service.withLabelIds: ids assigned by name,
 *                    1-based, in stored order). Resolves to NULL where ws_goal has
 *                    no labels (sparse staging) — never guessed.
 *   is_paid / is_smart_course / is_planner_course ← direct boolean copy.
 *
 * Idempotent: pure UPDATEs by package id; safe to re-run.
 *
 * Run: DATABASE_URL=... MONGODB_URI=... npx tsx scripts/backfill-catalog-package-fields.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { Package } from "../src/models/course/Package.model";
import { Goal } from "../src/models/Goal.model";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  // SQL package natural-key map (name -> id), goal map (title -> id + labels json).
  const sqlPkgByName = new Map(
    (await prisma.package.findMany({ select: { id: true, name: true } }))
      .filter((p) => p.name)
      .map((p) => [p.name.trim(), p.id])
  );
  const sqlGoals = await prisma.goal.findMany({ select: { id: true, title: true, labels: true } });
  const sqlGoalByTitle = new Map(sqlGoals.filter((g) => g.title).map((g) => [g.title.trim(), g]));

  // For a SQL goal, replicate goal.service.withLabelIds: name -> synthetic id.
  const labelIdByName = (g: any): Map<string, number> => {
    const out = new Map<string, number>();
    const labels = Array.isArray(g?.labels) ? g.labels : [];
    let next = 1;
    for (const l of labels) {
      const id = Number.isInteger(l?.id) ? l.id : next;
      out.set(String(l?.name ?? "").trim(), id);
      next = Math.max(next, id) + 1;
    }
    return out;
  };

  const mongoPkgs: any[] = await Package.find({}).lean();
  let updated = 0, skippedNoSqlPkg = 0, goalResolved = 0, goalLabelResolved = 0;

  for (const m of mongoPkgs) {
    const sqlId = m.name ? sqlPkgByName.get(String(m.name).trim()) : undefined;
    if (!sqlId) { skippedNoSqlPkg++; continue; }

    // goalId -> ws_goal.id (via title)
    let goalId: number | null = null;
    let labelsByName: Map<string, number> | null = null;
    if (m.goalId) {
      const mg: any = await Goal.findById(m.goalId).select("title labels").lean();
      const sg = mg?.title ? sqlGoalByTitle.get(String(mg.title).trim()) : undefined;
      if (sg) { goalId = sg.id; goalResolved++; labelsByName = labelIdByName(sg); }

      // goalLabelId (ObjectId into mg.labels[]) -> label name -> SQL synthetic id
      if (m.goalLabelId && mg?.labels && labelsByName) {
        const lbl = (mg.labels as any[]).find((l) => String(l._id) === String(m.goalLabelId));
        const sid = lbl?.name ? labelsByName.get(String(lbl.name).trim()) : undefined;
        if (sid != null) {
          await prisma.package.update({ where: { id: sqlId }, data: { goalLabelId: sid } });
          goalLabelResolved++;
        }
      }
    }

    await prisma.package.update({
      where: { id: sqlId },
      data: {
        goalId,
        isPaid: m.isPaid ?? true,
        isSmartCourse: m.isSmartCourse ?? false,
        isPlannerCourse: m.isPlannerCourse ?? false,
      },
    });
    updated++;
  }

  console.log(
    `catalog-package fields: updated=${updated} skippedNoSqlPkg=${skippedNoSqlPkg} ` +
      `goalIdResolved=${goalResolved} goalLabelResolved=${goalLabelResolved} (mongo total ${mongoPkgs.length})`
  );

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
