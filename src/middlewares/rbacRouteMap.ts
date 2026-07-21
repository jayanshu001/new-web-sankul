// src/middlewares/rbacRouteMap.ts
//
// Declarative route → permission-key map for admin RBAC enforcement (backend
// request rbac-module-visibility.md §4). One auditable table instead of editing
// ~35 route files; the FE/backend teams can diff it against the permission
// catalog (admin/permission/permissions.catalog.ts).
//
// `resolveRequiredKeys(method, relPath)` returns the catalog keys that gate a
// request (OR-semantics: holding ANY one grants access), or `null` when no rule
// matches. The middleware (middlewares/rbacEnforce.ts) treats `null` as
// "unmapped" — logged as a coverage gap and ALLOWED, so an incomplete map can
// never lock the panel out; enforcement only ever denies an explicitly-mapped
// route whose key the caller lacks.
//
// relPath is the admin-router-relative path, e.g. "/books/123/status" (the
// mount prefix "/api/v1/admin" already stripped by the middleware).
//
// Rules are evaluated top-to-bottom, FIRST MATCH WINS — so register specific
// sub-resource paths BEFORE the generic ":id" CRUD rules. `:param` segments
// match a single path segment.

interface Rule {
  methods: Set<string>;
  re: RegExp;
  keys: string[];
}

const rules: Rule[] = [];

/** Register a rule. `method` may be pipe-joined ("PUT|PATCH"). */
const R = (method: string, path: string, ...keys: string[]): void => {
  const methods = new Set(method.split("|").map((m) => m.toUpperCase()));
  const re = new RegExp("^" + path.replace(/:[^/]+/g, "[^/]+") + "/?$");
  rules.push({ methods, re, keys });
};

// Read access gates on `<m>.view` only. `list` was dropped from the `web` catalog
// 2026-07-20 (the admin UI gates every list screen on `view`), so it must not be
// enforced here either — otherwise the cleanup would keep the now-orphan `.list`
// rows alive in the catalog API response.
const view = (m: string): string[] => [`${m}.view`];

/**
 * Standard CRUD rules for a REST resource mounted at `base` and gated by module
 * key `m`: list/read → view|list, POST → create, PUT/PATCH :id → edit, DELETE
 * → delete, PATCH :id/status → toggle-status. Call AFTER any resource-specific
 * R() rules so those win the first-match.
 */
const crud = (base: string, m: string): void => {
  R("PATCH", `${base}/:id/status`, `${m}.toggle-status`);
  R("GET", base, ...view(m));
  R("POST", base, `${m}.create`);
  R("GET", `${base}/:id`, ...view(m));
  R("PUT|PATCH", `${base}/:id`, `${m}.edit`);
  R("DELETE", `${base}/:id`, `${m}.delete`);
};

// ── /administrators → administrators ───────────────────────────────────────
R("GET", "/administrators/pre-requisites", ...view("administrators"));
R("PATCH", "/administrators/:id/status", "administrators.toggle-status");
crud("/administrators", "administrators");

// ── /roles → roles ─────────────────────────────────────────────────────────
R("GET", "/roles/:id/permissions", ...view("roles"));
R("PUT", "/roles/:id/permissions", "roles.edit"); // was roles.assign-permissions
crud("/roles", "roles");

// ── /permissions → permissions (read-only catalog) ─────────────────────────
R("GET", "/permissions/catalog", ...view("permissions"));
R("GET", "/permissions/:id/roles", ...view("permissions"));
crud("/permissions", "permissions"); // create/edit/delete are 410'd upstream

// ── /permission-categories → permission-categories (read-only) ─────────────
crud("/permission-categories", "permission-categories");

// ── /guards → guards (read-only) ───────────────────────────────────────────
R("GET", "/guards", ...view("guards"));

// ── /video-categories → videos.categories ──────────────────────────────────
// Collapsed 2026-07-20: the legacy `video-categories` catalog module was dropped
// (keep-list keeps `videos.categories`); these routes now gate on that key.
R("GET", "/video-categories/pre-requisites", ...view("videos.categories"));
R("GET", "/video-categories/:id/courses", ...view("videos.categories"));
R("GET", "/video-categories/:id/videos", ...view("videos.categories"));
R("POST", "/video-categories/:id/duplicate", "videos.categories.create"); // was .duplicate
crud("/video-categories", "videos.categories");

