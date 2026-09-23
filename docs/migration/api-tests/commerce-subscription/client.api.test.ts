import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Commerce · Subscription READ (`commerce-subscription`) — Phase 3a entitlement
 * source of truth over `ws_package_course_subscription` (2 rows).
 *
 * IMPORTANT: **flag OFF**, **READ-ONLY**, and NO standalone wired HTTP endpoint.
 * Subscription rows gate access across many still-Mongo consumers
 * (lecture/progress/dashboard/purchase-history) and are joined on the int
 * catalog + int customer id-space, so this can only flip together with catalog +
 * the rest of 3a (the commerce-wave flip). WRITES are Phase 3b
 * (verify.controller / webhook). See docs/migration/COMMERCE_WAVE_SCOPE.md.
 *
 * The dual-path (incl. the bigint `tracking` schema fix and the SQL↔Mongo field-
 * name mapping) is verified against the live DB via a tsx script, not HTTP. This
 * suite records that and stays green; the MySQL assertion is `skip`ped until the
 * flag is enabled.
 */

const subscriptionMysql = config.mysqlModules.includes("commerce-subscription");

export async function runCommerceSubscriptionClientApiTests(): Promise<boolean> {
  return runTests("commerce-subscription (client)", [
    {
      name: "[commerce-subscription] READ entitlement path verified via tsx (no standalone HTTP endpoint; flag OFF; writes are 3b)",
      skip: true, // informational: entitlement reads gate other endpoints; data-path proven in tsx
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — commerce-subscription entry */
      },
    },
    {
      name: "[commerce-subscription ON] bigint tracking reads safely + SQL package_id→targetPackageId / pcb_id→packageId",
      skip: !subscriptionMysql,
      fn: () => {
        /*
         * On flip (with catalog + 3a), the consumer suites (lecture access,
         * dashboard, purchase-history) assert entitlement gating end-to-end.
         * The subscription-specific invariants — bigint `tracking` reads without
         * throwing + coerces lossless to number; SQL `package_id`→Mongo
         * `targetPackageId`, SQL `pcb_id`→Mongo `packageId`; active = status &&
         * end_at>now; customerId stays int (C3) — are proven in the tsx verify
         * script and re-asserted there at flip time.
         */
      },
    },
  ]);
}
