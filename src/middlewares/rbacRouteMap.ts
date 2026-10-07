// Admin RBAC route map: admin method + path to the permission keys it requires.
// Declarative admin route → permission-key map, auditable against the catalog
// (admin/permission/permissions.catalog.ts). Keys are OR-ed: holding any one grants
// access. An unmatched route resolves to `null`, which rbacEnforce logs and allows, so
// an incomplete map never locks the panel out. Paths are admin-router-relative
// ("/books/123/status"). First match wins: register specific sub-resource paths before
// the generic ":id" CRUD rules. `:param` matches a single segment.

interface Rule {
  methods: Set<string>;
  re: RegExp;
  keys: string[];
}

const rules: Rule[] = [];

/** `method` may be pipe-joined ("PUT|PATCH"). */
const R = (method: string, path: string, ...keys: string[]): void => {
  const methods = new Set(method.split("|").map((m) => m.toUpperCase()));
  const re = new RegExp("^" + path.replace(/:[^/]+/g, "[^/]+") + "/?$");
  rules.push({ methods, re, keys });
};

// Reads gate on `<m>.view` only; the catalog has no `.list` keys (the admin UI gates
// list screens on `view`), and referencing one here would keep orphan rows alive.
const view = (m: string): string[] => [`${m}.view`];

/** Standard CRUD rules for module `m`. Call after any resource-specific R() rules. */
const crud = (base: string, m: string): void => {
  R("PATCH", `${base}/:id/status`, `${m}.toggle-status`);
  R("GET", base, ...view(m));
  R("POST", base, `${m}.create`);
  R("GET", `${base}/:id`, ...view(m));
  R("PUT|PATCH", `${base}/:id`, `${m}.edit`);
  R("DELETE", `${base}/:id`, `${m}.delete`);
};

R("GET", "/administrators/pre-requisites", ...view("administrators"));
R("PATCH", "/administrators/:id/status", "administrators.toggle-status");
crud("/administrators", "administrators");

R("GET", "/roles/:id/permissions", ...view("roles"));
R("PUT", "/roles/:id/permissions", "roles.edit");
crud("/roles", "roles");

// The catalog also feeds the Roles page permission tree, so roles.view may read it.
R("GET", "/permissions/catalog", ...view("permissions"), ...view("roles"));
R("GET", "/permissions/:id/roles", ...view("permissions"));
crud("/permissions", "permissions"); // create/edit/delete are 410'd upstream

crud("/permission-categories", "permission-categories");

R("GET", "/guards", ...view("guards"));

R("GET", "/video-categories/pre-requisites", ...view("videos.categories"));
R("GET", "/video-categories/:id/sub-categories", ...view("videos.categories"));
R("GET", "/video-categories/:id/courses", ...view("videos.categories"));
R("GET", "/video-categories/:id/videos", ...view("videos.categories"));
R("POST", "/video-categories/:id/duplicate", "videos.categories.create");
crud("/video-categories", "videos.categories");

R("GET", "/videos/pre-requisites", ...view("videos"));
R("POST", "/videos/reorder", "videos.edit");
crud("/videos", "videos");

crud("/goals", "goals");

// Nested course sub-resources gate on the parent `courses` key, like the admin panel.
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
R("PUT", "/courses/:id/exam-categories/reorder", "courses.edit");
R("GET", "/courses/:id/material-categories", ...view("courses"));
R("PUT", "/courses/:id/material-categories/reorder", "courses.edit");
R("PUT", "/courses/:id/books/reorder", "courses.edit");
R("PATCH", "/courses/:id/popular", "courses.edit");
crud("/courses", "courses");

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

