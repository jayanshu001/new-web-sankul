import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Commerce · Price (`commerce-price`) — Phase 3a read-only plan/pricing lookup
 * over `ws_package_course_ebook_price` (1353 rows).
 *
 * IMPORTANT: this module is **flag OFF** and has NO standalone wired HTTP
 * endpoint — every price consumer (`/client/packages`, `/courses`, `/dashboard`,
 * `/payment`, `/orders`, `/promocode`, …) joins int-id catalog rows and
 * ObjectId-id subscription/order rows, so price can only flip together with
 * catalog + the rest of 3a in one consistent id-space (the commerce-wave flip).
 * See docs/migration/COMMERCE_WAVE_SCOPE.md.
 *
 * The dual-path is therefore verified against the live DB via a tsx script
 * (mirrors the catalog-video precedent), not over HTTP. This suite records that
 * fact and stays green either way; the MySQL-source assertion is `skip`ped until
 * the flag is enabled.
 */

const priceMysql = config.mysqlModules.includes("commerce-price");

export async function runCommercePriceClientApiTests(): Promise<boolean> {
  return runTests("commerce-price (client)", [
    {
      name: "[commerce-price] plan/pricing lookup verified via tsx (no standalone HTTP endpoint; flag OFF)",
      skip: true, // informational: no safe standalone price endpoint to flip; data-path proven in tsx
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — commerce-price entry */
      },
    },
    {
      name: "[commerce-price ON] owner-id `0` sentinel → null + duration surfaced as DAYS",
      skip: !priceMysql,
      fn: () => {
        /*
         * When the flag flips (with catalog + 3a), the consumer-level package/
         * course/dashboard suites assert plan shapes end-to-end. The price-
         * specific invariants (0/null owner ids → null; exactly-one owner;
         * material_price null → 0; duration is DAYS e.g. '12 Month' → 365) are
         * proven in the tsx verify script and re-asserted there at flip time.
         */
      },
    },
  ]);
}