// ── /videos → videos ───────────────────────────────────────────────────────
R("GET", "/videos/pre-requisites", ...view("videos"));
R("POST", "/videos/reorder", "videos.edit");
crud("/videos", "videos");

// ── /goals → goals ─────────────────────────────────────────────────────────
crud("/goals", "goals");

// ── /courses → courses (+ nested video-categories, materials, plans, videos) ─
// Nested course sub-resources (video-categories, materials, videos, plans)
// collapsed 2026-07-20 into the parent `courses` key — the admin panel gates the
// whole Courses section on `courses.*`, so those sub-namespaces were dropped.
R("GET", "/courses/pre-requisites", ...view("courses"));
R("GET|POST", "/courses/video-category-relations", "courses.edit");
R("PUT|DELETE", "/courses/video-category-relations/:id", "courses.edit");
R("GET", "/courses/video-categories", ...view("courses"));
R("POST", "/courses/video-categories", "courses.create");
R("PUT", "/courses/video-categories/:id", "courses.edit");
R("DELETE", "/courses/video-categories/:id", "courses.delete");
R("GET", "/courses/materials", ...view("courses"));
R("POST", "/courses/materials", "courses.create");
R("PUT", "/courses/materials/:id", "courses.edit");
R("DELETE", "/courses/materials/:id", "courses.delete");
R("GET", "/courses/videos", ...view("courses"));
R("POST", "/courses/videos/reorder", "courses.edit");
R("POST", "/courses/videos", "courses.create");
R("GET", "/courses/videos/:id", ...view("courses"));
R("PUT", "/courses/videos/:id", "courses.edit");
R("DELETE", "/courses/videos/:id", "courses.delete");
R("GET", "/courses/plans/:id", ...view("courses"));
R("PUT", "/courses/plans/:id", "courses.edit");
R("DELETE", "/courses/plans/:id", "courses.delete");
R("GET", "/courses/:id/plans", ...view("courses"));
R("POST", "/courses/:id/plans", "courses.create");
R("GET", "/courses/:id/promocodes", ...view("courses"));
R("GET", "/courses/:id/exam-categories", ...view("courses"));
R("GET", "/courses/:id/material-categories", ...view("courses"));
R("PATCH", "/courses/:id/popular", "courses.edit");
crud("/courses", "courses");

// ── /master → educators / subject-categories / materials / video-categories /
//    package-categories ──────────────────────────────────────────────────────
R("GET", "/master/educators/:id/details", ...view("educators"));
R("GET", "/master/educators", ...view("educators"));
R("POST", "/master/educators", "educators.create");
R("PUT", "/master/educators/:id", "educators.edit");
R("DELETE", "/master/educators/:id", "educators.delete");
R("GET", "/master/subject-categories", ...view("subject-categories"));
R("POST", "/master/subject-categories", "subject-categories.create");
R("PUT", "/master/subject-categories/:id", "subject-categories.edit");
R("DELETE", "/master/subject-categories/:id", "subject-categories.delete");
R("GET", "/master/materials", ...view("materials"));
R("POST", "/master/materials", "materials.create");
R("PUT", "/master/materials/:id", "materials.edit");
R("DELETE", "/master/materials/:id", "materials.delete");

// ── /pc-materials → pc-materials (Master Data) ─────────────────────────────
crud("/pc-materials", "pc-materials");
R("GET", "/master/video-categories", ...view("videos.categories"));
R("POST", "/master/video-categories", "videos.categories.create");
R("PUT", "/master/video-categories/:id", "videos.categories.edit");
R("DELETE", "/master/video-categories/:id", "videos.categories.delete");
R("GET", "/master/package-categories", ...view("package-categories"));
R("POST", "/master/package-categories", "package-categories.create");
R("PUT", "/master/package-categories/:id", "package-categories.edit");
R("DELETE", "/master/package-categories/:id", "package-categories.delete");

