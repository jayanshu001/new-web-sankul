// Route cache TTLs: flushGroups.ts names WHICH resource a cached read belongs
// to; this names HOW LONG it stays fresh. Never inline a raw number in a route.

export const CACHE_TTL = {
  /** Near-static catalog/CMS content. Freshness after an admin edit comes from
   *  the route's `entity` flush tag (flushGroups.ts), not this TTL. */
  DAY: 86400,
  /** Per-user home feed (purchase state + unread badge). */
  DASHBOARD: 60,
  /** Shared across admins and heavier, so it tolerates a longer TTL. */
  ADMIN_DASHBOARD: 120,
  /** Cart / my-subscriptions: seeing one's own write matters more than hit rate. */
  QUICK_REFRESH: 30,
  /** Unread badge, polled frequently by the app. */
  UNREAD_COUNT: 15,
} as const;

export type CacheTtlKey = keyof typeof CACHE_TTL;
