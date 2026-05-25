/**
 * Permission Catalog — single source of truth for all admin permissions.
 *
 * Adding a permission: append to a module's `permissions` array (or add a new
 * module). Bump CATALOG_VERSION. On next boot, the seeder syncs ws_permissions
 * to match this registry; removed keys are marked deprecated, never hard-deleted.
 *
 * Key naming: `{module}.{action}` or `{module}.{subResource}.{action}`,
 * lowercase kebab-case, dot-separated. Once shipped, a key must never be renamed.
 */

export const CATALOG_VERSION = "2026.05.25-1";

export type CatalogAction =
  | "view" | "list" | "create" | "edit" | "delete" | "toggle-status"
  | "duplicate" | "bulk-delete" | "bulk-update" | "bulk-status"
  | "export" | "import" | "assign" | "revoke"
  | "start" | "end" | "cancel" | "publish" | "unpublish" | "moderate"
  | "send" | "extend" | "attach" | "detach" | "invalidate"
  | "update-status" | "assign-role" | "reset-password" | "assign-permissions"
  | "view-details" | "view-dashboard";

export interface CatalogPermission {
  key: string;
  label: string;
  action: string;
  subResource?: string;
  deprecated?: boolean;
}

export interface CatalogModule {
  key: string;
  label: string;
  group: string;
  description?: string;
  permissions: CatalogPermission[];
}

const STANDARD_6: { action: string; suffix: string; verb: string }[] = [
  { action: "view",          suffix: "view",          verb: "View"           },
  { action: "list",          suffix: "list",          verb: "List"           },
  { action: "create",        suffix: "create",        verb: "Create"         },
  { action: "edit",          suffix: "edit",          verb: "Edit"           },
  { action: "delete",        suffix: "delete",        verb: "Delete"         },
  { action: "toggle-status", suffix: "toggle-status", verb: "Toggle status"  },
];

/**
 * Build a module entry. Pass `standard: false` to skip the standard 6 actions
 * (for read-only modules like Dashboard / Analytics / Tracking).
 */
const mod = (
  key: string,
  label: string,
  group: string,
  opts: {
    description?: string;
    standard?: boolean | string[]; // true (default), false, or subset of action ids
    extras?: CatalogPermission[];
  } = {}
): CatalogModule => {
  const standard = opts.standard ?? true;
  const want = standard === true
    ? STANDARD_6.map((s) => s.action)
    : standard === false
      ? []
      : standard;

  const base: CatalogPermission[] = STANDARD_6
    .filter((s) => want.includes(s.action))
    .map((s) => ({
      key: `${key}.${s.suffix}`,
      label: `${s.verb} ${label.toLowerCase()}`,
      action: s.action,
    }));

  return {
    key,
    label,
    group,
    description: opts.description,
    permissions: [...base, ...(opts.extras ?? [])],
  };
};

const extra = (
  moduleKey: string,
  action: string,
  label: string,
  subResource?: string
): CatalogPermission => ({
  key: `${moduleKey}.${action}`,
  label,
  action,
  ...(subResource ? { subResource } : {}),
});