// ── /ebooks → ebooks (+ plans, subscriptions) ──────────────────────────────
R("GET|POST", "/ebooks/reorder", "ebooks.edit");
R("GET", "/ebooks/pdf-jobs/:id", ...view("ebooks"));
R("POST", "/ebooks/:id/pdf", "ebooks.edit");
R("PATCH", "/ebooks/:id/trending", "ebooks.edit");
R("GET", "/ebooks/subscriptions/list", ...view("ebooks.subscriptions"));
// ebooks.subscriptions is a view-only report; its write routes gate on parent `ebooks`.
R("POST", "/ebooks/subscriptions", "ebooks.create");
R("GET", "/ebooks/subscriptions/:id", ...view("ebooks.subscriptions"));
R("PUT", "/ebooks/subscriptions/:id", "ebooks.edit");
R("DELETE", "/ebooks/subscriptions/:id", "ebooks.delete");
// ebooks.plans collapsed 2026-07-20 into parent `ebooks`.
R("GET", "/ebooks/plans/:id", ...view("ebooks"));
R("PUT", "/ebooks/plans/:id", "ebooks.edit");
R("DELETE", "/ebooks/plans/:id", "ebooks.delete");
R("GET", "/ebooks/:id/plans", ...view("ebooks"));
R("POST", "/ebooks/:id/plans", "ebooks.create");
R("GET", "/ebooks/:id/prices", ...view("ebooks"));
R("GET", "/ebooks/:id/promocodes", ...view("ebooks"));
crud("/ebooks", "ebooks");

// ── /customers → customers (+ addresses, course/ebook subscriptions) ───────
R("GET", "/customers/pre-requisites", ...view("customers"));
R("GET", "/customers/states/:id/districts", ...view("customers"));
R("GET", "/customers/:id/details", ...view("customers")); // was customers.view-details
// customers sub-resources (addresses, course/ebook subscriptions) collapsed
// 2026-07-20 into the parent `customers` key.
R("GET", "/customers/:id/addresses", ...view("customers"));
R("GET", "/customers/:id/course-subscriptions", ...view("customers"));
R("PUT", "/customers/:id/course-subscriptions/:sid", "customers.edit");
R("GET", "/customers/:id/ebook-subscriptions", ...view("customers"));
crud("/customers", "customers");

// ── /customer-masters → collapsed into `customers` ─────────────────────────
// The `customer-masters.*` catalog modules were dropped 2026-07-20 (keep-list:
// "the panel uses customers.*, never customer-masters"). These master-data routes
// now gate on the parent `customers` key.
R("GET", "/customer-masters/districts", ...view("customers"));
R("POST", "/customer-masters/districts", "customers.create");
R("PUT", "/customer-masters/districts/:id", "customers.edit");
R("DELETE", "/customer-masters/districts/:id", "customers.delete");
R("GET", "/customer-masters/educations", ...view("customers"));
R("POST", "/customer-masters/educations", "customers.create");
R("PUT", "/customer-masters/educations/:id", "customers.edit");
R("DELETE", "/customer-masters/educations/:id", "customers.delete");
R("GET", "/customer-masters/target-goals", ...view("customers"));
R("POST", "/customer-masters/target-goals", "customers.create");
R("PUT", "/customer-masters/target-goals/:id", "customers.edit");
R("DELETE", "/customer-masters/target-goals/:id", "customers.delete");

