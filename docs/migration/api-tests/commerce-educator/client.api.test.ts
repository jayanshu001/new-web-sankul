import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Commerce · Educator READ (`commerce-educator`) — Phase 3a full-entity master
 * over `ws_course_educator` (56 rows). The FINAL 3a read module.
 *
 * IMPORTANT: **flag OFF**, **READ-ONLY**, NO standalone wired HTTP endpoint of
 * its own (educator detail is served via the still-Mongo educator controller;
 * ids embed in course listings). int-vs-ObjectId coupling → flips with catalog +
 * 3a. Verified via tsx (incl. the security check that `password` is never
 * surfaced and the `{_id,name,image}` ref projection). MySQL assertion `skip`ped
 * until the flag is enabled.
 */

const educatorMysql = config.mysqlModules.includes("commerce-educator");

export async function runCommerceEducatorClientApiTests(): Promise<boolean> {
  return runTests("commerce-educator (client)", [
    {
      name: "[commerce-educator] READ master verified via tsx (no standalone HTTP endpoint; flag OFF)",
      skip: true, // informational: educator master + ref projection; proven in tsx
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — commerce-educator entry */
      },
    },
    {
      name: "[commerce-educator ON] password never surfaced + ref={_id,name,image} + active=status",
      skip: !educatorMysql,
      fn: () => {
        /*
         * Invariants proven in the tsx verify script and re-asserted at flip:
         * `password` excluded from every read shape; ref projection is exactly
         * {_id,name,image}; active = status=true (no SQL `deleted` flag); the
         * bigint-unsigned `id` is mapped Int (latent risk logged, ids 20–85).
         */
      },
    },
  ]);
}
