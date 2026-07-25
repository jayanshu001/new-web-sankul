/**
 * Backfill NULL `ws_customer.last_login_date` from access-token history.
 *
 * WHY IT WAS NULL: `login_count` was always maintained (`createStub` seeds it,
 * `setOtpForLogin` bumps it) but nothing ever wrote the matching timestamp — you
 * could see how OFTEN a customer logged in, never WHEN. Fixed going forward on
 * 2026-07-25 by stamping `lastLogin` in `markVerified` / `clearTried` (the two
 * successful-login branches of `validateOtp`); this repairs the history.
 *
 * SOURCE: MAX(ws_customer_access_token.created_at) per customer.
 *
 * ⚠ IT IS A PROXY, NOT AN EXACT LOGIN TIME. A token row is inserted both on a
 * successful OTP login (`client/auth/auth.service.ts:287`) AND on a token refresh
 * (`:372`), and the two are indistinguishable by column. So the value means "last
 * token issued" — the last login or the last silent refresh, whichever came
 * later. It is an upper bound on the last interactive login, and strictly better
 * than NULL, but do not treat backfilled values as precise. Rows stamped by the
 * live code path from 2026-07-25 onward ARE exact.
 *
 * Customers with no token rows have never completed a login and are left NULL —
 * that is the correct value, not a gap.
 *
 * All timestamps flow through Prisma so the IST read/write shift round-trips —
 * do NOT rewrite this with raw SQL, which bypasses the shift.
 *
 * Idempotent: only touches rows where last_login_date IS NULL.
 *
 *   npx tsx scripts/backfill-customer-last-login.ts          # dry run
 *   npx tsx scripts/backfill-customer-last-login.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  const targets = await prisma.customer.findMany({
    where: { lastLogin: null },
    select: { id: true, phoneNumber: true, updatedAt: true, lastLoginCount: true },
    orderBy: { id: "asc" },
  });

  if (!targets.length) {
    console.log("Nothing to do — no ws_customer rows have a NULL last_login_date.");
    return;
  }

  console.log(`${targets.length} customer(s) with NULL last_login_date${APPLY ? "" : "  (DRY RUN — pass --apply to write)"}\n`);

  let filled = 0;
  let neverLoggedIn = 0;

  for (const c of targets) {
    const lastToken = await prisma.customerAccessToken.findFirst({
      where: { customerId: c.id },
      orderBy: { created_at: "desc" },
      select: { created_at: true },
    });

    if (!lastToken?.created_at) {
      console.log(`  id ${c.id} (${c.phoneNumber}) — left NULL: no token history (never completed a login)`);
      neverLoggedIn++;
      continue;
    }

    console.log(`  id ${c.id} (${c.phoneNumber}) → ${lastToken.created_at.toISOString()}   [login_count=${c.lastLoginCount ?? "-"}]`);
    filled++;

    if (APPLY) {
      // updatedAt passed explicitly so the timestamp middleware does not bump it
      // — backfilling history must not look like a fresh edit.
      await prisma.customer.update({
        where: { id: c.id },
        data: { lastLogin: lastToken.created_at, updatedAt: c.updatedAt ?? undefined },
      });
    }
  }

  console.log(
    `\n${APPLY ? "Backfilled" : "Would backfill"} ${filled} row(s); ` +
      `${neverLoggedIn} left NULL (no login history).`
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
