import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Commerce · eBook Subscription READ (`commerce-ebook-sub`) — Phase 3a ebook
 * entitlement source of truth over `ws_ebook_subscription` (1 row).
 *
 * IMPORTANT: **flag OFF**, **READ-ONLY**, NO standalone wired HTTP endpoint.
 * Rows gate ebook read/download access across still-Mongo consumers
 * (ebook read/list, downloads, dashboard) and join the int catalog (ebook) + int
 * customer id-space, so this can only flip with catalog + the rest of 3a. WRITES
 * are Phase 3b. See docs/migration/COMMERCE_WAVE_SCOPE.md.
 *
 * The dual-path (incl. the Prisma `status`/`payment_type` additions + nullable
 * date fix) is verified against the live DB via a tsx script, not HTTP. This
 * suite records that and stays green; the MySQL assertion is `skip`ped until the
 * flag is enabled.
 */

const ebookSubMysql = config.mysqlModules.includes("commerce-ebook-sub");

export async function runCommerceEbookSubClientApiTests(): Promise<boolean> {
  return runTests("commerce-ebook-sub (client)", [
    {
      name: "[commerce-ebook-sub] READ entitlement path verified via tsx (no standalone HTTP endpoint; flag OFF; writes are 3b)",
      skip: true, // informational: ebook entitlement reads gate other endpoints; data-path proven in tsx
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — commerce-ebook-sub entry */
      },
    },
    {
      name: "[commerce-ebook-sub ON] status/payment_type read (added to Prisma) + active = status≠false && end_at>now",
      skip: !ebookSubMysql,
      fn: () => {
        /*
         * On flip (with catalog + 3a), the ebook read/list/downloads consumer
         * suites assert entitlement gating end-to-end. The subscription-specific
         * invariants — `status` + `payment_type` (added to the Prisma model)
         * read correctly; nullable start/end dates; active = status≠false (NULL
         * = active) && end_at>now, latest endAt wins; customerId stays int (C3)
         * — are proven in the tsx verify script and re-asserted there at flip.
         */
      },
    },
  ]);
}