// ── /referrals → referrers / report / transactions / terms / faqs ──────────
// NOTE: "programs" has no catalog module yet — mapped to referrals.settings as
// the closest configuration surface; revisit if a dedicated key is added.
R("GET", "/referrals/programs", "referrals.settings.view"); // module ships view/edit only
R("POST|PUT|DELETE", "/referrals/programs", "referrals.settings.edit");
R("POST|PUT|DELETE", "/referrals/programs/:id", "referrals.settings.edit");
R("GET", "/referrals/referrers", ...view("referrals.referrers"));
R("GET", "/referrals/transactions", ...view("referrals.transactions"));
// referrals.transactions + referrals.report are view-only reports; their write
// actions (approve/process transactions & withdrawals) gate on referrals.settings.edit.
R("PATCH", "/referrals/transactions/:id", "referrals.settings.edit");
R("POST", "/referrals/transactions", "referrals.settings.edit");
R("GET", "/referrals/withdrawals/csv", ...view("referrals.report")); // was report.export
R("GET", "/referrals/withdrawals", ...view("referrals.report"));
R("POST", "/referrals/withdrawals/:id", "referrals.settings.edit");
R("GET", "/referrals/terms", ...view("referrals.terms"));
R("POST", "/referrals/terms", "referrals.terms.create");
R("GET", "/referrals/terms/:id", ...view("referrals.terms"));
R("PUT", "/referrals/terms/:id", "referrals.terms.edit");
R("DELETE", "/referrals/terms/:id", "referrals.terms.delete");
R("GET", "/referrals/faqs", ...view("referrals.faqs"));
R("POST", "/referrals/faqs", "referrals.faqs.create");
R("GET", "/referrals/faqs/:id", ...view("referrals.faqs"));
R("PUT", "/referrals/faqs/:id", "referrals.faqs.edit");
R("DELETE", "/referrals/faqs/:id", "referrals.faqs.delete");

// ── /books → books (+ orders) ──────────────────────────────────────────────
R("POST", "/books/reorder", "books.edit");
// Free-delivery settings screen — the book-terms free-shipping threshold. Gated
// by its own cms.free-delivery keys (NOT books.*) so it can be granted
// independently. Registered before crud("/books") so :id can't shadow it.
R("GET", "/books/settings", "cms.free-delivery.view");
R("PUT", "/books/settings", "cms.free-delivery.edit");
R("GET", "/books/orders/list", ...view("books.orders"));
R("GET", "/books/orders/:id", ...view("books.orders"));
R("PATCH", "/books/orders/:id/status", "books.edit");
R("PATCH", "/books/orders/:id/tracking", "books.edit");
R("POST", "/books/orders/:id/tracking/events", "books.edit");
R("PATCH", "/books/:id/trending", "books.edit");
crud("/books", "books");

// ── /quizzes (exam) → quizzes (+ categories, questions, submissions, analytics)
R("GET", "/quizzes/categories/tree", ...view("quizzes.categories"));
R("GET", "/quizzes/categories/:id/packages", ...view("quizzes.categories"));
R("GET", "/quizzes/categories/:id/courses", ...view("quizzes.categories"));
R("GET", "/quizzes/categories", ...view("quizzes.categories"));
R("POST", "/quizzes/categories", "quizzes.categories.create");
R("GET", "/quizzes/categories/:id", ...view("quizzes.categories"));
R("PUT", "/quizzes/categories/:id", "quizzes.categories.edit");
R("DELETE", "/quizzes/categories/:id", "quizzes.categories.delete");
// quizzes sub-resources (questions, submissions, analytics) collapsed 2026-07-20
// into the parent `quizzes` key.
R("GET", "/quizzes/questions/list", ...view("quizzes"));
R("POST", "/quizzes/questions/bulk", "quizzes.edit");
R("POST", "/quizzes/questions/reorder", "quizzes.edit");
R("POST", "/quizzes/questions", "quizzes.create");
R("GET", "/quizzes/questions/:id", ...view("quizzes"));
R("PUT", "/quizzes/questions/:id", "quizzes.edit");
R("DELETE", "/quizzes/questions/:id", "quizzes.delete");
R("GET", "/quizzes/:id/submissions", ...view("quizzes"));
R("GET", "/quizzes/:id/analytics", ...view("quizzes"));
R("GET", "/quizzes/results/:id", ...view("quizzes"));
R("PATCH", "/quizzes/results/:id/invalidate", "quizzes.edit");
R("GET", "/quizzes/analytics/customer/:id", ...view("quizzes"));
R("POST", "/quizzes/reorder", "quizzes.edit");
crud("/quizzes", "quizzes");

