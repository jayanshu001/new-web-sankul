// src/middlewares/flushGroups.ts
//
// Flush groups — the map of "when an admin edits X, which cached reads (admin
// AND client) go stale and must be cleared". One place defines every admin→
// client cache dependency, so route files just say `autoFlushGroup(CacheEntity.Ebook)`
// instead of repeating long entity lists.
//
// The lists below are grounded in the actual client catalog code (Prisma
// includes + transformers), NOT guessed. See cache/FLUSH_GROUP_MAP.md for the
// evidence behind each entry.
//
// Entity tag naming: these are the `entity` tags used in
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
 * values used in `cacheRoute({ entity })`, `autoFlush(...)`, `flushEntity(...)`,
 * `resolveFlushGroup(...)` and the flush-group keys below — a real enum (not a
 * bare string union) so every call site imports and reuses ONE symbol
 * (`CacheEntity.Ebook`) instead of retyping the string, and a typo is a
 * compile error instead of a silent no-op flush. Add new tags here first.
 *
 * String values are the literal Redis key segment (see cacheRoute.buildKey) —
 * never change an existing member's value, only add new members, or every
 * previously-cached key for that entity silently stops matching its flush.
 */
export enum CacheEntity {
  // Admin + shared masters
  Ebook = "ebook",
  Book = "book",
  Course = "course",
  Package = "package",
  LiveCourse = "live-course",
  TestSeries = "test-series",
  Exam = "exam",
  Video = "video",
  Material = "material",
  Goal = "goal",
  Educator = "educator",
  PackageType = "package-type",
  Plan = "plan",
  Price = "price",
  PromoCode = "promo-code",
  ExamCountdown = "exam-countdown",
  VideoCategory = "video-category",
  MaterialCategory = "material-category",
  ExamCategory = "exam-category",
  CourseSubjectCategory = "course-subject-category",
  PackageCategory = "package-category",
  Banner = "banner",
  Testimonial = "testimonial",
  Faq = "faq",
  Popup = "popup",
  Terms = "terms",
  SocialLink = "social-link",
  CurrentAffair = "current-affair",
  // Offline centres/batches/cities (ws_offline_*) — the physical-centre catalog.
  Offline = "offline",
  // Customer reference lookups: states, districts (ws_customer_distict),
  // educations and target goals. Shared, slow-moving, read by the profile and
  // address forms.
  CustomerLookup = "customer-lookup",
  ImageNotification = "image-notification",
  ContactDepartment = "contact-department",
  // Client-facing catalog cache tags
  CatalogEbook = "catalog-ebook",
  CatalogBook = "catalog-book",
  CatalogCourse = "catalog-course",
  CatalogPackage = "catalog-package",
  CatalogExam = "catalog-exam",
  ClientDashboard = "client-dashboard",
  Categories = "categories",
  Free = "free",
  Cms = "cms",
  // Per-user client caches (CacheScope.User, short TTL)
  Cart = "cart",
  // Admin dashboard (CacheScope.Shared, 2-min TTL). Deliberately NOT in any
  // FLUSH_GROUPS entry: it aggregates live revenue across every product, so an
  // admin write would flush it constantly and the TTL would never do its job.
  // Two minutes of staleness is the accepted trade — see dashboard.routes.ts.
  AdminDashboard = "admin-dashboard",
  // Fallback bucket for a `cacheRoute()` call with no `entity` — still
  // cacheable, just not reachable by any entity-scoped flush.
  Misc = "misc",
}

/**
 * `FLUSH_GROUPS[x]` = every cache entity tag to clear when entity `x` is
 * written by an admin. Always includes `x` itself (the admin-side cache) plus
 * the client-facing caches that embed `x`'s data.
 */
