/**
 * Permission catalog: single source of truth for all admin permissions.
 *
 * Adding a permission: add it here and bump CATALOG_VERSION. On boot the seeder
 * syncs ws_permissions to this registry; removed keys are marked deprecated,
 * never hard-deleted.
 *
 * Keys are `{module}.{action}` or `{module}.{subResource}.{action}`, lowercase
 * kebab-case. Once shipped, a key must never be renamed.
 *
 * Every module belongs to exactly one guard. A role can only hold permissions of
 * its own guard, so the catalog endpoint filters by `?guard=` and the seeder
 * seeds each module only under its own guard.
 */

import type { Guard } from "./permission.validation";

export const CATALOG_VERSION = "2026.10.06-2";

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
  guard: Guard;
  description?: string;
  permissions: CatalogPermission[];
}

// The `web` catalog exposes only these 5 actions per module; there is no `list`
// (the admin UI gates list screens on `view`). Per-module `extras` are added only
// on an explicit product decision.
const STANDARD_5: { action: string; suffix: string; verb: string }[] = [
  { action: "view", suffix: "view", verb: "View" },
  { action: "create", suffix: "create", verb: "Create" },
  { action: "edit", suffix: "edit", verb: "Edit" },
  { action: "delete", suffix: "delete", verb: "Delete" },
  { action: "toggle-status", suffix: "toggle-status", verb: "Toggle status" },
];

/** `standard: false` skips the standard actions; a subset array picks some (e.g. `["view"]`). */
const mod = (
  key: string,
  label: string,
  group: string,
  opts: {
    description?: string;
    standard?: boolean | string[];
    extras?: CatalogPermission[];
    guard?: Guard;
  } = {},
): CatalogModule => {
  const standard = opts.standard ?? true;
  const want =
    standard === true
      ? STANDARD_5.map((s) => s.action)
      : standard === false
        ? []
        : standard;

  const base: CatalogPermission[] = STANDARD_5.filter((s) =>
    want.includes(s.action),
  ).map((s) => ({
    key: `${key}.${s.suffix}`,
    label: `${s.verb} ${label.toLowerCase()}`,
    action: s.action,
  }));

  return {
    key,
    label,
    group,
    guard: opts.guard ?? "web",
    description: opts.description,
    permissions: [...base, ...(opts.extras ?? [])],
  };
};

/** Module with hand-listed keys that don't follow STANDARD_5 (promoter/educator portals). */
const rawMod = (
  key: string,
  label: string,
  group: string,
  guard: Guard,
  permissions: CatalogPermission[],
  description?: string,
): CatalogModule => ({ key, label, group, guard, description, permissions });

// NOTE: the `web` catalog is the 5 STANDARD_5 actions per module by default
// (2026-07-20). Per-module `extras` are the exception, added only on an explicit
// product decision (first: `customers`, 2026-09-11). Non-web guards use `rawMod()`.


// Per-subscription-type admin actions on the customer-detail page (2026-10-06). One key
// per type × action, so a role can e.g. add days without being able to deactivate.
const SUBSCRIPTION_ACTION_LABELS: Record<string, (type: string) => string> = {
  change: (t) => `Change ${t} subscription to another product`,
  move: (t) => `Move ${t} subscription to another customer`,
  deactivate: (t) => `Deactivate ${t} subscription`,
  revert: (t) => `Revert ${t} subscription deactivation`,
  "add-days": (t) => `Add days to ${t} subscription`,
  edit: (t) => `Edit ${t} subscription (dates, status, shipping, payment)`,
};
const subscriptionActionKeys = (subResource: string, type: string, actions: string[]): CatalogPermission[] =>
  actions.map((action) => ({
    key: `customers.${subResource}.${action}`,
    label: SUBSCRIPTION_ACTION_LABELS[action](type),
    action,
    subResource,
  }));
const ALL_SUBSCRIPTION_ACTIONS = ["change", "move", "deactivate", "revert", "add-days"];

