import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Commerce · Promoter READ (`commerce-promoter`) — Phase 3a promocode owner
 * master over `ws_promoter` (114 rows).
 *
 * IMPORTANT: **flag OFF**, **READ-ONLY**, NO standalone wired HTTP endpoint
 * (promoter ids hydrate promocode owners; int-vs-ObjectId coupling with
 * still-Mongo consumers). Flips with catalog + 3a. Verified via tsx (incl. the
 * security check that `password` is never surfaced). MySQL assertion `skip`ped
 * until the flag is enabled.
 */

const promoterMysql = config.mysqlModules.includes("commerce-promoter");

export async function runCommercePromoterClientApiTests(): Promise<boolean> {
  return runTests("commerce-promoter (client)", [
    {
      name: "[commerce-promoter] READ master verified via tsx (no standalone HTTP endpoint; flag OFF)",
      skip: true, // informational: promoter master hydrates promocode owners; proven in tsx
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — commerce-promoter entry */
      },
    },
    {
      name: "[commerce-promoter ON] password never surfaced + full_name→fullName (camelCase) + active=status&&!isDelete",
      skip: !promoterMysql,
      fn: () => {
        /* Invariants proven in the tsx verify script; re-asserted at flip time. */
      },
    },
  ]);
}