// ── /materials (study materials + categories) ──────────────────────────────
// NOTE: this mount is the Study Materials module (has categories + bulk ops);
// master-data "Materials" lives under /master/materials above.
R("GET", "/materials/categories", ...view("study-materials.categories"));
R("POST", "/materials/categories/reorder", "study-materials.categories.edit");
R("POST", "/materials/categories/:id/duplicate", "study-materials.categories.create"); // was .duplicate
R("GET", "/materials/categories/:id/courses", ...view("study-materials.categories"));
R("GET", "/materials/categories/:id/materials", ...view("study-materials.categories"));
R("PATCH", "/materials/categories/:id/status", "study-materials.categories.toggle-status");
R("POST", "/materials/categories", "study-materials.categories.create");
R("GET", "/materials/categories/:id", ...view("study-materials.categories"));
R("PUT", "/materials/categories/:id", "study-materials.categories.edit");
R("DELETE", "/materials/categories/:id", "study-materials.categories.delete");
R("POST", "/materials/reorder", "study-materials.edit");
R("POST", "/materials/bulk-status", "study-materials.edit");
R("POST", "/materials/bulk-delete", "study-materials.delete");
crud("/materials", "study-materials");

// ── /packages → packages (+ types, plans) ──────────────────────────────────
R("GET", "/packages/types", ...view("packages.types"));
R("POST", "/packages/types", "packages.types.create");
R("PUT", "/packages/types/:id", "packages.types.edit");
R("DELETE", "/packages/types/:id", "packages.types.delete");
R("POST", "/packages/reorder", "packages.edit");
// packages.plans collapsed 2026-07-20 into parent `packages` (attach/detach → edit).
R("GET", "/packages/:id/plans", ...view("packages"));
R("POST", "/packages/:id/plans/attach", "packages.edit");
R("DELETE", "/packages/:id/plans/:pid", "packages.edit");
R("PATCH", "/packages/:id/specific-subjects/reorder", "packages.edit");
R("PATCH", "/packages/:id/material-categories/reorder", "packages.edit");
R("PATCH", "/packages/:id/exam-categories/reorder", "packages.edit");
R("GET", "/packages/:id/subscribers", ...view("packages"));
R("GET", "/packages/:id/exam-categories", ...view("packages"));
R("GET", "/packages/:id/material-categories", ...view("packages"));
R("GET", "/packages/:id/specific-subjects", ...view("packages"));
R("GET", "/packages/:id/promoted-codes", ...view("packages"));
R("GET", "/packages/:id/books", ...view("packages"));
R("GET", "/packages/:id/video-relations", ...view("packages"));
R("PUT", "/packages/:id/video-relations", "packages.edit");
R("POST", "/packages/:id/video-relations/expand", "packages.edit");
R("GET", "/packages/:id/chat", ...view("packages"));
R("POST", "/packages/:id/chat", "packages.edit");
R("DELETE", "/packages/chat/:id", "packages.edit");
crud("/packages", "packages");

// ── /pc-materials → (no dedicated catalog module) UNMAPPED, logged in shadow ─

// ── /plans → plans ─────────────────────────────────────────────────────────
R("POST", "/plans/bulk-status", "plans.edit");
R("POST", "/plans/bulk-delete", "plans.delete");
R("PATCH", "/plans/:id/default", "plans.edit");
R("POST", "/plans/:id/clone", "plans.create");
crud("/plans", "plans");

// ── /plan-popularity → plans (Most Popular pin) ────────────────────────────
R("POST", "/plan-popularity/pin", "plans.edit");
R("POST", "/plan-popularity/recompute", "plans.edit");

// ── /promocodes → promocodes ───────────────────────────────────────────────
R("GET", "/promocodes/plans", ...view("promocodes"));
R("POST", "/promocodes/bulk-status", "promocodes.toggle-status"); // was .bulk-status
R("POST", "/promocodes/bulk-delete", "promocodes.delete"); // was .bulk-delete
crud("/promocodes", "promocodes");