export const PERMISSION_CATALOG: CatalogModule[] = [
  mod("goals", "Goals", "Master Data"),
  mod("educators", "Educators", "Master Data"),
  mod("materials", "Materials", "Master Data"),
  mod("pc-materials", "PC Materials", "Master Data"),
  mod("subject-categories", "Course Categories", "Master Data"),
  mod("package-categories", "Package Categories", "Master Data"),
  // /video-categories routes gate on `videos.categories.*` and /customer-masters/*
  // on `customers.*` in rbacRouteMap.

  mod("address.states", "States", "Address"),
  mod("address.cities", "Cities", "Address"),

  mod("courses", "Courses", "Courses"),

  mod("live-courses", "Live Courses", "Live Courses"),

  mod("live-sessions", "Live Sessions", "Live Sessions"),
  mod("live-sessions.chat", "Live Session Chat", "Live Sessions"),
  mod("live-sessions.streamos", "StreamOS Config", "Live Sessions"),

  mod("test-series", "Test Series", "Test Series"),

  mod("ebooks", "Ebooks", "Ebooks / Books"),
  // Reports → view only; their write routes gate on the parent module in rbacRouteMap.
  mod("ebooks.subscriptions", "EBook Subscriptions", "Reports", {
    standard: ["view"],
  }),
  mod("books", "Books", "Ebooks / Books"),
  mod("books.orders", "Book Orders", "Reports", { standard: ["view"] }),

  mod("packages", "Packages", "Packages"),
  mod("packages.types", "Package Types", "Packages"),
  // Plan attach/detach gates on `packages.edit`.
  mod("plans", "Standalone Plans", "Packages"),

  mod("study-materials", "Study Materials", "Study Materials"),
  mod(
    "study-materials.categories",
    "Study Material Categories",
    "Study Materials",
  ),

  mod("exam-countdowns", "Exam Countdowns", "Exam Countdowns"),
  mod(
    "exam-countdowns.categories",
    "Exam Countdown Categories",
    "Exam Countdowns",
  ),

  mod("quizzes", "Quizzes", "Quizzes"),
  mod("quizzes.categories", "Quiz Categories", "Quizzes"),

  mod("videos", "Videos", "Videos"),
  mod("videos.categories", "Video Categories", "Videos"),

  // One add key per subscription type (no generic one: the FE has no counterpart).
  // Reads (profile, addresses, every subscription tab) stay on `customers.view`.
  mod("customers", "Customers", "Customers", {
    extras: [
      {
        key: "customers.course-subscriptions.create",
        label: "Add course subscription",
        action: "create",
        subResource: "course-subscriptions",
      },
      {
        key: "customers.package-subscriptions.create",
        label: "Add package subscription",
        action: "create",
        subResource: "package-subscriptions",
      },
      {
        key: "customers.live-course-subscriptions.create",
        label: "Add live course subscription",
        action: "create",
        subResource: "live-course-subscriptions",
      },
      {
        key: "customers.test-series-subscriptions.create",
        label: "Add test series subscription",
        action: "create",
        subResource: "test-series-subscriptions",
      },
      {
        key: "customers.ebook-subscriptions.create",
        label: "Add ebook subscription",
        action: "create",
        subResource: "ebook-subscriptions",
      },
      // `edit` = the general edit on the Subscriptions list (PUT /subscriptions/:id).
      ...subscriptionActionKeys("course-subscriptions", "course", [...ALL_SUBSCRIPTION_ACTIONS, "edit"]),
      ...subscriptionActionKeys("package-subscriptions", "package", [...ALL_SUBSCRIPTION_ACTIONS, "edit"]),
      ...subscriptionActionKeys("live-course-subscriptions", "live course", ALL_SUBSCRIPTION_ACTIONS),
      ...subscriptionActionKeys("test-series-subscriptions", "test series", ["add-days"]),
      ...subscriptionActionKeys("ebook-subscriptions", "ebook", ["add-days"]),
    ],
  }),

  // ── Subscriptions (admin-wide) ───────────────────────────────────────────
  // No `edit` / `toggle-status` (2026-10-06): editing a row is per type
  // (customers.<type>-subscriptions.edit and the action keys); there is no status toggle.
  mod("subscriptions", "Subscriptions", "Subscriptions", { standard: ["view", "create", "delete"] }),

  // One view-only key per report screen. The parent `<m>.view` also opens each
  // report (OR in rbacRouteMap). Subscription and Subscription Material Report
  // share GET /subscriptions, so either key opens it.
  mod("subscriptions.reports", "Subscription Report", "Reports", {
    standard: ["view"],
  }),
  mod(
    "subscriptions.material-report",
    "Subscription Material Report",
    "Reports",
    { standard: ["view"] },
  ),
  mod("live-courses.report", "Live Course Report", "Reports", {
    standard: ["view"],
  }),
  mod("test-series.report", "Test Series Report", "Reports", {
    standard: ["view"],
  }),

  mod("administrators", "Administrators", "RBAC"),
  mod("roles", "Roles", "RBAC"),
  mod("permissions", "Permissions", "RBAC"),
  mod("permission-categories", "Permission Categories", "RBAC"),
  mod("guards", "Guards", "RBAC", { standard: ["view"] }),

  mod("referrals.referrers", "Referral Referrers", "Referrals"),
  mod("referrals.report", "Referral Report", "Referrals", {
    standard: ["view"],
  }),
  mod("referrals.transactions", "Referral Transactions", "Referrals", {
    standard: ["view"],
  }),
  mod("referrals.terms", "Referral Terms", "Referrals"),
  mod("referrals.faqs", "Referral FAQs", "Referrals"),
  mod("referrals.settings", "Referral Settings", "Referrals", {
    standard: ["view", "edit"],
  }),

  mod("promoters", "Promoters", "Promoters / Promocodes"),
  // Revenue dashboard is grantable separately from the promoter list.
  mod("promoters.dashboard", "Promoter Dashboard", "Promoters / Promocodes", {
    standard: ["view"],
  }),
  mod("promocodes", "Promocodes", "Promoters / Promocodes"),

  mod("cms.banners", "Banners", "CMS"),
  mod("cms.live-banners", "Live Banners", "CMS"),
  mod("cms.popups", "Popups", "CMS"),
  mod("cms.testimonials", "Testimonials", "CMS"),
  mod("cms.faqs", "FAQs", "CMS"),
  mod("cms.faq-types", "FAQ Types", "CMS"),
  mod("cms.terms", "Terms", "CMS"),
  mod("cms.current-affairs", "Current Affairs", "CMS"),
  // Single settings screen editing the book-terms row's free-shipping threshold.
  mod("cms.free-delivery", "Free Delivery", "CMS", {
    standard: ["view", "edit"],
  }),
  mod("cms.app-version", "App Version", "CMS", { standard: ["view", "edit"] }),
  mod("cms.app-update", "App Update", "CMS", { standard: ["view", "edit"] }),
  mod("cms.social-links", "Social Links", "CMS"),
  mod("cms.social-link-types", "Social Link Types", "CMS"),

  mod("jobs.content", "Job Content", "Jobs"),
  mod("jobs.organizations", "Job Organizations", "Jobs"),
  mod("jobs.previous-papers", "Previous Papers", "Jobs"),
  mod("jobs.suggested-products", "Jobs Suggested Products", "Jobs"),

  mod("careers.openings", "Career Openings", "Careers"),
  mod("careers.applications", "Career Applications", "Careers", {
    standard: ["view", "edit"],
  }),

  mod("rank-predictor.papers", "Rank Predictor Papers", "Rank Predictor"),
  mod(
    "rank-predictor.answer-keys",
    "Rank Predictor Answer Keys",
    "Rank Predictor",
    {
      standard: ["view", "create", "toggle-status"],
    },
  ),
  mod(
    "rank-predictor.submissions",
    "Rank Predictor Submissions",
    "Rank Predictor",
    {
      standard: ["view", "edit", "delete"],
    },
  ),

  mod("offline.banners", "Offline Banners", "Offline"),
  mod("offline.cities", "Offline Cities", "Offline"),
  mod("offline.centers", "Offline Centres", "Offline"),
  mod("offline.batches", "Offline Batches", "Offline"),
  mod("offline.enquiries", "Offline Enquiries", "Offline"),

  mod("departments", "Departments", "Departments / Inquiries"),
  mod("inquiries", "Inquiries", "Departments / Inquiries"),
  mod(
    "inquiries.mobile-app",
    "Mobile App Inquiries",
    "Departments / Inquiries",
  ),

  mod("notifications", "Notifications", "Notifications"),

  mod("tracking", "Tracking", "Tracking", { standard: ["view"] }),

  mod("dashboard", "Dashboard", "Dashboard", { standard: ["view"] }),

  // The /promoter/* portal is enforced by requireRole("promoter"); these keys exist
  // so promoter-guard roles can be managed in the RBAC tree. Historical keys, never rename.
  rawMod("promoter", "Promoter Portal", "Promoter Portal", "promoter", [
    { key: "promoter", label: "Access promoter portal", action: "access" },
    {
      key: "promoter.dashboard",
      label: "View promoter dashboard",
      action: "view-dashboard",
    },
    {
      key: "promoter.customers",
      label: "Promoter customers",
      action: "view",
      subResource: "customers",
    },
    {
      key: "promoter.customers.read",
      label: "Read promoter customers",
      action: "read",
      subResource: "customers",
    },
    {
      key: "promoter.promocodes",
      label: "Promoter promocodes",
      action: "view",
      subResource: "promocodes",
    },
    {
      key: "promoter.promocodes.read",
      label: "Read promoter promocodes",
      action: "read",
      subResource: "promocodes",
    },
  ]),

  // Educator-guard roles are built from this key; it gates the educator dashboard.
  rawMod("educator", "Educator Portal", "Educator Portal", "educator", [
    {
      key: "educator.dashboard",
      label: "View educator dashboard",
      action: "view-dashboard",
    },
  ]),
];

export const ALL_CATALOG_KEYS: Set<string> = new Set(
  PERMISSION_CATALOG.flatMap((m) => m.permissions.map((p) => p.key)),
);

export const CATALOG_KEYS_BY_GUARD: Map<Guard, Set<string>> = (() => {
  const byGuard = new Map<Guard, Set<string>>();
  for (const m of PERMISSION_CATALOG) {
    let set = byGuard.get(m.guard);
    if (!set) {
      set = new Set<string>();
      byGuard.set(m.guard, set);
    }
    for (const p of m.permissions) set.add(p.key);
  }
  return byGuard;
})();

export const catalogKeysForGuard = (guard: Guard): Set<string> =>
  CATALOG_KEYS_BY_GUARD.get(guard) ?? new Set<string>();