crud("/pc-materials", "pc-materials");
R("GET", "/master/video-categories", ...view("videos.categories"));
R("GET", "/master/video-categories/:id", ...view("videos.categories"));
R("POST", "/master/video-categories", "videos.categories.create");
R("PUT", "/master/video-categories/:id", "videos.categories.edit");
R("DELETE", "/master/video-categories/:id", "videos.categories.delete");
R("GET", "/master/package-categories", ...view("package-categories"));
R("POST", "/master/package-categories", "package-categories.create");
R("PUT", "/master/package-categories/:id", "package-categories.edit");
R("DELETE", "/master/package-categories/:id", "package-categories.delete");

R("GET|POST", "/ebooks/reorder", "ebooks.edit");
R("GET", "/ebooks/pdf-jobs/:id", ...view("ebooks"));
R("POST", "/ebooks/:id/pdf", "ebooks.edit");
R("PATCH", "/ebooks/:id/trending", "ebooks.edit");
R("GET", "/ebooks/subscriptions/export/:format", ...view("ebooks.subscriptions"));
R("GET", "/ebooks/subscriptions/list", ...view("ebooks.subscriptions"));
// ebooks.subscriptions is a view-only report; its write routes gate on parent `ebooks`.
// "Add ebook subscription" from the Customers side also unlocks this.
R("POST", "/ebooks/subscriptions", "ebooks.create", "customers.ebook-subscriptions.create");
R("GET", "/ebooks/subscriptions/:id", ...view("ebooks.subscriptions"));
R("PUT", "/ebooks/subscriptions/:id", "ebooks.edit");
R("POST", "/ebooks/subscriptions/:id/add-days", "customers.ebook-subscriptions.add-days");
R("DELETE", "/ebooks/subscriptions/:id", "ebooks.delete");
R("GET", "/ebooks/plans/:id", ...view("ebooks"));
R("PUT", "/ebooks/plans/:id", "ebooks.edit");
R("DELETE", "/ebooks/plans/:id", "ebooks.delete");
R("GET", "/ebooks/:id/plans", ...view("ebooks"));
R("POST", "/ebooks/:id/plans", "ebooks.create");
R("GET", "/ebooks/:id/prices", ...view("ebooks"));
R("GET", "/ebooks/:id/promocodes", ...view("ebooks"));
crud("/ebooks", "ebooks");

R("GET", "/customers/pre-requisites", ...view("customers"));
R("GET", "/customers/states/:id/districts", ...view("customers"));
R("GET", "/customers/:id/details", ...view("customers"));
// Every read under a customer is `customers.view`. Adding a subscription is gated by
// the per-type `customers.<type>-subscriptions.create` keys below.
R("GET", "/customers/:id/addresses", ...view("customers"));
R("GET", "/customers/:id/book-orders", ...view("customers"));
R("GET", "/customers/:id/course-subscriptions", ...view("customers"));
R("PUT", "/customers/:id/course-subscriptions/:sid", "customers.edit"); // adjust dates
R("GET", "/customers/:id/package-subscriptions", ...view("customers"));
R("GET", "/customers/:id/live-course-subscriptions", ...view("customers"));
R("GET", "/customers/:id/test-series-subscriptions", ...view("customers"));
R("GET", "/customers/:id/ebook-subscriptions", ...view("customers"));
crud("/customers", "customers");

// Customer master-data routes gate on the parent `customers` key.
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

// "programs" has no catalog module yet; referrals.settings is the closest surface.
R("GET", "/referrals/programs", "referrals.settings.view"); // module ships view/edit only
R("POST|PUT|DELETE", "/referrals/programs", "referrals.settings.edit");
R("POST|PUT|DELETE", "/referrals/programs/:id", "referrals.settings.edit");
R("GET", "/referrals/referrers", ...view("referrals.referrers"));
R("GET", "/referrals/transactions", ...view("referrals.transactions"));
// referrals.transactions + referrals.report are view-only reports; their write
// actions (approve/process transactions & withdrawals) gate on referrals.settings.edit.
R("PATCH", "/referrals/transactions/:id", "referrals.settings.edit");
R("POST", "/referrals/transactions", "referrals.settings.edit");
R("GET", "/referrals/withdrawals/csv", ...view("referrals.report"));
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

