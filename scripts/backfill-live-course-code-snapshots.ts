/**
 * Backfill ws_live_course_subscription.promocode / .refferalcode from the bare
 * promocode_id / referrer_id that older rows carry.
 *
 * ⚠⚠ RUN THIS BEFORE DROPPING THE ID COLUMNS ⚠⚠
 * `2026-08-20_live_course_subscription_drop_code_ids.sql` removes promocode_id and
 * referrer_id. They are this script's ONLY input, so once that DDL is applied the
 * attribution of any row not already snapshotted is gone for good. Deploy order is:
 * add-columns DDL → code → THIS BACKFILL → drop-columns DDL.
 *
 * The id columns are read with raw SQL on purpose: they no longer exist on the Prisma
 * model (removed with the drop), so a typed read would not compile — and this script
 * has to keep working in the window where the columns are still there.
 *
 * Uses the SAME builder as the live checkout path (modules/order-code-snapshot with
 * planKind "livePlan"), so a backfilled row is byte-identical to a newly written one.
 *
 * SAFETY
 * - Rows that ALREADY hold a snapshot object are never rewritten.
 * - A row whose promocode / customer no longer resolves is LEFT NULL rather than
 *   half-built or guessed at — a missing snapshot reads as "no code" in the report,
 *   which is the same thing it showed before this column existed.
 * - `updated_at` is pinned to its existing value: a repair is not a business event.
 * - PK-batched + resumable (`--from=`), idempotent, DRY-RUN BY DEFAULT.
 *
 *   npx tsx scripts/backfill-live-course-code-snapshots.ts              # dry run
 *   npx tsx scripts/backfill-live-course-code-snapshots.ts --apply
 *   npx tsx scripts/backfill-live-course-code-snapshots.ts --apply --from=1200
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { buildOrderCodeSnapshots } from "../src/modules/order-code-snapshot/order-code-snapshot.service";

const APPLY = process.argv.includes("--apply");
const FROM = Number(process.argv.find((a) => a.startsWith("--from="))?.split("=")[1] ?? 0) || 0;
const BATCH = 500;

const main = async () => {
  let cursor = FROM;
  let scanned = 0, promo = 0, referral = 0, unresolved = 0, skipped = 0;

  for (;;) {
    const rows = await prisma.$queryRawUnsafe<
      { id: number; planId: number | null; promocodeId: number | null; referrerId: number | null; promocode: unknown; refferalcode: unknown }[]
    >(
      `SELECT id,
              plan_id       AS planId,
              promocode_id  AS promocodeId,
              referrer_id   AS referrerId,
              promocode,
              refferalcode
         FROM ws_live_course_subscription
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ${BATCH}`,
      cursor
    );
    if (!rows.length) break;
    cursor = rows[rows.length - 1]!.id;
    scanned += rows.length;

    for (const r of rows) {
      // Already snapshotted → never rewrite. A raw driver may hand back a JSON column
      // as a string rather than a parsed object, so test both forms.
      const filled = (v: unknown) =>
        v != null && (typeof v === "object" || (typeof v === "string" && v.trim().startsWith("{")));
      const hasSnapshot = filled(r.promocode) || filled(r.refferalcode);
      if (hasSnapshot) { skipped++; continue; }
      if (!r.promocodeId && !r.referrerId) continue;      // no code was redeemed
      // No plan on the row → nothing to snapshot the code against. Left NULL.
      if (r.planId == null) {
        unresolved++;
        console.log(`  id=${r.id} UNRESOLVED (no planId; promocodeId=${r.promocodeId} referrerId=${r.referrerId}) — left NULL`);
        continue;
      }

      const snap = await buildOrderCodeSnapshots({
        promocodeId: r.promocodeId ?? null,
        referrerId: r.referrerId ?? null,
        planId: r.planId,
        planKind: "livePlan",
      });
      if (!snap.promocode && !snap.refferalcode) {
        unresolved++;
        console.log(`  id=${r.id} UNRESOLVED (promocodeId=${r.promocodeId} referrerId=${r.referrerId} planId=${r.planId}) — left NULL`);
        continue;
      }
      if (snap.promocode) promo++; else referral++;

      if (APPLY) {
        await prisma.liveCourseSubscription.update({
          where: { id: r.id },
          data: {
            promocode: (snap.promocode as Prisma.InputJsonValue) ?? Prisma.DbNull,
            refferalcode: (snap.refferalcode as Prisma.InputJsonValue) ?? Prisma.DbNull,
            // Pin the timestamp — a data repair must not look like a business update.
            updatedAt: (await prisma.liveCourseSubscription.findUnique({ where: { id: r.id }, select: { updatedAt: true } }))?.updatedAt ?? undefined,
          },
        });
      }
    }
    if (rows.length < BATCH) break;
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — scanned=${scanned} promocodeSnapshots=${promo} referralSnapshots=${referral} unresolved=${unresolved} alreadySnapshotted=${skipped}`
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
  await prisma.$disconnect();
};

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
