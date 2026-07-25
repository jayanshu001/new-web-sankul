/**
 * Seed `ws_customer.is_login` from current token state.
 *
 * WHY IT WAS NULL: the column is Laravel-era session scaffolding that no code
 * ever wrote — NULL on every row. As of 2026-07-25 it is maintained live:
 *   • set TRUE  on a successful login (`markVerified` / `clearTried`)
 *   • set FALSE on an explicit logout (`markLoggedOut`, from /logout and
 *     /logout-all-devices)
 *   • reconciled FALSE by the customer-auth housekeeping sweep when the last
 *     live token expires (`reconcileLoggedOut`, otp-unblock.scheduler.ts)
 *
 * That live wiring only affects rows as customers act. This script gives the
 * existing rows a correct starting value instead of leaving them NULL forever:
 * TRUE when the customer holds at least one live token (active, not deleted,
 * unexpired), FALSE otherwise.
 *
 * ⚠ READ BEFORE TRUSTING THIS COLUMN. `is_login` is DERIVED state, not a fact:
 *   • Customers may hold several concurrent device sessions (the single-device
 *     gate in authenticate.ts is disabled for them), so the flag can only ever
 *     mean "has at least one live session" — it cannot express per-device state.
 *   • Between sweeps (default 5 min) an expired session still reads TRUE.
 *   • The authoritative sources remain `ws_customer_access_token`
 *     (active/deleted/expires_at), the JWT itself, and libs/tokenRevocation.ts.
 *     Prefer those for anything that gates access; this flag is for reporting.
 *
 * Idempotent: converges to the same values on every run (safe to re-run).
 *
 *   npx tsx scripts/backfill-customer-is-login.ts          # dry run
 *   npx tsx scripts/backfill-customer-is-login.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  const now = new Date();

  const liveTokens = await prisma.customerAccessToken.findMany({
    where: { active: true, deleted: false, expires_at: { gt: now } },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const live = new Set(liveTokens.map((t) => t.customerId));

  const customers = await prisma.customer.findMany({
    select: { id: true, isLoggedIn: true },
    orderBy: { id: "asc" },
  });

  const toTrue = customers.filter((c) => live.has(c.id) && c.isLoggedIn !== true).map((c) => c.id);
  const toFalse = customers.filter((c) => !live.has(c.id) && c.isLoggedIn !== false).map((c) => c.id);

  console.log(
    `${customers.length} customer(s); ${live.size} hold a live session` +
      `${APPLY ? "" : "  (DRY RUN — pass --apply to write)"}\n` +
      `  -> set TRUE : ${toTrue.length}${toTrue.length ? ` (ids ${toTrue.join(", ")})` : ""}\n` +
      `  -> set FALSE: ${toFalse.length}\n` +
      `  -> already correct: ${customers.length - toTrue.length - toFalse.length}`
  );

  if (!APPLY) return;

  // updatedAt is NOT passed, and the timestamp middleware only fills it when the
  // caller leaves it undefined on an `update` — so bulk `updateMany` here would
  // still bump it. Pass it explicitly per batch? No: `is_login` is live session
  // state, not history, so letting updated_at move is wrong for a backfill. Use
  // updateMany with an explicit updatedAt-preserving pass instead.
  for (const id of toTrue) {
    const c = await prisma.customer.findUnique({ where: { id }, select: { updatedAt: true } });
    await prisma.customer.update({ where: { id }, data: { isLoggedIn: true, updatedAt: c?.updatedAt ?? undefined } });
  }
  for (const id of toFalse) {
    const c = await prisma.customer.findUnique({ where: { id }, select: { updatedAt: true } });
    await prisma.customer.update({ where: { id }, data: { isLoggedIn: false, updatedAt: c?.updatedAt ?? undefined } });
  }

  console.log(`\nSeeded ${toTrue.length} TRUE + ${toFalse.length} FALSE.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