// ── /subscriptions → subscriptions (+ reports, customer addresses) ─────────
R("GET", "/subscriptions/reports/summary", ...view("subscriptions.reports"));
R("GET", "/subscriptions/reports/by-course", ...view("subscriptions.reports"));
R("GET", "/subscriptions/reports/by-ebook", ...view("subscriptions.reports"));
R("GET", "/subscriptions/reports/book-orders", ...view("subscriptions.reports"));
R("GET", "/subscriptions/ebook", ...view("subscriptions"));
R("GET", "/subscriptions/plans", ...view("subscriptions"));
// customers.addresses collapsed 2026-07-20 into parent `customers`.
R("GET", "/subscriptions/customer-addresses/:id", ...view("customers"));
R("POST", "/subscriptions/customer-addresses", "customers.create");
R("PUT", "/subscriptions/customer-addresses/:id", "customers.edit");
R("DELETE", "/subscriptions/customer-addresses/:id", "customers.delete");
crud("/subscriptions", "subscriptions");

// ── /cms → cms.* (one sub-resource per key) ────────────────────────────────
for (const [seg, key] of [
  ["faqs", "cms.faqs"],
  ["faq-types", "cms.faq-types"],
  ["popups", "cms.popups"],
  ["banners", "cms.banners"],
  ["live-banners", "cms.live-banners"],
  ["testimonials", "cms.testimonials"],
  ["social-link-types", "cms.social-link-types"],
  ["social-links", "cms.social-links"],
  ["terms", "cms.terms"],
  ["current-affairs", "cms.current-affairs"],
] as const) {
  R("POST", `/cms/${seg}/reorder`, `${key}.edit`);
  crud(`/cms/${seg}`, key);
}
R("GET", "/cms/version", "cms.app-version.view"); // module ships view/edit only
R("PUT", "/cms/version", "cms.app-version.edit");
R("GET", "/cms/app-update", "cms.app-update.view"); // module ships view/edit only
R("PUT", "/cms/app-update", "cms.app-update.edit");

// ── / (inquiry router) → inquiries / departments ───────────────────────────
R("GET", "/inquiries", ...view("inquiries"));
R("GET", "/inquiries/:id", ...view("inquiries"));
R("DELETE", "/inquiries/:id", "inquiries.delete");
crud("/departments", "departments");

// ── /notifications → notifications ─────────────────────────────────────────
R("POST", "/notifications/broadcast", "notifications.create"); // was notifications.send
R("GET", "/notifications/target-options", ...view("notifications"));
R("POST", "/notifications/bulk-delete", "notifications.delete"); // was .bulk-delete
R("POST", "/notifications/:id/cancel", "notifications.edit");
R("GET", "/notifications/images", ...view("notifications"));
R("POST", "/notifications/images", "notifications.create");
R("PUT", "/notifications/images/:id", "notifications.edit");
R("DELETE", "/notifications/images/:id", "notifications.delete");
R("GET", "/notifications", ...view("notifications"));
R("DELETE", "/notifications/:id", "notifications.delete");

// ── /offline → banners / centers / batches / enquiries ─────────────────────
R("POST", "/offline/banners/reorder", "offline.banners.edit");
crud("/offline/banners", "offline.banners");
crud("/offline/centers", "offline.centers");
crud("/offline/batches", "offline.batches");
R("GET", "/offline/enquiries", ...view("offline.enquiries"));
R("DELETE", "/offline/enquiries/:id", "offline.enquiries.delete");
R("GET", "/offline/batch-enquiries", ...view("offline.enquiries"));
R("DELETE", "/offline/batch-enquiries/:id", "offline.enquiries.delete");

// ── /promoters → promoters (+ subscriptions, dashboard) ────────────────────
R("GET", "/promoters/dashboard", ...view("promoters")); // was promoters.view-dashboard
R("GET", "/promoters/:id/dashboard", ...view("promoters")); // was promoters.view-dashboard
R("GET", "/promoters/:id/promocodes", ...view("promoters"));
R("GET", "/promoters/:id/subscriptions", ...view("promoters")); // collapsed from promoters.subscriptions 2026-07-20
crud("/promoters", "promoters");

// ── /dashboard → dashboard (read-only) ─────────────────────────────────────
R("GET", "/dashboard", "dashboard.view");

// ── /tracking → tracking (read-only) ───────────────────────────────────────
R("GET", "/tracking/summary", ...view("tracking"));
R("GET", "/tracking", ...view("tracking"));

