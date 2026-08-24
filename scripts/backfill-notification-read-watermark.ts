/**
 * ONE-TIME backfill: stamp `ws_customer.notifications_read_before = now` for every
 * EXISTING customer, so moving notification read-state off the shared
 * `ws_notification.is_read` does not relight the unread badge for the whole user base.
 *
 * WHY THIS EXISTS
 *   Read state used to live on the notification row. For a broadcast that row is
 *   shared, so one customer reading it marked it read for everyone (60 of 63
 *   broadcasts were globally `is_read = 1` on staging). Read state now lives in
 *   ws_notification_read, per customer — which means that on deploy every existing
 *   customer would suddenly have every broadcast unread. The watermark says "anything
 *   sent before I deployed counts as already read for you", in ONE scalar per customer
 *   instead of a (customers x notifications) cross-product (~37M rows at 600k
 *   customers).
 *
 * ⚠️ BATCHED BY PRIMARY KEY, ON PURPOSE.
 *   A previous unbounded `updateMany` over this same 600k-row table took production
 *   down with "Server has closed the connection". This pages by `id` and caps the work
 *   per statement. Re-running is safe: it only ever touches rows where the column is
 *   still NULL, so a crashed run resumes naturally and never re-stamps.
 *
 * New customers are deliberately NOT stamped (they stay NULL). The signup cut-off in
 * client-notification.service already hides pre-signup broadcasts from them, so there
 * is nothing to pre-read.
 *
 * Run (once, at deploy):
 *   npx tsx scripts/backfill-notification-read-watermark.ts
 *   npx tsx scripts/backfill-notification-read-watermark.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";

const BATCH = 5_000;
const DRY_RUN = process.argv.includes("--dry-run");

// Bare client — no IST middleware. The cutover instant is written as a DB-side
// expression so it matches how the app's shifted writes land (see the IST note in
// docs/migration/schema-changes/2026-08-24_notification_read_state.sql).
const prisma = new PrismaClient();

const main = async () => {
  const [{ total }] = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
    "SELECT COUNT(*) AS total FROM ws_customer WHERE notifications_read_before IS NULL"
  );
  const pending = Number(total);
  console.log(`customers needing a watermark: ${pending}`);
  if (DRY_RUN) {
    console.log("--dry-run: no writes performed.");
    return;
  }
  if (pending === 0) {
    console.log("nothing to do.");
    return;
  }

  let cursor = 0;
  let stamped = 0;
  for (;;) {
    // Page by PK, then update THAT page — never one unbounded statement.
    const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
      "SELECT id FROM ws_customer WHERE id > ? AND notifications_read_before IS NULL ORDER BY id LIMIT ?",
      cursor,
      BATCH
    );
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    cursor = ids[ids.length - 1];

    const affected = await prisma.$executeRawUnsafe(
      `UPDATE ws_customer
          SET notifications_read_before = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE)
        WHERE notifications_read_before IS NULL
          AND id IN (${ids.map(() => "?").join(",")})`,
      ...ids
    );
    stamped += affected;
    console.log(`  stamped ${stamped}/${pending} (through id ${cursor})`);
  }
  console.log(`done. ${stamped} customers stamped.`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