export const FLUSH_GROUPS: Partial<Record<CacheEntity, CacheEntity[]>> = {
  // ── Products ──────────────────────────────────────────────────────────────
  // Ebook: flat client detail/list + dashboard trending-ebook + free-ebooks +
  // exam-countdown book/ebook listings. NOT package/course (no embed).
  [CacheEntity.Ebook]: [CacheEntity.Ebook, CacheEntity.CatalogEbook, CacheEntity.ClientDashboard, CacheEntity.Free, CacheEntity.ExamCountdown],

  // Book: flat client detail/list + dashboard trending-book + ec listings. Also
  // "cart" — the client cart embeds LIVE book price rows (discounted_price /
  // list_price / shipping_price), so an admin price edit must stale cart reads.
  [CacheEntity.Book]: [CacheEntity.Book, CacheEntity.CatalogBook, CacheEntity.ClientDashboard, CacheEntity.ExamCountdown, CacheEntity.Cart],

  // Course: client course detail/list + dashboard course sections + free-courses
  // (course+package merge) + ec product listings + category tabs.
  [CacheEntity.Course]: [CacheEntity.Course, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard, CacheEntity.Free, CacheEntity.ExamCountdown, CacheEntity.Categories],

  // Package: client package detail/list + dashboard "recently added" + free +
  // ec listings + package-category listings + category tabs. "package-category"
  // is required: GET /client/package-categories derives `packageCount` from
  // ws_package.package_category_id, so attaching/detaching a package (or
  // toggling its status) restates every category card's count.
  [CacheEntity.Package]: [
    CacheEntity.Package, CacheEntity.CatalogPackage, CacheEntity.ClientDashboard, CacheEntity.Free,
    CacheEntity.ExamCountdown, CacheEntity.Categories, CacheEntity.PackageCategory,
  ],

  // Live course: merged into free-courses + dashboard-adjacent + category tabs.
  // Also the package-category pair, because live courses carry
  // package_category_id: "package-category" is the OTHER half of that listing's
  // `packageCount` (recorded + live), and "catalog-package" tags
  // GET /client/package-categories/:id/packages, whose `live` tab and `counts`
  // are built from live courses.
  [CacheEntity.LiveCourse]: [
    CacheEntity.LiveCourse, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard, CacheEntity.Free,
    CacheEntity.Categories, CacheEntity.PackageCategory, CacheEntity.CatalogPackage,
  ],

  // Test series: SELF-CONTAINED. Verified — no other cached client surface embeds
  // test-series data (it is absent from client-dashboard, free, categories and
  // every catalog-* response), so this group is deliberately just itself. The tag
  // covers all three cached client reads (list, detail, papers), whose bodies
  // embed the series row, its content categories, its papers and its price plans
  // — which is why EVERY admin test-series write flushes the whole tag rather
  // than trying to be surgical about which sub-resource changed.
  [CacheEntity.TestSeries]: [CacheEntity.TestSeries],

  // Offline: the four cached client/offline reads PLUS
  // GET /client/address/cities/:cityId/centers, which is a second entry point to
  // the SAME offline centre data (it calls getCentersWithBatchesByCitiesMysql,
  // the twin of client/offline's listCentersByCity). One tag covers both.
  [CacheEntity.Offline]: [CacheEntity.Offline],

  // Customer lookups: states / districts / educations / target goals. Written
  // from TWO admin surfaces (admin/address and admin/customer-master), both of
  // which now flush this tag.
  [CacheEntity.CustomerLookup]: [CacheEntity.CustomerLookup],

  [CacheEntity.ImageNotification]: [CacheEntity.ImageNotification],
  // Terms: GET /client/terms embeds the mapped department's contacts as the
  // module helpline (terms.service TERMS_HELPLINE_DEPARTMENT), so editing a
  // department must stale cached terms too.
  [CacheEntity.ContactDepartment]: [CacheEntity.ContactDepartment, CacheEntity.Terms],

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
  [CacheEntity.VideoCategory]: [
    CacheEntity.VideoCategory, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse,
    CacheEntity.Categories, CacheEntity.Free, CacheEntity.Course, CacheEntity.Package,
  ],
  [CacheEntity.MaterialCategory]: [
    CacheEntity.MaterialCategory, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse, CacheEntity.Categories,
    CacheEntity.Free, CacheEntity.Material, CacheEntity.Course, CacheEntity.Package,
  ],
  [CacheEntity.ExamCategory]: [
    CacheEntity.ExamCategory, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse, CacheEntity.CatalogExam,
    CacheEntity.Categories, CacheEntity.Course, CacheEntity.Package,
  ],
  [CacheEntity.CourseSubjectCategory]: [CacheEntity.CourseSubjectCategory, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard, CacheEntity.Course],
  // package-category deliberately NOT extended: admin-package.service.ts L123
  // emits `packageCategoryId` as a BARE id string, never a populated name — so
  // renaming a package category cannot stale the package DTO.
  [CacheEntity.PackageCategory]: [CacheEntity.PackageCategory, CacheEntity.CatalogPackage, CacheEntity.Categories],

  // ── Lookups embedded in product responses ─────────────────────────────────
  [CacheEntity.PackageType]: [CacheEntity.PackageType, CacheEntity.CatalogPackage, CacheEntity.ClientDashboard],
  // "customer-lookup" is required: admin/goal writes prisma.customerTargetGoal,
  // and GET /client/address/characteristic embeds those same rows via
  // getActiveGoals(). Without it, editing a goal leaves that lookup stale.
  [CacheEntity.Goal]: [CacheEntity.Goal, CacheEntity.CatalogPackage, CacheEntity.ClientDashboard, CacheEntity.CustomerLookup],
  [CacheEntity.Educator]: [CacheEntity.Educator, CacheEntity.CatalogCourse],

  // Plans/prices are embedded in EVERY product response + dashboard buckets.
  // Also the ADMIN product reads: GET /admin/courses/:id and GET /admin/ebooks/:id
  // return `plans[]`, and the GET /admin/packages list embeds withMaterial/
  // withoutMaterial plan buckets — all cached. Without "course"/"package"/"ebook"
  // here, a plan edit (or a Most Popular pin, which routes through autoFlush(CacheEntity.Plan))
  // stays invisible to the admin panel for the full 24h TTL.
  [CacheEntity.Plan]: [
    CacheEntity.Plan, CacheEntity.Course, CacheEntity.Package, CacheEntity.Ebook, CacheEntity.CatalogPackage,
    CacheEntity.CatalogCourse, CacheEntity.CatalogEbook, CacheEntity.ClientDashboard, CacheEntity.Free,
  ],
  [CacheEntity.Price]: [
    CacheEntity.Price, CacheEntity.Course, CacheEntity.Package, CacheEntity.Ebook, CacheEntity.CatalogPackage,
    CacheEntity.CatalogCourse, CacheEntity.CatalogEbook, CacheEntity.ClientDashboard, CacheEntity.Free,
  ],
  [CacheEntity.PromoCode]: [CacheEntity.PromoCode, CacheEntity.CatalogPackage],

  // ── Exams / countdowns ────────────────────────────────────────────────────
  [CacheEntity.Exam]: [CacheEntity.Exam, CacheEntity.CatalogExam, CacheEntity.ClientDashboard, CacheEntity.Categories],
  [CacheEntity.ExamCountdown]: [CacheEntity.ExamCountdown, CacheEntity.CatalogCourse, CacheEntity.ClientDashboard],

  // Recorded video/lecture: embedded in course detail + category-video listings.
  [CacheEntity.Video]: [CacheEntity.Video, CacheEntity.CatalogCourse, CacheEntity.Categories, CacheEntity.Free],
  [CacheEntity.Material]: [CacheEntity.Material, CacheEntity.Categories, CacheEntity.CatalogPackage, CacheEntity.CatalogCourse],

  // ── CMS (mostly self-contained; banner/testimonial also hit the dashboard) ─
  [CacheEntity.Banner]: [CacheEntity.Banner, CacheEntity.Cms, CacheEntity.ClientDashboard],
  [CacheEntity.Testimonial]: [CacheEntity.Testimonial, CacheEntity.Cms, CacheEntity.ClientDashboard],
  // Flat, single-entity CMS surfaces — only their own client endpoint.
  [CacheEntity.Faq]: [CacheEntity.Faq, CacheEntity.Cms],
  [CacheEntity.Popup]: [CacheEntity.Popup, CacheEntity.Cms],
  // Terms is NOT flat any more: since the book T&C fallback (catalog-book.service
  // → getModuleTermsText("book")), the client book list/detail embed the
  // module='book' terms text whenever the book row has none of its own. Editing
  // the global terms therefore stales every cached book read.
  [CacheEntity.Terms]: [CacheEntity.Terms, CacheEntity.Cms, CacheEntity.CatalogBook],
  [CacheEntity.SocialLink]: [CacheEntity.SocialLink, CacheEntity.Cms],
  [CacheEntity.CurrentAffair]: [CacheEntity.CurrentAffair, CacheEntity.Cms],
};

/**
 * Resolve a group name to its entity list. Unknown group → just the name itself
 * (so it still flushes its own cache, never throws in a request path).
 */
export const resolveFlushGroup = (name: CacheEntity): CacheEntity[] =>
  FLUSH_GROUPS[name] ?? [name];