R("POST", "/books/reorder", "books.edit");
// Free-delivery threshold has its own cms.free-delivery keys so it can be granted
// independently. Registered before crud("/books") so :id can't shadow it.
R("GET", "/books/settings", "cms.free-delivery.view");
R("PUT", "/books/settings", "cms.free-delivery.edit");
R("GET", "/books/orders/export/:format", ...view("books.orders"));
R("GET", "/books/orders/list", ...view("books.orders"));
R("GET", "/books/orders/:id", ...view("books.orders"));
R("PATCH", "/books/orders/:id/status", "books.edit");
R("PATCH", "/books/orders/:id/tracking", "books.edit");
R("POST", "/books/orders/:id/tracking/events", "books.edit");
R("PATCH", "/books/:id/trending", "books.edit");
crud("/books", "books");

R("GET", "/quizzes/categories/tree", ...view("quizzes.categories"));
R("GET", "/quizzes/categories/:id/packages", ...view("quizzes.categories"));
R("GET", "/quizzes/categories/:id/courses", ...view("quizzes.categories"));
R("GET", "/quizzes/categories", ...view("quizzes.categories"));
R("POST", "/quizzes/categories", "quizzes.categories.create");
R("GET", "/quizzes/categories/:id", ...view("quizzes.categories"));
R("PUT", "/quizzes/categories/:id", "quizzes.categories.edit");
R("DELETE", "/quizzes/categories/:id", "quizzes.categories.delete");
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

// Study Materials module; master-data "Materials" is /master/materials above.
R("GET", "/materials/categories", ...view("study-materials.categories"));
R("POST", "/materials/categories/reorder", "study-materials.categories.edit");
R("POST", "/materials/categories/:id/duplicate", "study-materials.categories.create");
R("GET", "/materials/categories/:id/courses", ...view("study-materials.categories"));
R("GET", "/materials/categories/:id/products", ...view("study-materials.categories"));
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

R("GET", "/packages/types", ...view("packages.types"));
R("POST", "/packages/types", "packages.types.create");
R("PUT", "/packages/types/:id", "packages.types.edit");
R("DELETE", "/packages/types/:id", "packages.types.delete");
R("POST", "/packages/reorder", "packages.edit");
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

R("POST", "/plans/bulk-status", "plans.edit");
R("POST", "/plans/bulk-delete", "plans.delete");
R("PATCH", "/plans/:id/default", "plans.edit");
R("POST", "/plans/:id/clone", "plans.create");
crud("/plans", "plans");

R("POST", "/plan-popularity/recompute", "plans.edit");

R("GET", "/promocodes/plans", ...view("promocodes"));
R("POST", "/promocodes/bulk-status", "promocodes.toggle-status");
R("POST", "/promocodes/bulk-delete", "promocodes.delete");
crud("/promocodes", "promocodes");

