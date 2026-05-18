/**
 * One-shot migration: backfill `PromoCode.appliesTo` from the legacy
 * `PromotedPackageCourseEbook` link table.
 *
 * Doc: docs/Promocodes — "Applies To" Backend Change §6.
 *
 * Usage (with the app's Mongo connection already open):
 *
 *     import { runPromocodeAppliesToMigration } from "./migrations/2026-promocode-applies-to";
 *     await runPromocodeAppliesToMigration();
 *
 * Or directly:
 *
 *     npx ts-node -T src/migrations/2026-promocode-applies-to.ts
 *
 * Safe to run multiple times — a promocode that already has `appliesTo` set is skipped.
 */

import mongoose from "mongoose";
import { PromoCode } from "../models/course/PromoCode.model";
import { PromotedPackageCourseEbook } from "../models/course/PromotedPackageCourseEbook.model";
import { PackageCourseEbookPrice } from "../models/course/PackageCourseEbookPrice.model";

type Kind = "package" | "course" | "ebook";
type AppliesToKind = "package" | "course" | "liveCourse";

interface PerPromoStats {
  promocodeId: string;
  promocode?: string;
  majority?: AppliesToKind;
  idsCount: number;
  ebookOnly: boolean;
  ambiguous: boolean;
  disabled?: boolean;
  skipped?: "already-set" | "no-parents";
}

const KIND_TO_APPLIES_TO: Record<Kind, AppliesToKind | null> = {
  package: "package",
  course: "course",
  ebook: null, // ebooks are not part of the new enum
};

function pickMajority(
  counts: Record<AppliesToKind, number>
): { winner: AppliesToKind | null; ambiguous: boolean } {
  const entries = (Object.entries(counts) as [AppliesToKind, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { winner: null, ambiguous: false };
  if (entries.length === 1) return { winner: entries[0][0], ambiguous: false };
  return { winner: entries[0][0], ambiguous: entries[0][1] === entries[1][1] };
}

export async function runPromocodeAppliesToMigration(opts?: {
  /** If true, log decisions but don't write. */
  dryRun?: boolean;
  /** What to do with ebook-only promocodes. Doc §6 option (b) = disable. */
  ebookOnlyAction?: "disable" | "skip" | "keep-disabled-status";
}): Promise<{
  total: number;
  migrated: number;
  ambiguous: number;
  ebookOnlyDisabled: number;
  skippedAlreadySet: number;
  skippedNoParents: number;
  details: PerPromoStats[];
}> {
  const dryRun = !!opts?.dryRun;
  const ebookAction = opts?.ebookOnlyAction ?? "disable";

  const promos = await PromoCode.find({}).select("_id promocode appliesTo status").lean();
  const stats: PerPromoStats[] = [];
  let migrated = 0;
  let ambiguousCount = 0;
  let ebookOnlyDisabled = 0;
  let skippedAlreadySet = 0;
  let skippedNoParents = 0;

  for (const promo of promos) {
    const id = String(promo._id);
    if (promo.appliesTo && (promo.appliesTo as any).ids?.length) {
      stats.push({
        promocodeId: id,
        promocode: promo.promocode,
        idsCount: (promo.appliesTo as any).ids.length,
        ebookOnly: false,
        ambiguous: false,
        skipped: "already-set",
      });
      skippedAlreadySet++;
      continue;
    }

    const links = await PromotedPackageCourseEbook.find({ promocodeId: id })
      .select("planId")
      .lean();
    const planIds = links.map((l) => l.planId).filter(Boolean);
    if (!planIds.length) {
      stats.push({
        promocodeId: id,
        promocode: promo.promocode,
        idsCount: 0,
        ebookOnly: false,
        ambiguous: false,
        skipped: "no-parents",
      });
      skippedNoParents++;
      continue;
    }

    const plans = await PackageCourseEbookPrice.find({ _id: { $in: planIds } })
      .select("packageId courseId ebookId")
      .lean();

    // Group plan parents by kind.
    const parents: Record<Kind, Set<string>> = {
      package: new Set(),
      course: new Set(),
      ebook: new Set(),
    };
    for (const plan of plans) {
      if (plan.packageId) parents.package.add(String(plan.packageId));
      else if (plan.courseId) parents.course.add(String(plan.courseId));
      else if (plan.ebookId) parents.ebook.add(String(plan.ebookId));
    }

    const counts: Record<AppliesToKind, number> = {
      package: parents.package.size,
      course: parents.course.size,
      liveCourse: 0, // legacy data never linked live courses
    };

    const ebookOnly =
      parents.ebook.size > 0 && parents.package.size === 0 && parents.course.size === 0;

    if (ebookOnly) {
      // Doc §6 ebook edge case — option (b): disable these so marketing recreates
      // them under the new model (or option (a) extends the enum later).
      const disabled = ebookAction === "disable";
      if (disabled && !dryRun) {
        await PromoCode.updateOne({ _id: id }, { $set: { status: false } });
      }
      stats.push({
        promocodeId: id,
        promocode: promo.promocode,
        idsCount: 0,
        ebookOnly: true,
        ambiguous: false,
        disabled,
      });
      if (disabled) ebookOnlyDisabled++;
      continue;
    }

    const { winner, ambiguous } = pickMajority(counts);
    if (!winner) {
      // Plans existed but every parent was filtered out — treat as orphan.
      stats.push({
        promocodeId: id,
        promocode: promo.promocode,
        idsCount: 0,
        ebookOnly: false,
        ambiguous: false,
        skipped: "no-parents",
      });
      skippedNoParents++;
      continue;
    }

    const ids = Array.from(parents[winner === "liveCourse" ? "course" : winner]);
    // (winner is always 'package' or 'course' for legacy data.)

    if (!dryRun) {
      await PromoCode.updateOne(
        { _id: id },
        { $set: { appliesTo: { type: winner, ids } } }
      );
    }

    stats.push({
      promocodeId: id,
      promocode: promo.promocode,
      majority: winner,
      idsCount: ids.length,
      ebookOnly: false,
      ambiguous,
    });
    if (ambiguous) ambiguousCount++;
    migrated++;
  }

  return {
    total: promos.length,
    migrated,
    ambiguous: ambiguousCount,
    ebookOnlyDisabled,
    skippedAlreadySet,
    skippedNoParents,
    details: stats,
  };
}

// Allow direct execution via `ts-node src/migrations/...`.
if (require.main === module) {
  (async () => {
    const uri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!uri) {
      console.error("Set MONGO_URI or DATABASE_URL to run this migration.");
      process.exit(1);
    }
    await mongoose.connect(uri);
    const dryRun = process.argv.includes("--dry-run");
    console.log(`Running promocode appliesTo migration (dryRun=${dryRun})`);
    const result = await runPromocodeAppliesToMigration({ dryRun });
    console.log(JSON.stringify(result, null, 2));
    await mongoose.disconnect();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