// ── /address → states / cities ─────────────────────────────────────────────
crud("/address/states", "address.states");
crud("/address/cities", "address.cities");

// ── /exam-countdowns → exam-countdowns (+ categories) ──────────────────────
R("GET", "/exam-countdowns/categories", ...view("exam-countdowns.categories"));
R("POST", "/exam-countdowns/categories", "exam-countdowns.categories.create");
R("PUT", "/exam-countdowns/categories/:id", "exam-countdowns.categories.edit");
R("DELETE", "/exam-countdowns/categories/:id", "exam-countdowns.categories.delete");
crud("/exam-countdowns", "exam-countdowns");

// ── /live-polls → live-sessions.polls ──────────────────────────────────────
// live-sessions.polls collapsed 2026-07-20 into parent `live-sessions`.
R("POST", "/live-polls", "live-sessions.create");
R("GET", "/live-polls/:id/results", ...view("live-sessions"));
R("GET", "/live-polls/:id", ...view("live-sessions"));

// ── /live-chat → live-sessions.chat ────────────────────────────────────────
// live-sessions.chat.moderate dropped 2026-07-20 → standard actions on the chat module.
R("POST", "/live-chat/message", "live-sessions.chat.create");
R("GET", "/live-chat/bans", ...view("live-sessions.chat"));
R("POST", "/live-chat/bans", "live-sessions.chat.create");
R("DELETE", "/live-chat/bans/:id", "live-sessions.chat.delete");
R("DELETE", "/live-chat/messages/:id", "live-sessions.chat.delete");
R("GET", "/live-chat/:id/history", ...view("live-sessions.chat"));
R("GET", "/live-chat/:id/settings", ...view("live-sessions.chat"));
R("PATCH", "/live-chat/:id/settings", "live-sessions.chat.edit");

// ── /live-sessions (live) → live-sessions (+ streamos) ─────────────────────
// streamos/webhook is an external callback → UNMAPPED (allowed; it has its own
// verification and no per-user permission concept).
R("GET", "/live-sessions/streamos/org", ...view("live-sessions.streamos"));
R("GET", "/live-sessions/streamos/recordings/:id", ...view("live-sessions.streamos"));
R("POST", "/live-sessions/end", "live-sessions.edit"); // was live-sessions.end
R("POST", "/live-sessions/:id/provision", "live-sessions.edit");
R("POST", "/live-sessions/:id/start", "live-sessions.edit"); // was live-sessions.start
R("POST", "/live-sessions/:id/promote-recording", "live-sessions.edit");
R("GET", "/live-sessions/:id/attendance", ...view("live-sessions"));
R("GET", "/live-sessions/:id/recording-health", ...view("live-sessions"));
R("GET", "/live-sessions", ...view("live-sessions"));
R("POST", "/live-sessions", "live-sessions.create");
R("GET", "/live-sessions/:id", ...view("live-sessions"));
R("PATCH", "/live-sessions/:id", "live-sessions.edit");
R("DELETE", "/live-sessions/:id", "live-sessions.delete"); // was cancel|delete

