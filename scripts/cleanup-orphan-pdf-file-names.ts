/**
 * One-off cleanup: reset PDF slots whose URL is empty but whose companion
 * columns still describe an attached file.
 *
 * Before 2026-07-27, clearing an ebook's Demo/Book PDF nulled only the URL and
 * left behind:
 *   • demo_file_name / book_file_name        → edit modal showed an orphan name
 *   • demo_upload_status / book_upload_status (+ _progress) → any consumer
 *     trusting the status believed a PDF was still attached
 * The write path is fixed (admin-ebook.service resets the whole slot in one
 * write); this cleans up rows that already drifted.
 *
 * ws_book gets the name treatment for its single demo slot — admin-book.service
 * has always cleared correctly, but older rows may predate it. ws_book has no
 * upload-status columns (its PDF isn't handled by the async pipeline).
 *
 * Idempotent and safe to re-run: it only touches rows whose URL is empty/NULL,
 * and never clears anything on a slot that has a file.
 *
 *   npx tsx scripts/cleanup-orphan-pdf-file-names.ts          # dry run
 *   npx tsx scripts/cleanup-orphan-pdf-file-names.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";
import { flushEntity } from "../src/middlewares/autoFlush";
import { redisClient } from "../src/config/redis";

const APPLY = process.argv.includes("--apply");

type Target = {
  table: string;
  urlCol: string;
  nameCol: string;
  /** Async-pipeline columns; absent on ws_book, which has no upload pipeline. */
  statusCol?: string;
  progressCol?: string;
};

const TARGETS: Target[] = [
  {
    table: "ws_ebook", urlCol: "demo_url", nameCol: "demo_file_name",
    statusCol: "demo_upload_status", progressCol: "demo_upload_progress",
  },
  {
    table: "ws_ebook", urlCol: "book_url", nameCol: "book_file_name",
    statusCol: "book_upload_status", progressCol: "book_upload_progress",
  },
  { table: "ws_book", urlCol: "demo_url", nameCol: "demo_file_name" },
];

// An "empty" URL is NULL or the empty string — the two shapes the clear path
// has produced over time.
const emptyUrl = (t: Target) =>
  `(\`${t.urlCol}\` IS NULL OR \`${t.urlCol}\` = '')`;

/**
 * A slot is stale if its URL is empty but ANY companion column still claims a
 * file: a leftover name, a non-null upload status, or a non-zero progress.
 */
const orphanWhere = (t: Target) => {
  const claims = [`(\`${t.nameCol}\` IS NOT NULL AND \`${t.nameCol}\` <> '')`];
  if (t.statusCol) claims.push(`\`${t.statusCol}\` IS NOT NULL`);
  if (t.progressCol) claims.push(`(\`${t.progressCol}\` IS NOT NULL AND \`${t.progressCol}\` <> 0)`);
  return `${emptyUrl(t)} AND (${claims.join(" OR ")})`;
};

/** Reset every companion column of an empty slot. */
const resetSet = (t: Target) => {
  const sets = [`\`${t.nameCol}\` = NULL`];
  if (t.statusCol) sets.push(`\`${t.statusCol}\` = NULL`);
  if (t.progressCol) sets.push(`\`${t.progressCol}\` = 0`);
  return sets.join(", ");
};

async function main() {
  console.log(APPLY ? "MODE: apply\n" : "MODE: dry run (pass --apply to write)\n");
  let totalFound = 0;
  let totalFixed = 0;

  for (const t of TARGETS) {
    const extra = t.statusCol
      ? `, \`${t.statusCol}\` status, \`${t.progressCol}\` progress`
      : "";
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, \`${t.nameCol}\` name${extra} FROM \`${t.table}\`
       WHERE ${orphanWhere(t)} ORDER BY id`
    );
    totalFound += rows.length;
    console.log(`${t.table} ${t.urlCol} slot: ${rows.length} stale`);
    for (const r of rows.slice(0, 10)) {
      const status = t.statusCol ? ` status=${r.status} progress=${r.progress}` : "";
      console.log(`    id=${r.id} name=${JSON.stringify(r.name)}${status}`);
    }
    if (rows.length > 10) console.log(`    … ${rows.length - 10} more`);

    if (APPLY && rows.length) {
      const affected = await prisma.$executeRawUnsafe(
        `UPDATE \`${t.table}\` SET ${resetSet(t)} WHERE ${orphanWhere(t)}`
      );
      totalFixed += affected;
      console.log(`    → cleared ${affected}`);
    }
  }

  console.log(`\nfound ${totalFound}${APPLY ? `, cleared ${totalFixed}` : " (nothing written)"}`);

  // GET /admin/ebooks and /admin/ebooks/:id are cached for 24h
  // (cacheRoute({ ttl: 86400, entity: "ebook" })). API writes clear that via
  // autoFlushGroup("ebook"), but this script writes STRAIGHT TO SQL — so without
  // an explicit sweep the admin list keeps serving the orphan file name for up
  // to a day after the rows are fixed. Same for "book".
  if (APPLY && totalFixed > 0) {
    const cleared = await flushEntity("ebook", "book");
    console.log(`route cache: swept ${cleared} key(s) for entity ebook,book`);
  }

  await prisma.$disconnect();
  redisClient.disconnect();
}

main().catch(async (err) => {
  console.error("cleanup failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