R("GET", "/subscriptions/reports/summary", ...view("subscriptions.reports"));
R("GET", "/subscriptions/reports/by-course", ...view("subscriptions.reports"));
R("GET", "/subscriptions/reports/by-ebook", ...view("subscriptions.reports"));
R("GET", "/subscriptions/reports/book-orders", ...view("subscriptions.reports"));
R("GET", "/subscriptions/ebook", ...view("subscriptions"));
R("GET", "/subscriptions/plans", ...view("subscriptions"));
R("GET", "/subscriptions/customer-addresses/:id", ...view("customers"));
R("POST", "/subscriptions/customer-addresses", "customers.create");
R("PUT", "/subscriptions/customer-addresses/:id", "customers.edit");
R("DELETE", "/subscriptions/customer-addresses/:id", "customers.delete");
// Manual course/package subscription; "Add subscription" from the Customers side also
// unlocks it. Must precede crud() to win first-match.
R(
  "POST",
  "/subscriptions",
  "subscriptions.create",
  "customers.course-subscriptions.create",
  "customers.package-subscriptions.create"
);
// Subscription Report and Subscription Material Report share this list, so either key opens it.
const subReport = [...view("subscriptions"), ...view("subscriptions.reports"), ...view("subscriptions.material-report")];
R("GET", "/subscriptions/export/:format", ...subReport);
R("GET", "/subscriptions", ...subReport);
R("GET", "/subscriptions/:id", ...subReport);
R("GET", "/subscriptions/:id/history", ...subReport, ...view("customers"));
// One route serves course AND package rows, so the map admits either type's key and the
// controller then requires the row's own type (subscription.controller authorizeSubAction).
const subAction = (action: string) => [`customers.course-subscriptions.${action}`, `customers.package-subscriptions.${action}`];
R("POST", "/subscriptions/:id/change-product", ...subAction("change"));
R("POST", "/subscriptions/:id/move", ...subAction("move"));
R("POST", "/subscriptions/:id/deactivate", ...subAction("deactivate"));
R("POST", "/subscriptions/:id/add-days", ...subAction("add-days"));
R("POST", "/subscriptions/:id/revert-deactivation", ...subAction("revert"));
// Not crud(): the module has no `edit` / `toggle-status` — the row edit is per type.
R("GET", "/subscriptions", ...view("subscriptions"));
R("POST", "/subscriptions", "subscriptions.create");
R("GET", "/subscriptions/:id", ...view("subscriptions"));
R("PUT|PATCH", "/subscriptions/:id", ...subAction("edit"));
R("DELETE", "/subscriptions/:id", "subscriptions.delete");

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

R("GET", "/inquiries", ...view("inquiries"));
R("GET", "/inquiries/:id", ...view("inquiries"));
R("DELETE", "/inquiries/:id", "inquiries.delete");
crud("/departments", "departments");

R("POST", "/notifications/broadcast", "notifications.create");
R("GET", "/notifications/target-options", ...view("notifications"));
R("POST", "/notifications/bulk-delete", "notifications.delete");
R("POST", "/notifications/:id/cancel", "notifications.edit");
R("GET", "/notifications/images", ...view("notifications"));
R("POST", "/notifications/images", "notifications.create");
R("PUT", "/notifications/images/:id", "notifications.edit");
R("DELETE", "/notifications/images/:id", "notifications.delete");
R("GET", "/notifications", ...view("notifications"));
R("DELETE", "/notifications/:id", "notifications.delete");

R("POST", "/offline/banners/reorder", "offline.banners.edit");
crud("/offline/banners", "offline.banners");
crud("/offline/centers", "offline.centers");
crud("/offline/batches", "offline.batches");
R("GET", "/offline/enquiries", ...view("offline.enquiries"));
R("DELETE", "/offline/enquiries/:id", "offline.enquiries.delete");
R("GET", "/offline/batch-enquiries", ...view("offline.enquiries"));
R("DELETE", "/offline/batch-enquiries/:id", "offline.enquiries.delete");

// The dashboard has its own key: listing promoters must not imply seeing revenue.
R("GET", "/promoters/dashboard", ...view("promoters.dashboard"));
R("GET", "/promoters/:id/dashboard", ...view("promoters.dashboard"));
R("GET", "/promoters/:id/promocodes", ...view("promoters"));
R("GET", "/promoters/:id/subscriptions", ...view("promoters"));
crud("/promoters", "promoters");

// ── /dashboard → dashboard (read-only) ─────────────────────────────────────
R("GET", "/dashboard/trending", "dashboard.view");
R("GET", "/dashboard", "dashboard.view");

R("GET", "/tracking/summary", ...view("tracking"));
R("GET", "/tracking", ...view("tracking"));

crud("/address/states", "address.states");
crud("/address/cities", "address.cities");

