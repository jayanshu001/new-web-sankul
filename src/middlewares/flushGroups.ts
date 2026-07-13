// src/middlewares/flushGroups.ts
//
// Flush groups — the map of "when an admin edits X, which cached reads (admin
// AND client) go stale and must be cleared". One place defines every admin→
// client cache dependency, so route files just say `autoFlushGroup("ebook")`
// instead of repeating long entity lists.
//
// The lists below are grounded in the actual client catalog code (Prisma
// includes + transformers), NOT guessed. See cache/FLUSH_GROUP_MAP.md for the
// evidence behind each entry.
//
// Entity tag naming: these strings are the `entity` tags used in
// `cacheRoute({ entity })` on BOTH the admin and client routes. Keep them
// consistent across the read routes and these groups.
//
// IMPORTANT non-embeds (verified — do NOT add these, they'd wipe cache for
// nothing):
//   - packages do NOT embed ebooks / courses / books (only categories, plans,
//     counts). So editing an ebook must NOT flush package caches.
//   - ebook / book responses are flat — a category/course/package edit does not
//     stale them.

/**
 * Every valid cache entity tag. This is the SINGLE source of truth for the
 * strings used in `cacheRoute({ entity })`, `autoFlush(...)`, `flushEntity(...)`
 * and the flush-group keys. Because it's a typed union, a typo (e.g. "ebookk")
 * is a COMPILE error instead of a silent no-op flush. Add new tags here first.
 */
export type CacheEntity =
  // Admin + shared masters
  | "ebook"
  | "book"
  | "course"
  | "package"
  | "live-course"
  | "exam"
  | "video"
  | "material"
  | "goal"
  | "educator"
  | "package-type"
  | "plan"
  | "price"
  | "promo-code"
  | "exam-countdown"
  | "video-category"
  | "material-category"
  | "exam-category"
  | "course-subject-category"
  | "package-category"
  | "banner"
  | "testimonial"
  | "faq"
  | "popup"
  | "terms"
  | "social-link"
  | "current-affair"
  // Client-facing catalog cache tags
  | "catalog-ebook"
  | "catalog-book"
  | "catalog-course"
  | "catalog-package"
  | "catalog-exam"
  | "client-dashboard"
  | "categories"
  | "free"
  | "cms"
  // Per-user client caches (scope:"user", short TTL)
  | "cart";

/**
 * `FLUSH_GROUPS[x]` = every cache entity tag to clear when entity `x` is
 * written by an admin. Always includes `x` itself (the admin-side cache) plus
 * the client-facing caches that embed `x`'s data.
 */
export const FLUSH_GROUPS: Partial<Record<CacheEntity, CacheEntity[]>> = {
  // ── Products ──────────────────────────────────────────────────────────────
  // Ebook: flat client detail/list + dashboard trending-ebook + free-ebooks +
  // exam-countdown book/ebook listings. NOT package/course (no embed).
  ebook: ["ebook", "catalog-ebook", "client-dashboard", "free", "exam-countdown"],

  // Book: flat client detail/list + dashboard trending-book + ec listings.
  book: ["book", "catalog-book", "client-dashboard", "exam-countdown"],

  // Course: client course detail/list + dashboard course sections + free-courses
  // (course+package merge) + ec product listings + category tabs.
  course: ["course", "catalog-course", "client-dashboard", "free", "exam-countdown", "categories"],

  // Package: client package detail/list + dashboard "recently added" + free +
  // ec listings + package-category listings + category tabs.
  package: ["package", "catalog-package", "client-dashboard", "free", "exam-countdown", "categories"],

  // Live course: merged into free-courses + dashboard-adjacent + category tabs.
  "live-course": ["live-course", "catalog-course", "client-dashboard", "free", "categories"],

  // ── Categories (widest fan-out: embedded as summaries+counts in BOTH package
  //    and course details, plus their own listings and tabs) ─────────────────
  "video-category": ["video-category", "catalog-package", "catalog-course", "categories", "free"],
  "material-category": ["material-category", "catalog-package", "catalog-course", "categories", "free"],
  "exam-category": ["exam-category", "catalog-package", "catalog-course", "catalog-exam", "categories"],
  "course-subject-category": ["course-subject-category", "catalog-course", "client-dashboard"],
  "package-category": ["package-category", "catalog-package", "categories"],

  // ── Lookups embedded in product responses ─────────────────────────────────
  "package-type": ["package-type", "catalog-package", "client-dashboard"],
  goal: ["goal", "catalog-package", "client-dashboard"],
  educator: ["educator", "catalog-course"],

  // Plans/prices are embedded in EVERY product response + dashboard buckets.
  plan: ["plan", "catalog-package", "catalog-course", "catalog-ebook", "client-dashboard", "free"],
  price: ["price", "catalog-package", "catalog-course", "catalog-ebook", "client-dashboard", "free"],
  "promo-code": ["promo-code", "catalog-package"],

  // ── Exams / countdowns ────────────────────────────────────────────────────
  exam: ["exam", "catalog-exam", "client-dashboard", "categories"],
  "exam-countdown": ["exam-countdown", "catalog-course", "client-dashboard"],

  // Recorded video/lecture: embedded in course detail + category-video listings.
  video: ["video", "catalog-course", "categories", "free"],
  material: ["material", "categories", "catalog-package", "catalog-course"],

  // ── CMS (mostly self-contained; banner/testimonial also hit the dashboard) ─
  banner: ["banner", "cms", "client-dashboard"],
  testimonial: ["testimonial", "cms", "client-dashboard"],
  // Flat, single-entity CMS surfaces — only their own client endpoint.
  faq: ["faq", "cms"],
  popup: ["popup", "cms"],
  terms: ["terms", "cms"],
  "social-link": ["social-link", "cms"],
  "current-affair": ["current-affair", "cms"],
};

/**
 * Resolve a group name to its entity list. Unknown group → just the name itself
 * (so it still flushes its own cache, never throws in a request path).
 */
export const resolveFlushGroup = (name: CacheEntity): CacheEntity[] =>
  FLUSH_GROUPS[name] ?? [name];