export const PERMISSION_CATALOG: CatalogModule[] = [
  // ── Master Data ──────────────────────────────────────────────────────────
  mod("goals", "Goals", "Master Data"),
  mod("educators", "Educators", "Master Data"),
  mod("materials", "Materials", "Master Data", {
    extras: [extra("materials", "duplicate", "Duplicate materials")],
  }),
  mod("subject-categories", "Course Categories", "Master Data"),
  mod("video-categories", "Video Categories", "Master Data", {
    extras: [extra("video-categories", "duplicate", "Duplicate video categories")],
  }),
  mod("package-categories", "Package Categories", "Master Data"),
  mod("customer-masters.states", "Customer Master — States", "Master Data"),
  mod("customer-masters.districts", "Customer Master — Districts", "Master Data"),
  mod("customer-masters.educations", "Customer Master — Educations", "Master Data"),
  mod("customer-masters.target-goals", "Customer Master — Target Goals", "Master Data"),

  // ── Address ──────────────────────────────────────────────────────────────
  mod("address.states", "States", "Address"),
  mod("address.cities", "Cities", "Address"),

  // ── Courses ──────────────────────────────────────────────────────────────
  mod("courses", "Courses", "Courses"),
  mod("courses.plans", "Course Plans", "Courses"),
  mod("courses.video-categories", "Course Video Categories", "Courses"),
  mod("courses.videos", "Course Videos", "Courses"),
  mod("courses.materials", "Course Materials", "Courses"),

  // ── Live Courses ─────────────────────────────────────────────────────────
  mod("live-courses", "Live Courses", "Live Courses"),
  mod("live-courses.plans", "Live Course Plans", "Live Courses"),
  mod("live-courses.folders", "Live Course Folders", "Live Courses"),
  mod("live-courses.videos", "Live Course Videos", "Live Courses"),
  mod("live-courses.subscriptions", "Live Course Subscriptions", "Live Courses"),

  // ── Live Sessions ────────────────────────────────────────────────────────
  mod("live-sessions", "Live Sessions", "Live Sessions", {
    extras: [
      extra("live-sessions", "start", "Start live session"),
      extra("live-sessions", "end", "End live session"),
      extra("live-sessions", "cancel", "Cancel live session"),
    ],
  }),
  mod("live-sessions.chat", "Live Session Chat", "Live Sessions", {
    extras: [extra("live-sessions.chat", "moderate", "Moderate live session chat")],
  }),
  mod("live-sessions.polls", "Live Session Polls", "Live Sessions", {
    extras: [extra("live-sessions.polls", "publish", "Publish live session poll")],
  }),
  mod("live-sessions.streamos", "StreamOS Config", "Live Sessions"),

  // ── Test Series ──────────────────────────────────────────────────────────
  mod("test-series", "Test Series", "Test Series"),
  mod("test-series.plans", "Test Series Plans", "Test Series"),
  mod("test-series.subscriptions", "Test Series Subscriptions", "Test Series"),

  // ── Ebooks / Books ───────────────────────────────────────────────────────
  mod("ebooks", "Ebooks", "Ebooks / Books"),
  mod("ebooks.plans", "Ebook Plans", "Ebooks / Books"),
  mod("ebooks.subscriptions", "Ebook Subscriptions", "Ebooks / Books"),
  mod("books", "Books", "Ebooks / Books"),
  mod("books.orders", "Book Orders", "Ebooks / Books", {
    extras: [extra("books.orders", "update-status", "Update book order status")],
  }),

  // ── Packages ─────────────────────────────────────────────────────────────
  mod("packages", "Packages", "Packages"),
  mod("packages.types", "Package Types", "Packages"),
  mod("packages.plans", "Package Plans", "Packages", {
    extras: [
      extra("packages.plans", "attach", "Attach package plan"),
      extra("packages.plans", "detach", "Detach package plan"),
    ],
  }),
  mod("plans", "Standalone Plans", "Packages"),

  // ── Study Materials ──────────────────────────────────────────────────────
  mod("study-materials", "Study Materials", "Study Materials"),
  mod("study-materials.categories", "Study Material Categories", "Study Materials", {
    extras: [extra("study-materials.categories", "duplicate", "Duplicate study material categories")],
  }),

  // ── Exam Countdowns ──────────────────────────────────────────────────────
  mod("exam-countdowns", "Exam Countdowns", "Exam Countdowns"),
  mod("exam-countdowns.categories", "Exam Countdown Categories", "Exam Countdowns"),

  // ── Quizzes ──────────────────────────────────────────────────────────────
  mod("quizzes", "Quizzes", "Quizzes", {
    extras: [
      extra("quizzes", "publish", "Publish quiz"),
      extra("quizzes", "unpublish", "Unpublish quiz"),
    ],
  }),
  mod("quizzes.categories", "Quiz Categories", "Quizzes"),
  mod("quizzes.questions", "Quiz Questions", "Quizzes", {
    extras: [
      extra("quizzes.questions", "import", "Import quiz questions"),
      extra("quizzes.questions", "export", "Export quiz questions"),
    ],
  }),
  mod("quizzes.submissions", "Quiz Submissions", "Quizzes", {
    extras: [extra("quizzes.submissions", "invalidate", "Invalidate quiz submission")],
  }),
  mod("quizzes.analytics", "Quiz Analytics", "Quizzes", { standard: ["view", "list"] }),

  // ── Videos ───────────────────────────────────────────────────────────────
  mod("videos", "Videos", "Videos"),
  mod("videos.categories", "Video Categories", "Videos", {
    extras: [extra("videos.categories", "duplicate", "Duplicate video categories")],
  }),

  // ── Customers ────────────────────────────────────────────────────────────
  mod("customers", "Customers", "Customers", {
    extras: [extra("customers", "view-details", "View customer details")],
  }),
  mod("customers.addresses", "Customer Addresses", "Customers"),
  mod("customers.course-subscriptions", "Customer Course Subscriptions", "Customers", {
    extras: [
      extra("customers.course-subscriptions", "extend", "Extend customer course subscription"),
      extra("customers.course-subscriptions", "revoke", "Revoke customer course subscription"),
    ],
  }),
  mod("customers.ebook-subscriptions", "Customer Ebook Subscriptions", "Customers", {
    extras: [
      extra("customers.ebook-subscriptions", "extend", "Extend customer ebook subscription"),
      extra("customers.ebook-subscriptions", "revoke", "Revoke customer ebook subscription"),
    ],
  }),

  // ── Subscriptions (admin-wide) ───────────────────────────────────────────
  mod("subscriptions", "Subscriptions", "Subscriptions"),
  mod("subscriptions.reports", "Subscription Reports", "Subscriptions", {
    standard: ["view", "list"],
    extras: [extra("subscriptions.reports", "export", "Export subscription reports")],
  }),

  // ── RBAC ─────────────────────────────────────────────────────────────────
  mod("administrators", "Administrators", "RBAC", {
    extras: [
      extra("administrators", "assign-role", "Assign role to administrator"),
      extra("administrators", "reset-password", "Reset administrator password"),
    ],
  }),
  mod("roles", "Roles", "RBAC", {
    extras: [extra("roles", "assign-permissions", "Assign permissions to role")],
  }),
  mod("permissions", "Permissions", "RBAC", { standard: ["view", "list"] }),
  mod("permission-categories", "Permission Categories", "RBAC", { standard: ["view", "list"] }),
  mod("guards", "Guards", "RBAC", { standard: ["view", "list"] }),

  // ── Referrals ────────────────────────────────────────────────────────────
  mod("referrals.referrers", "Referral Referrers", "Referrals"),
  mod("referrals.report", "Referral Report", "Referrals", {
    standard: ["view", "list"],
    extras: [extra("referrals.report", "export", "Export referral report")],
  }),
  mod("referrals.transactions", "Referral Transactions", "Referrals"),
  mod("referrals.terms", "Referral Terms", "Referrals"),
  mod("referrals.faqs", "Referral FAQs", "Referrals"),
  mod("referrals.settings", "Referral Settings", "Referrals", { standard: ["view", "edit"] }),

  // ── Promoters / Promocodes ───────────────────────────────────────────────
  mod("promoters", "Promoters", "Promoters / Promocodes", {
    extras: [extra("promoters", "view-dashboard", "View promoter dashboard")],
  }),
  mod("promoters.subscriptions", "Promoter Subscriptions", "Promoters / Promocodes", {
    standard: ["view", "list"],
  }),
  mod("promocodes", "Promocodes", "Promoters / Promocodes", {
    extras: [
      extra("promocodes", "bulk-delete", "Bulk delete promocodes"),
      extra("promocodes", "bulk-status", "Bulk update promocode status"),
    ],
  }),

  // ── CMS ──────────────────────────────────────────────────────────────────
  mod("cms.banners", "Banners", "CMS"),
  mod("cms.live-banners", "Live Banners", "CMS"),
  mod("cms.popups", "Popups", "CMS"),
  mod("cms.testimonials", "Testimonials", "CMS"),
  mod("cms.faqs", "FAQs", "CMS"),
  mod("cms.faq-types", "FAQ Types", "CMS"),
  mod("cms.terms", "Terms", "CMS"),
  mod("cms.app-version", "App Version", "CMS", { standard: ["view", "edit"] }),
  mod("cms.app-update", "App Update", "CMS", { standard: ["view", "edit"] }),
  mod("cms.social-links", "Social Links", "CMS"),
  mod("cms.social-link-types", "Social Link Types", "CMS"),

  // ── Offline ──────────────────────────────────────────────────────────────
  mod("offline.banners", "Offline Banners", "Offline"),
  mod("offline.cities", "Offline Cities", "Offline"),
  mod("offline.centers", "Offline Centres", "Offline"),
  mod("offline.batches", "Offline Batches", "Offline"),
  mod("offline.enquiries", "Offline Enquiries", "Offline", {
    extras: [
      extra("offline.enquiries", "update-status", "Update offline enquiry status"),
      extra("offline.enquiries", "assign", "Assign offline enquiry"),
    ],
  }),

  // ── Departments / Inquiries ──────────────────────────────────────────────
  mod("departments", "Departments", "Departments / Inquiries"),
  mod("inquiries", "Inquiries", "Departments / Inquiries", {
    extras: [
      extra("inquiries", "update-status", "Update inquiry status"),
      extra("inquiries", "assign", "Assign inquiry"),
    ],
  }),
  mod("inquiries.mobile-app", "Mobile App Inquiries", "Departments / Inquiries"),

  // ── Notifications ────────────────────────────────────────────────────────
  mod("notifications", "Notifications", "Notifications", {
    extras: [
      extra("notifications", "send", "Send notification"),
      extra("notifications", "bulk-delete", "Bulk delete notifications"),
    ],
  }),

  // ── Tracking ─────────────────────────────────────────────────────────────
  mod("tracking", "Tracking", "Tracking", { standard: ["view", "list"] }),

  // ── Dashboard ────────────────────────────────────────────────────────────
  mod("dashboard", "Dashboard", "Dashboard", { standard: ["view"] }),
];

export const ALL_CATALOG_KEYS: Set<string> = new Set(
  PERMISSION_CATALOG.flatMap((m) => m.permissions.map((p) => p.key))
);
