/**
 * One-shot backfill: populate Package.goalId for legacy packages that have
 * goalLabelId set but goalId missing. Resolves the parent goal by scanning
 * Goal.labels[] for a matching label _id.
 *
 * Usage (from repo root):
 *   npx ts-node scripts/backfill-package-goal-id.ts
 *
 * Idempotent. Safe to re-run. Logs counts at the end.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { Package } from "../src/models/course/Package.model";
import { Goal } from "../src/models/Goal.model";

async function main() {
  await connectDB();

  const candidates = await Package.find({
    goalLabelId: { $ne: null },
    $or: [{ goalId: null }, { goalId: { $exists: false } }],
  }).select("_id goalLabelId");

  console.log(`Found ${candidates.length} package(s) needing backfill.`);

  if (candidates.length === 0) {
    await mongoose.disconnect();
    return;
  }

  // Build a single lookup: labelId -> goalId.
  const goals = await Goal.find({}).select("_id labels._id").lean();
  const labelToGoal = new Map<string, mongoose.Types.ObjectId>();
  for (const g of goals as any[]) {
    for (const l of g.labels ?? []) {
      if (l._id) labelToGoal.set(l._id.toString(), g._id);
    }
  }

  let updated = 0;
  let orphaned = 0;
  const orphans: string[] = [];

  for (const pkg of candidates) {
    const labelId = pkg.goalLabelId?.toString();
    if (!labelId) continue;
    const goalId = labelToGoal.get(labelId);
    if (!goalId) {
      orphaned += 1;
      orphans.push(`${pkg._id} (label ${labelId})`);
      continue;
    }
    await Package.updateOne({ _id: pkg._id }, { $set: { goalId } });
    updated += 1;
  }

  console.log(`Backfill complete. Updated: ${updated}. Orphaned (label not found in any goal): ${orphaned}.`);
  if (orphans.length) {
    console.log("Orphans:");
    for (const o of orphans) console.log(`  - ${o}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
