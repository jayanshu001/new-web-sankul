/**
 * ONE-TIME backfill: shift every existing timestamp in the app DB by +5:30 so
 * legacy UTC rows match the new IST-in-DB storage (see config/prisma.ts).
 *
 *   stored := stored + INTERVAL 330 MINUTE   (DATETIME wall-clock and TIMESTAMP
 *   instant both move exactly 5.5h — consistent with the Prisma write-shift, so
 *   reads via the middleware return the original UTC.)
 *
 * ⚠️ IRREVERSIBLE. Made SAFE + RESUMABLE:
 *   • Batched by PK range (BATCH rows/statement) so no single statement is huge
 *     — this is what overflowed the binlog and crashed the server the naive way.
 *   • Progress tracked per (table,column) with a last-done id in `_ist_backfill`;
 *     a crash/re-run resumes exactly where it stopped — never double-shifts.
 *   • Requires env `IST_BACKFILL_CONFIRM=YES`.
 *
 * Tables without a single-int `id` PK (pivots) are shifted in one statement
 * (they are small). Uses a bare PrismaClient (no IST middleware) — the UPDATEs
 * carry no Date params/results, so the shift math stays purely DB-side.
 *
 * Run (deploy window, once):  IST_BACKFILL_CONFIRM=YES npx tsx scripts/backfill-ist-timestamps.ts
 * PRODUCTION NOTE: batching keeps binlog on (replication-safe). Run during low
 * traffic. See docs/migration/IST_STORAGE_MIGRATION.md for the full runbook.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";

const SHIFT_MINUTES = 330; // +05:30
const BATCH = 20_000;
const LEDGER = "_ist_backfill";

const prisma = new PrismaClient(); // bare client — no IST middleware

function dbName(): string {
  const m = (process.env.DATABASE_URL ?? "").match(/\/([^/?]+)(\?|$)/);
  if (!m) throw new Error("Cannot parse database name from DATABASE_URL");
  return decodeURIComponent(m[1]);
}

async function hasIntIdPk(schema: string, table: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='id'
        AND DATA_TYPE IN ('int','bigint','smallint','mediumint') AND COLUMN_KEY='PRI'`,
    schema, table
  );
  return Number(r[0].n) > 0;
}

async function main() {
  if (process.env.IST_BACKFILL_CONFIRM !== "YES") {
    console.error("Refusing: set IST_BACKFILL_CONFIRM=YES to confirm this IRREVERSIBLE backfill.");
    process.exit(2);
  }
  const schema = dbName();

  // Resumable ledger: one row per (table,column); `last_id` = highest id shifted
  // so far (-1 = column fully done via single-statement path).
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS \`${LEDGER}\` (
       \`marker\` VARCHAR(128) PRIMARY KEY,
       \`last_id\` BIGINT NOT NULL DEFAULT 0,
       \`done\` TINYINT NOT NULL DEFAULT 0,
       \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );

  const cols = await prisma.$queryRawUnsafe<{ TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string }[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.columns
      WHERE TABLE_SCHEMA=? AND TABLE_NAME LIKE 'ws\\_%'
        AND DATA_TYPE IN ('datetime','timestamp')
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    schema
  );
  console.log(`IST backfill: ${cols.length} columns in ${schema} (+${SHIFT_MINUTES}m, batch ${BATCH})\n`);

  for (const c of cols) {
    const marker = `${c.TABLE_NAME}.${c.COLUMN_NAME}`;
    const state = await prisma.$queryRawUnsafe<{ last_id: bigint; done: number }[]>(
      `SELECT last_id, done FROM \`${LEDGER}\` WHERE marker=?`, marker
    );
    if (state.length && state[0].done) { console.log(`  ↷ ${marker} already done`); continue; }
    let resumeId = state.length ? Number(state[0].last_id) : 0;

    if (await hasIntIdPk(schema, c.TABLE_NAME)) {
      const mm = await prisma.$queryRawUnsafe<{ mx: bigint | null }[]>(`SELECT MAX(id) mx FROM \`${c.TABLE_NAME}\``);
      const maxId = Number(mm[0].mx ?? 0);
      for (let lo = resumeId + 1; lo <= maxId; lo += BATCH) {
        const hi = lo + BATCH - 1;
        await prisma.$executeRawUnsafe(
          `UPDATE \`${c.TABLE_NAME}\` SET \`${c.COLUMN_NAME}\`=\`${c.COLUMN_NAME}\`+INTERVAL ${SHIFT_MINUTES} MINUTE
            WHERE id BETWEEN ${lo} AND ${hi} AND \`${c.COLUMN_NAME}\` IS NOT NULL`
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO \`${LEDGER}\`(marker,last_id) VALUES(?,${hi})
             ON DUPLICATE KEY UPDATE last_id=${hi}`, marker
        );
      }
    } else {
      // No int id — single statement (pivot tables are small).
      await prisma.$executeRawUnsafe(
        `UPDATE \`${c.TABLE_NAME}\` SET \`${c.COLUMN_NAME}\`=\`${c.COLUMN_NAME}\`+INTERVAL ${SHIFT_MINUTES} MINUTE
          WHERE \`${c.COLUMN_NAME}\` IS NOT NULL`
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`${LEDGER}\`(marker,last_id,done) VALUES(?,0,1)
         ON DUPLICATE KEY UPDATE done=1`, marker
    );
    console.log(`  ✓ ${marker} (${c.DATA_TYPE})`);
  }
  console.log(`\n✓ done — ${cols.length} columns shifted +${SHIFT_MINUTES}m.`);
}

main()
  .catch((e) => { console.error("BACKFILL FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
