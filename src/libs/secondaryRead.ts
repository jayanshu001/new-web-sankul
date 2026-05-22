// src/libs/secondaryRead.ts
//
// Route a Mongoose read to a replica-set secondary with a bounded staleness
// budget. Use this on endpoints where "I might be 5 seconds behind" is fine
// (catalogs, course/package/ebook listings, analytics dashboards). Do NOT
// use it on a path that just performed a write whose result you need to
// read back (verify webhooks, post-create redirects) — secondaries can lag
// primary by hundreds of ms even under normal load.
//
// What this gives you:
//   1. Offloads read traffic from primary, freeing it for writes.
//   2. Survives a primary stepdown — secondaries keep serving reads during
//      a Mongo failover (~5-15s) instead of returning 500s.
//
// What it does NOT do:
//   - Make queries faster individually (the secondary is the same hardware
//     class). The win is throughput, not latency.
//   - Provide read-your-writes consistency. Use sparingly.
//
// Usage:
//   // Query object form (works for find/findOne/etc.):
//   const courses = await secondaryRead(
//     Course.find({ status: true }).sort({ name: 1 }).limit(20)
//   );
//
//   // Aggregation form:
//   const stats = await secondaryRead(
//     ReferralTransaction.aggregate([...])
//   );
//
// Implementation note: Mongoose's `.read("secondaryPreferred")` (alias
// "sp") tells the driver to prefer a secondary but fall back to primary if
// none are available — exactly the semantics we want. `maxStalenessSeconds`
// caps how far behind a chosen secondary can be.

import { Query, Aggregate } from "mongoose";

const DEFAULT_MAX_STALENESS_SECONDS = 90;

export interface SecondaryReadOptions {
  /**
   * Hard cap (seconds) on how far behind the chosen secondary may be. Mongo
   * driver minimum is 90. Lower values offer fresher data but reduce the
   * pool of eligible secondaries.
   */
  maxStalenessSeconds?: number;
}

/**
 * Apply secondary-preferred read preference to a Mongoose Query or Aggregate
 * and await its result. Works as a drop-in await wrapper — the underlying
 * query type is preserved.
 *
 * Example:
 *   const list = await secondaryRead(Course.find({ active: true }).lean());
 */
export async function secondaryRead<T>(
  query: Query<T, any> | Aggregate<T>,
  opts: SecondaryReadOptions = {}
): Promise<T> {
  const maxStalenessSeconds =
    opts.maxStalenessSeconds ?? DEFAULT_MAX_STALENESS_SECONDS;

  // Both Query and Aggregate expose `.read(pref, tags?)`. The third tuple
  // member (max staleness) is accepted as part of `read()` in Mongoose 8.
  // Keeping the call shape generic so this helper compiles against either.
  (query as any).read("secondaryPreferred", [], { maxStalenessSeconds });
  return query as unknown as Promise<T>;
}
