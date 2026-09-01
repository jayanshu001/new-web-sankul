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
  | "test-series"
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
  // Offline centres/batches/cities (ws_offline_*) — the physical-centre catalog.
  | "offline"
  // Customer reference lookups: states, districts (ws_customer_distict),
  // educations and target goals. Shared, slow-moving, read by the profile and
  // address forms.
  | "customer-lookup"
  | "image-notification"
  | "contact-department"
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
  | "cart"
  // Admin dashboard (scope:"shared", 2-min TTL). Deliberately NOT in any
  // FLUSH_GROUPS entry: it aggregates live revenue across every product, so an
  // admin write would flush it constantly and the TTL would never do its job.
  // Two minutes of staleness is the accepted trade — see dashboard.routes.ts.
  | "admin-dashboard";

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

  // Book: flat client detail/list + dashboard trending-book + ec listings. Also
  // "cart" — the client cart embeds LIVE book price rows (discounted_price /
  // list_price / shipping_price), so an admin price edit must stale cart reads.
  book: ["book", "catalog-book", "client-dashboard", "exam-countdown", "cart"],

  // Course: client course detail/list + dashboard course sections + free-courses
  // (course+package merge) + ec product listings + category tabs.
  course: ["course", "catalog-course", "client-dashboard", "free", "exam-countdown", "categories"],

  // Package: client package detail/list + dashboard "recently added" + free +
  // ec listings + package-category listings + category tabs. "package-category"
  // is required: GET /client/package-categories derives `packageCount` from
  // ws_package.package_category_id, so attaching/detaching a package (or
  // toggling its status) restates every category card's count.
  package: ["package", "catalog-package", "client-dashboard", "free", "exam-countdown", "categories", "package-category"],

  // Live course: merged into free-courses + dashboard-adjacent + category tabs.
  // Also the package-category pair, because live courses carry
  // package_category_id: "package-category" is the OTHER half of that listing's
  // `packageCount` (recorded + live), and "catalog-package" tags
  // GET /client/package-categories/:id/packages, whose `live` tab and `counts`
  // are built from live courses.
  "live-course": ["live-course", "catalog-course", "client-dashboard", "free", "categories", "package-category", "catalog-package"],

  // Test series: SELF-CONTAINED. Verified — no other cached client surface embeds
  // test-series data (it is absent from client-dashboard, free, categories and
  // every catalog-* response), so this group is deliberately just itself. The tag
  // covers all three cached client reads (list, detail, papers), whose bodies
  // embed the series row, its content categories, its papers and its price plans
  // — which is why EVERY admin test-series write flushes the whole tag rather
  // than trying to be surgical about which sub-resource changed.
  "test-series": ["test-series"],

  // Offline: the four cached client/offline reads PLUS
  // GET /client/address/cities/:cityId/centers, which is a second entry point to
  // the SAME offline centre data (it calls getCentersWithBatchesByCitiesMysql,
  // the twin of client/offline's listCentersByCity). One tag covers both.
  offline: ["offline"],

  // Customer lookups: states / districts / educations / target goals. Written
  // from TWO admin surfaces (admin/address and admin/customer-master), both of
  // which now flush this tag.
  "customer-lookup": ["customer-lookup"],

  "image-notification": ["image-notification"],
  "contact-department": ["contact-department"],

  // ── Categories (widest fan-out: embedded as summaries+counts in BOTH package
  //    and course details, plus their own listings and tabs) ─────────────────
  // ⚠ These groups must also carry the ADMIN product tags ("course", "package")
  // and, for material, the sibling content tag ("material"). Same reasoning as
  // plan/price above, which was fixed long ago while categories were missed:
  // the admin product DTOs POPULATE category names, they don't just store ids.
  //   admin-course.service.ts toCourseDto →
  //     courseSubjectCategoryId: {_id,title}, videoCategoryId: {_id,title},
  //     materialCategories[].category {_id,title,image}, examCategories[].category
  //   admin-package.service.ts → the same three refs (L149/153/157), where
  //     material's `title` is literally MaterialCategory.name
  // So renaming a category left GET /admin/courses, /admin/courses/:id,
  // /admin/packages and /admin/packages/:id showing the OLD name for 24h.
  // "material" is required for material-category specifically because 8 cached
  // reads tagged "material" render category titles — client-material.service.ts
  // L311 (`title: c.name`) and catalog-material.transformer.ts (`title: row.name`).
  "video-category": ["video-category", "catalog-package", "catalog-course", "categories", "free", "course", "package"],
  "material-category": ["material-category", "catalog-package", "catalog-course", "categories", "free", "material", "course", "package"],
  "exam-category": ["exam-category", "catalog-package", "catalog-course", "catalog-exam", "categories", "course", "package"],
  "course-subject-category": ["course-subject-category", "catalog-course", "client-dashboard", "course"],
  // package-category deliberately NOT extended: admin-package.service.ts L123
  // emits `packageCategoryId` as a BARE id string, never a populated name — so
  // renaming a package category cannot stale the package DTO.
  "package-category": ["package-category", "catalog-package", "categories"],

  // ── Lookups embedded in product responses ─────────────────────────────────
  "package-type": ["package-type", "catalog-package", "client-dashboard"],
  // "customer-lookup" is required: admin/goal writes prisma.customerTargetGoal,
  // and GET /client/address/characteristic embeds those same rows via
  // getActiveGoals(). Without it, editing a goal leaves that lookup stale.
  goal: ["goal", "catalog-package", "client-dashboard", "customer-lookup"],
  educator: ["educator", "catalog-course"],

  // Plans/prices are embedded in EVERY product response + dashboard buckets.
  // Also the ADMIN product reads: GET /admin/courses/:id and GET /admin/ebooks/:id
  // return `plans[]`, and the GET /admin/packages list embeds withMaterial/
  // withoutMaterial plan buckets — all cached. Without "course"/"package"/"ebook"
  // here, a plan edit (or a Most Popular pin, which routes through autoFlush("plan"))
  // stays invisible to the admin panel for the full 24h TTL.
  plan: ["plan", "course", "package", "ebook", "catalog-package", "catalog-course", "catalog-ebook", "client-dashboard", "free"],
  price: ["price", "course", "package", "ebook", "catalog-package", "catalog-course", "catalog-ebook", "client-dashboard", "free"],
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
  // Terms is NOT flat any more: since the book T&C fallback (catalog-book.service
  // → getModuleTermsText("book")), the client book list/detail embed the
  // module='book' terms text whenever the book row has none of its own. Editing
  // the global terms therefore stales every cached book read.
  terms: ["terms", "cms", "catalog-book"],
  "social-link": ["social-link", "cms"],
  "current-affair": ["current-affair", "cms"],
};

/**
 * Resolve a group name to its entity list. Unknown group → just the name itself
 * (so it still flushes its own cache, never throws in a request path).
 */
export const resolveFlushGroup = (name: CacheEntity): CacheEntity[] =>
  FLUSH_GROUPS[name] ?? [name];