R("GET", "/exam-countdowns/categories", ...view("exam-countdowns.categories"));
R("GET", "/exam-countdowns/categories/:id", ...view("exam-countdowns.categories"));
R("POST", "/exam-countdowns/categories", "exam-countdowns.categories.create");
R("PUT", "/exam-countdowns/categories/:id", "exam-countdowns.categories.edit");
R("DELETE", "/exam-countdowns/categories/:id", "exam-countdowns.categories.delete");
crud("/exam-countdowns", "exam-countdowns");

R("POST", "/live-polls", "live-sessions.create");
R("GET", "/live-polls/:id/results", ...view("live-sessions"));
R("GET", "/live-polls/:id", ...view("live-sessions"));

R("POST", "/live-chat/message", "live-sessions.chat.create");
R("GET", "/live-chat/bans", ...view("live-sessions.chat"));
R("POST", "/live-chat/bans", "live-sessions.chat.create");
R("DELETE", "/live-chat/bans/:id", "live-sessions.chat.delete");
R("DELETE", "/live-chat/messages/:id", "live-sessions.chat.delete");
R("GET", "/live-chat/:id/history", ...view("live-sessions.chat"));
R("GET", "/live-chat/:id/settings", ...view("live-sessions.chat"));
R("PATCH", "/live-chat/:id/settings", "live-sessions.chat.edit");

// streamos/webhook is an external callback with its own verification: left unmapped.
R("GET", "/live-sessions/streamos/org", ...view("live-sessions.streamos"));
R("GET", "/live-sessions/streamos/recordings/:id", ...view("live-sessions.streamos"));
R("POST", "/live-sessions/end", "live-sessions.edit");
R("POST", "/live-sessions/:id/provision", "live-sessions.edit");
R("POST", "/live-sessions/:id/start", "live-sessions.edit");
R("POST", "/live-sessions/:id/promote-recording", "live-sessions.edit");
R("GET", "/live-sessions/:id/attendance", ...view("live-sessions"));
R("GET", "/live-sessions/:id/recording-health", ...view("live-sessions"));
R("GET", "/live-sessions", ...view("live-sessions"));
R("POST", "/live-sessions", "live-sessions.create");
R("GET", "/live-sessions/:id", ...view("live-sessions"));
R("PATCH", "/live-sessions/:id", "live-sessions.edit");
R("DELETE", "/live-sessions/:id", "live-sessions.delete");

R("GET", "/live-courses/plans/:id", ...view("live-courses"));
R("PUT", "/live-courses/plans/:id", "live-courses.edit");
R("DELETE", "/live-courses/plans/:id", "live-courses.delete");
// Live Course Report: own key `live-courses.report` or parent view.
R("GET", "/live-courses/subscriptions/export/:format", ...view("live-courses"), ...view("live-courses.report"));
R("GET", "/live-courses/subscriptions", ...view("live-courses"), ...view("live-courses.report"));
R("GET", "/live-courses/subscriptions/:id", ...view("live-courses"), ...view("live-courses.report"));
R("PUT", "/live-courses/subscriptions/:id", "live-courses.edit");
R("POST", "/live-courses/subscriptions/:id/change-course", "customers.live-course-subscriptions.change");
R("POST", "/live-courses/subscriptions/:id/move", "customers.live-course-subscriptions.move");
R("POST", "/live-courses/subscriptions/:id/deactivate", "customers.live-course-subscriptions.deactivate");
R("POST", "/live-courses/subscriptions/:id/add-days", "customers.live-course-subscriptions.add-days");
R("POST", "/live-courses/subscriptions/:id/revert-deactivation", "customers.live-course-subscriptions.revert");
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
// Admin lecture preview (LectureWatch) — reading a lecture = view, same as the video GET above.
R("GET", "/live-courses/:id/lecture/:vid", ...view("live-courses"));
R("PUT", "/live-courses/:id/folders/:fid/videos/:vid", "live-courses.edit");
R("DELETE", "/live-courses/:id/folders/:fid/videos/:vid", "live-courses.delete");
// Bulk reorder must precede crud() (first match wins).
R("POST", "/live-courses/reorder", "live-courses.edit");
R("GET", "/live-courses/:id/folders", ...view("live-courses"));
R("POST", "/live-courses/:id/folders", "live-courses.create");
R("PATCH", "/live-courses/:id/folders/:fid", "live-courses.edit");
R("DELETE", "/live-courses/:id/folders/:fid", "live-courses.delete");
crud("/live-courses", "live-courses");

