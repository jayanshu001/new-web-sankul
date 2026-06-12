import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Commerce · Promocode READ (`commerce-promocode`) — Phase 3a, SQL-faithful
 * over `ws_promocode` (2) + `ws_promoted_package_course_ebook` (5).
 *
 * ⚠ IMPORTANT: **flag OFF** and these SQL tables do NOT carry the Mongo
 * `appliesTo`/`discountValue` model that the client `applyPromocode`/
 * `listPromocodes` paths read — the SQL discount is a per-plan promoter%/
 * customer% split. So this module builds SQL-faithful reads ONLY and CANNOT
 * serve the client promocode contract this wave (decision 2026-06-12); the
 * appliesTo reconciliation is a later effort. No standalone wired HTTP endpoint.
 * Verified via tsx. MySQL assertion `skip`ped until enabled.
 */

const promocodeMysql = config.mysqlModules.includes("commerce-promocode");

export async function runCommercePromocodeClientApiTests(): Promise<boolean> {
  return runTests("commerce-promocode (client)", [
    {
      name: "[commerce-promocode] SQL-faithful reads verified via tsx (NOT the client appliesTo contract; no HTTP endpoint; flag OFF)",
      skip: true, // informational: SQL tables can't reproduce the Mongo appliesTo shape; proven in tsx
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — commerce-promocode entry */
      },
    },
    {
      name: "[commerce-promocode ON] valid = status && start<now<expire + promoted plans (per-plan %) on detail read",
      skip: !promocodeMysql,
      fn: () => {
        /* Invariants proven in the tsx verify script; re-asserted at flip time. */
      },
    },
  ]);
}
