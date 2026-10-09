/**
 * Rank predictor — file every read response sheet in the organised Spaces folders:
 *
 *   uploads/rank-sheets/{exam code}/{shift}/{category}/{gender}/{roll}_{submissionId}.pdf
 *
 * New sheets are filed by the worker as they are read and re-filed when a student
 * changes their category or gender. This backfills sheets read before that, and
 * repairs any copy the worker missed (a failed copy only logs a warning).
 *
 * Usage:
 *   npx tsx scripts/sync-rank-sheet-folders.ts                  # dry run — report only
 *   npx tsx scripts/sync-rank-sheet-folders.ts --apply          # copy missing sheets
 *   npx tsx scripts/sync-rank-sheet-folders.ts --apply --prune  # also delete stale copies
 *   npx tsx scripts/sync-rank-sheet-folders.ts --apply --limit=5
 *
 * The source sheet under customer/rank-sheets/ is never touched: every organised
 * file is a server-side copy of it. --prune deletes only keys under uploads/rank-sheets/
 * that no current sheet maps to (a changed exam code, a deleted submission).
 * Idempotent: a copy already in place is skipped.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PRUNE = args.includes("--prune");
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || Infinity;
const CONCURRENCY = 8;

const main = async (): Promise<void> => {
  // Imported after dotenv so the S3 client and Prisma see the env.
  const { prisma } = await import("../src/config/prisma");
  const { rankPredictorRepository: repo } = await import(
    "../src/modules/rank-predictor/rank-predictor.repository"
  );
  const { casteCategoryOf, genderOf } = await import(
    "../src/modules/rank-predictor/rank-predictor.transformer"
  );
  const { copyRankPdf, deleteRankPdfKeys, listRankPdfKeys, organisedRankSheetKey } = await import(
    "../src/utils/rankSheetStorage"
  );
  const { UPLOAD_FOLDERS } = await import("../src/config/uploadFolders");
  const { default: logger } = await import("../src/utils/logger");

  const sheets = await repo.listReadSheets();
  const profiles = await repo.findProfilesFor([...new Set(sheets.map((sheet) => sheet.customerId))]);
  const profileOf = new Map(profiles.map((profile) => [profile.customerId, profile]));

  const wanted = new Map<string, string>();
  for (const sheet of sheets) {
    const profile = profileOf.get(sheet.customerId) ?? null;
    const key = organisedRankSheetKey({
      examCode: sheet.exam.code,
      shiftKey: sheet.shiftKey,
      casteCategory: casteCategoryOf(profile),
      gender: genderOf(profile),
      rollNumber: sheet.rollNumber,
      submissionId: String(sheet.id),
    });
    wanted.set(key, sheet.sourcePdfKey as string);
  }

  const existing = new Set(await listRankPdfKeys(`${UPLOAD_FOLDERS.rankSheets}/`));
  const missing = [...wanted].filter(([key]) => !existing.has(key)).slice(0, LIMIT);
  const stale = [...existing].filter((key) => !wanted.has(key));

  logger.info(`Read sheets: ${sheets.length}`);
  logger.info(`Already filed: ${wanted.size - [...wanted.keys()].filter((k) => !existing.has(k)).length}`);
  logger.info(`To copy: ${missing.length}${LIMIT < Infinity ? ` (limited to ${LIMIT})` : ""}`);
  logger.info(`Stale copies: ${stale.length}${PRUNE ? "" : " (kept; pass --prune to delete)"}`);

  if (!APPLY) {
    for (const [key, source] of missing.slice(0, 20)) logger.info(`  would copy ${source} -> ${key}`);
    for (const key of stale.slice(0, 20)) logger.info(`  stale ${key}`);
    logger.info("Dry run. Pass --apply to copy.");
    await prisma.$disconnect();
    return;
  }

  let copied = 0;
  const failed: { key: string; error: string }[] = [];
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async ([key, source]) => {
        try {
          await copyRankPdf(source, key);
          copied += 1;
        } catch (error) {
          failed.push({ key, error: (error as Error).message });
        }
      })
    );
    logger.info(`  ${Math.min(i + CONCURRENCY, missing.length)}/${missing.length}`);
  }

  if (PRUNE && stale.length) await deleteRankPdfKeys(stale);

  logger.info(`Copied: ${copied}. Failed: ${failed.length}. Pruned: ${PRUNE ? stale.length : 0}.`);
  for (const failure of failed) logger.error(`  failed ${failure.key}: ${failure.error}`);

  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
};

main().catch(async (error) => {
  const { default: logger } = await import("../src/utils/logger");
  logger.error("Rank sheet folder sync failed", { error: (error as Error).message, stack: (error as Error).stack });
  process.exit(1);
});