R("PUT", "/test-series/content-categories/:id", "test-series.edit");
R("DELETE", "/test-series/content-categories/:id", "test-series.edit");
R("PUT", "/test-series/papers/:id", "test-series.edit");
R("DELETE", "/test-series/papers/:id", "test-series.edit");
R("PUT", "/test-series/prices/:id", "test-series.edit");
R("DELETE", "/test-series/prices/:id", "test-series.delete");
// Test Series Report: own key `test-series.report` or parent view.
R("GET", "/test-series/subscriptions/export/:format", ...view("test-series"), ...view("test-series.report"));
R("GET", "/test-series/subscriptions", ...view("test-series"), ...view("test-series.report"));
R("GET", "/test-series/subscriptions/:id", ...view("test-series"), ...view("test-series.report"));
R("PUT", "/test-series/subscriptions/:id", "test-series.edit");
R("POST", "/test-series/subscriptions/:id/add-days", "customers.test-series-subscriptions.add-days");
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

R("PATCH", "/jobs/content/:id/status", "jobs.content.toggle-status");
R("POST", "/jobs/content/reorder", "jobs.content.edit");
R("POST", "/jobs/content/inline-image", "jobs.content.create", "jobs.content.edit");
R("POST", "/jobs/content/document", "jobs.content.create", "jobs.content.edit");
crud("/jobs/content", "jobs.content");

crud("/jobs/organizations", "jobs.organizations");

R("POST", "/jobs/papers/files", "jobs.previous-papers.create", "jobs.previous-papers.edit");
crud("/jobs/papers", "jobs.previous-papers");

crud("/jobs/suggested-products", "jobs.suggested-products");

crud("/careers/openings", "careers.openings");

R("PUT", "/careers/applications/:id/status", "careers.applications.edit");
R("GET", "/careers/applications", ...view("careers.applications"));
R("GET", "/careers/applications/:id", ...view("careers.applications"));

// Answer keys and submissions are separate modules under the papers path, so their
// rules must precede `crud("/rank-predictor/papers")`.
R("GET", "/rank-predictor/papers/:examId/answer-keys", ...view("rank-predictor.answer-keys"));
R("POST", "/rank-predictor/papers/:examId/answer-keys", "rank-predictor.answer-keys.create");
R("PATCH", "/rank-predictor/answer-keys/:id/status", "rank-predictor.answer-keys.toggle-status");
R("GET", "/rank-predictor/papers/:examId/leaderboard", ...view("rank-predictor.papers"));
crud("/rank-predictor/papers", "rank-predictor.papers");

R("GET", "/rank-predictor/submissions", ...view("rank-predictor.submissions"));
R("GET", "/rank-predictor/submissions/:id", ...view("rank-predictor.submissions"));
R("GET", "/rank-predictor/submissions/:id/file", ...view("rank-predictor.submissions"));
R("PUT", "/rank-predictor/submissions/:id/answers", "rank-predictor.submissions.edit");
R("POST", "/rank-predictor/submissions/:id/rescore", "rank-predictor.submissions.edit");
R("DELETE", "/rank-predictor/submissions/:id", "rank-predictor.submissions.delete");

// /uploads (presigned upload helper) is intentionally unmapped.

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

/**
 * Every key the backend gates routes on. Catalog cleanup (scripts/cleanup-web-permissions.ts)
 * must protect these, or the mapped route denies every non-super-admin once RBAC_ENFORCE is on.
 */
export const RBAC_ROUTE_KEYS: ReadonlySet<string> = new Set(
  rules.flatMap((r) => r.keys)
);
