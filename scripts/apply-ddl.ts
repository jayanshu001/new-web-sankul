/**
 * apply-ddl.ts — one-command schema applier for the WebSankul DDL files.
 *
 * The repo's Prisma schema is INTROSPECTED (not authored), so there is no
 * `prisma/migrations/` history and `prisma migrate deploy` has nothing to apply.
 * The real schema lives as dated raw DDL in `docs/migration/schema-changes/*.sql`.
 *
 * This runner replays those files like a migration tool would:
 *   - keeps a `_ddl_migrations` ledger table (filename + applied_at)
 *   - applies, in filename (date) order, only the files NOT yet recorded
 *   - delegates the actual SQL execution to `prisma db execute --file`, which
 *     handles multi-statement files, comments, and DDL natively against DATABASE_URL
 *
 * Idempotent: re-running applies nothing once everything is recorded.
 *
 * Usage:  yarn db:migrate            # apply all pending DDL
 *         tsx scripts/apply-ddl.ts   # same thing
 */

import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DDL_DIR = path.resolve(__dirname, "../docs/migration/schema-changes");
const SCHEMA = path.resolve(__dirname, "../prisma/schema.prisma");

const prisma = new PrismaClient();

async function ensureLedger(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS \`_ddl_migrations\` (
      \`filename\`   VARCHAR(255) NOT NULL,
      \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`filename\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ filename: string }[]>(
    "SELECT `filename` FROM `_ddl_migrations`"
  );
  return new Set(rows.map((r) => r.filename));
}

function pendingFiles(applied: Set<string>): string[] {
  return readdirSync(DDL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // dated filenames sort chronologically
    .filter((f) => !applied.has(f));
}

function applyFile(file: string): void {
  const full = path.join(DDL_DIR, file);
  // prisma db execute reads the datasource (DATABASE_URL) from the schema and
  // runs the whole file as one script — multi-statement + comments supported.
  // `shell: true` so Windows resolves the `npx.cmd` shim (execFileSync alone
  // only finds bare executables → ENOENT on Windows). Args are quoted because
  // shell mode re-parses the command string.
  execFileSync(
    "npx",
    ["prisma", "db", "execute", "--file", `"${full}"`, "--schema", `"${SCHEMA}"`],
    { stdio: "inherit", shell: true }
  );
}

async function main(): Promise<void> {
  await ensureLedger();
  const applied = await appliedSet();
  const pending = pendingFiles(applied);

  if (pending.length === 0) {
    console.log("✓ schema up to date — no pending DDL");
    return;
  }

  console.log(`Applying ${pending.length} pending DDL file(s):\n`);
  for (const file of pending) {
    process.stdout.write(`  → ${file} ... `);
    try {
      applyFile(file);
      await prisma.$executeRawUnsafe(
        "INSERT INTO `_ddl_migrations` (`filename`) VALUES (?)",
        file
      );
      console.log("applied");
    } catch (err) {
      console.error(`\n✗ FAILED on ${file} — stopping. Nothing after this ran.`);
      throw err;
    }
  }
  console.log(`\n✓ done — ${pending.length} file(s) applied`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
