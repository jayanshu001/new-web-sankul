/**
 * Backfill NULL `ws_customer.created_at`.
 *
 * WHY THESE ROWS ARE NULL: the schema is introspected, so `created_at` has no
 * `@default(now())`, and `customerAuthRepository.createStub` never passed it.
 * Every customer created before the central timestamp middleware landed
 * (src/config/prisma.ts, 2026-07-16) therefore got NULL. New signups are fine —
 * this only repairs the historical gap.
 *
 * WHY IT MATTERS: `created_at` drives admin reporting.
 * `admin-customer.repository.ts` filters `createdAt: { gte, lte }` — NULL never
 * matches a comparison, so these customers are INVISIBLE in any date-filtered
 * customer report — and orders by `createdAt desc`, where MySQL sorts NULLs
 * last, putting the newest customers at the bottom of a "newest first" list.
 * `referral.repository.ts` also aliases this column as `referralCodeCreatedAt`.
 *
 * SOURCE OF TRUTH (best-effort — the real signup instant was never recorded):
 *   1. MIN(ws_customer_access_token.created_at) for the customer — their first
 *      login, the closest available proxy for signup.
 *   2. Fall back to `updated_at`, which is always set and is a hard upper bound
 *      on the signup time.
 * Never invents a value newer than `updated_at`.
 *
 * All timestamps flow through Prisma, so the IST read/write shift round-trips
 * correctly — do NOT rewrite this with raw SQL, which bypasses the shift.
 *
 * Idempotent: only touches rows where created_at IS NULL.
 *
 *   npx tsx scripts/backfill-customer-created-at.ts          # dry run
 *   npx tsx scripts/backfill-customer-created-at.ts --apply  # write
 */
import { prisma } from "../src/config/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  const targets = await prisma.customer.findMany({
    where: { createdAt: null },
    select: { id: true, phoneNumber: true, updatedAt: true },
    orderBy: { id: "asc" },
  });

  if (!targets.length) {
    console.log("Nothing to do — no ws_customer rows have a NULL created_at.");
    return;
  }

  console.log(`${targets.length} customer(s) with NULL created_at${APPLY ? "" : "  (DRY RUN — pass --apply to write)"}\n`);

  let fromToken = 0;
  let fromUpdatedAt = 0;
  let skipped = 0;

  for (const c of targets) {
    const firstToken = await prisma.customerAccessToken.findFirst({
      where: { customerId: c.id },
      orderBy: { created_at: "asc" },
      select: { created_at: true },
    });

    // Prefer the first login; never allow a value later than updated_at.
    let resolved: Date | null = firstToken?.created_at ?? null;
    let source = "first access token";
    if (!resolved || (c.updatedAt && resolved > c.updatedAt)) {
      resolved = c.updatedAt ?? null;
      source = "updated_at (no usable token)";
    }

    if (!resolved) {
      console.log(`  id ${c.id} (${c.phoneNumber}) — SKIPPED: no token and no updated_at`);
      skipped++;
      continue;
    }

    console.log(`  id ${c.id} (${c.phoneNumber}) → ${resolved.toISOString()}   [${source}]`);
    source.startsWith("first") ? fromToken++ : fromUpdatedAt++;

    if (APPLY) {
      // updatedAt passed explicitly so the timestamp middleware does not bump it
      // — backfilling a historical value must not look like a fresh edit.
      await prisma.customer.update({
        where: { id: c.id },
        data: { createdAt: resolved, updatedAt: c.updatedAt ?? undefined },
      });
    }
  }

  console.log(
    `\n${APPLY ? "Backfilled" : "Would backfill"} ${fromToken + fromUpdatedAt} row(s) ` +
      `(${fromToken} from first token, ${fromUpdatedAt} from updated_at)` +
      (skipped ? `, ${skipped} skipped` : "") +
      "."
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
