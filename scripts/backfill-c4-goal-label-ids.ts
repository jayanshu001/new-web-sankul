/*
 * Backfill goal LABEL ids (C4) — two idempotent passes:
 *
 *  A) Assign stable numeric ids to existing `ws_goal.labels` JSON that lack them
 *     (the client goal-selection feature stores selected LABEL ids). SQL-only,
 *     deterministic, safe to re-run (goals whose labels already have ids skip).
 *
 *  B) Remap each `ws_customer.goal` selection from Mongo label ObjectIds → the
 *     new SQL label ids, joined by (goal title + label name). 24-hex entries are
 *     remapped; unmappable ones are dropped; already-numeric ids are left as-is.
 *     Best-effort (datasets disjoint in staging). Run AFTER pass A.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-c4-goal-label-ids.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { Goal } from "../src/models/Goal.model";

dotenv.config();

const arr = (j: any): any[] => (Array.isArray(j) ? j : []);

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  // ── Pass A: assign label ids in ws_goal.labels ──
  const goals = await prisma.goal.findMany({ select: { id: true, title: true, labels: true } });
  let aUpd = 0;
  for (const g of goals) {
    const labels = arr(g.labels);
    if (!labels.length || labels.every((l) => l && l.id != null)) continue;
    let next = Math.max(0, ...labels.map((l) => Number(l?.id) || 0)) + 1;
    const withIds = labels.map((l) => ({ id: l?.id != null ? Number(l.id) : next++, name: l.name }));
    await prisma.goal.update({ where: { id: g.id }, data: { labels: withIds as any } });
    aUpd++;
  }
  console.log(`A) goal label ids assigned: ${aUpd}/${goals.length} goals`);

  // ── Pass B: remap ws_customer.goal selections ──
  // Mongo label _id → (goal title, label name)
  const mongoGoals: any[] = await Goal.find({}).lean();
  const mongoLabel = new Map<string, { title: string; name: string }>();
  for (const mg of mongoGoals) for (const lb of mg.labels ?? []) mongoLabel.set(String(lb._id), { title: mg.title, name: lb.name });

  // SQL (title|name) → label id  (re-read after pass A)
  const sqlGoals = await prisma.goal.findMany({ select: { title: true, labels: true } });
  const sqlLabelId = new Map<string, number>();
  for (const sg of sqlGoals) for (const lb of arr(sg.labels)) if (lb?.id != null) sqlLabelId.set(`${sg.title}|${lb.name}`, Number(lb.id));

  // Candidates: customers whose `goal` is a non-empty JSON array. (Filtered in JS
  // — a one-time script; for very large tables, page this query.)
  const customers = await prisma.customer.findMany({
    where: { NOT: { goal: { equals: Prisma.JsonNull } } },
    select: { id: true, goal: true },
  });
  let bUpd = 0;
  for (const c of customers) {
    const sel = arr(c.goal);
    if (!sel.length) continue;
    let changed = false;
    const remapped: any[] = [];
    for (const s of sel) {
      const str = String(s);
      if (/^[0-9a-fA-F]{24}$/.test(str)) {
        const ml = mongoLabel.get(str);
        const sqlId = ml ? sqlLabelId.get(`${ml.title}|${ml.name}`) : undefined;
        if (sqlId != null) remapped.push(sqlId);
        changed = true; // 24-hex always rewritten (mapped or dropped)
      } else {
        remapped.push(s); // already a SQL id
      }
    }
    if (changed) { await prisma.customer.update({ where: { id: c.id }, data: { goal: remapped as any } }); bUpd++; }
  }
  console.log(`B) customer goal selections remapped: ${bUpd}/${customers.length} customers`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