// ── /live-courses → live-courses (+ plans, folders, videos, subscriptions) ─
// live-courses sub-resources (plans, folders, videos, subscriptions) collapsed
// 2026-07-20 into the parent `live-courses` key.
R("GET", "/live-courses/plans/:id", ...view("live-courses"));
R("PUT", "/live-courses/plans/:id", "live-courses.edit");
R("DELETE", "/live-courses/plans/:id", "live-courses.delete");
R("GET", "/live-courses/subscriptions", ...view("live-courses"));
R("GET", "/live-courses/subscriptions/:id", ...view("live-courses"));
R("PUT", "/live-courses/subscriptions/:id", "live-courses.edit");
R("DELETE", "/live-courses/subscriptions/:id", "live-courses.delete");
R("GET", "/live-courses/:id/sessions", ...view("live-courses"));
R("GET", "/live-courses/:id/plans", ...view("live-courses"));
R("POST", "/live-courses/:id/plans", "live-courses.create");
R("GET", "/live-courses/:id/subscriptions", ...view("live-courses"));
R("POST", "/live-courses/:id/grant", "live-courses.create");
R("PATCH", "/live-courses/:id/popular", "live-courses.edit");
R("PATCH", "/live-courses/:id/schedule-entries", "live-courses.edit");
R("DELETE", "/live-courses/:id/schedule-folders/:fid", "live-courses.edit");
R("DELETE", "/live-courses/:id/schedule-folders/:fid/entries/:eid", "live-courses.edit");
R("POST", "/live-courses/:id/folders/:fid/videos/reorder", "live-courses.edit");
R("POST", "/live-courses/:id/folders/:fid/videos/from-recording", "live-courses.create");
R("GET", "/live-courses/:id/folders/:fid/videos", ...view("live-courses"));
R("POST", "/live-courses/:id/folders/:fid/videos", "live-courses.create");
R("GET", "/live-courses/:id/folders/:fid/videos/:vid", ...view("live-courses"));
R("PUT", "/live-courses/:id/folders/:fid/videos/:vid", "live-courses.edit");
R("DELETE", "/live-courses/:id/folders/:fid/videos/:vid", "live-courses.delete");
R("GET", "/live-courses/:id/folders", ...view("live-courses"));
R("POST", "/live-courses/:id/folders", "live-courses.create");
R("PATCH", "/live-courses/:id/folders/:fid", "live-courses.edit");
R("DELETE", "/live-courses/:id/folders/:fid", "live-courses.delete");
crud("/live-courses", "live-courses");

// ── /test-series → test-series (+ prices/plans, subscriptions) ─────────────
R("PUT", "/test-series/content-categories/:id", "test-series.edit");
R("DELETE", "/test-series/content-categories/:id", "test-series.edit");
R("PUT", "/test-series/papers/:id", "test-series.edit");
R("DELETE", "/test-series/papers/:id", "test-series.edit");
// test-series.plans + test-series.subscriptions collapsed 2026-07-20 into `test-series`.
R("PUT", "/test-series/prices/:id", "test-series.edit");
R("DELETE", "/test-series/prices/:id", "test-series.delete");
R("GET", "/test-series/subscriptions", ...view("test-series"));
R("GET", "/test-series/subscriptions/:id", ...view("test-series"));
R("PUT", "/test-series/subscriptions/:id", "test-series.edit");
R("DELETE", "/test-series/subscriptions/:id", "test-series.delete");
R("GET", "/test-series/orders", ...view("test-series"));
R("GET", "/test-series/:id/content-categories", ...view("test-series"));
R("POST", "/test-series/:id/content-categories", "test-series.edit");
R("GET", "/test-series/:id/papers", ...view("test-series"));
R("POST", "/test-series/:id/papers", "test-series.edit");
R("GET", "/test-series/:id/prices", ...view("test-series"));
R("POST", "/test-series/:id/prices", "test-series.create");
R("POST", "/test-series/:id/grant", "test-series.create");
crud("/test-series", "test-series");

// ── /uploads → presigned upload helper (no dedicated module) UNMAPPED ──────

/**
 * Resolve the catalog keys gating (method, relPath), or null if unmapped.
 * First matching rule wins.
 */
export const resolveRequiredKeys = (
  method: string,
  relPath: string
): string[] | null => {
  const m = method.toUpperCase();
  for (const rule of rules) {
    if (rule.methods.has(m) && rule.re.test(relPath)) return rule.keys;
  }
  return null;
};

/** Total rule count — exposed for a boot-time sanity log / tests. */
export const RBAC_RULE_COUNT = rules.length;

/**
 * Every catalog permission key referenced by an enforcement rule (deduped).
 *
 * This is the authoritative set of keys the backend actually gates routes on.
 * A cleanup that prunes the permission catalog/DB MUST protect these — deleting
 * a key that still appears here would make the mapped route deny every
 * non-super-admin the moment `RBAC_ENFORCE` is turned on (no grantable id).
 * Consumed by scripts/cleanup-web-permissions.ts.
 */
export const RBAC_ROUTE_KEYS: ReadonlySet<string> = new Set(
  rules.flatMap((r) => r.keys)
);
