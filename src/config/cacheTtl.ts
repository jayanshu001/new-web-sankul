// src/config/cacheTtl.ts
//
// Single source of truth for cacheRoute() TTLs — the reusability counterpart
// to the CacheEntity registry in middlewares/flushGroups.ts. That file names
// WHICH resource a cached read belongs to (the flush unit); this one names
// HOW LONG it stays fresh. Together a route reads as:
//
//   cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Course, scope: CacheScope.User })
//
// instead of a bare magic number repeated at every call site. Reuse an
// existing constant when a new route's freshness need matches one; add a new
// named constant when it doesn't. Never inline a raw number in a route file.

export const CACHE_TTL = {
  /** Near-static catalog/CMS content (courses, packages, ebooks, categories,
   *  FAQs, banners, terms...) — the default for anything that only changes at
   *  admin-edit cadence. Freshness after an edit comes from the route's
   *  `entity` flush tag, not this TTL — see flushGroups.ts. */
  DAY: 86400,
  /** Per-user home/dashboard feed — mixes purchase state + unread-notification
   *  badge, so it refreshes often enough that a stale minute isn't noticed. */
  DASHBOARD: 60,
  /** Admin dashboard aggregate — shared across admins, heavier query than the
   *  customer dashboard, so it tolerates a slightly longer TTL. */
  ADMIN_DASHBOARD: 120,
  /** Cart / my-subscriptions — short-lived per-user lists where "did my own
   *  write just show up" matters more than raw cache hit rate. */
  QUICK_REFRESH: 30,
  /** Unread notification badge count — polled frequently by the app; a short
   *  TTL absorbs the poll traffic without serving a stale badge for long. */
  UNREAD_COUNT: 15,
} as const;

export type CacheTtlKey = keyof typeof CACHE_TTL;
