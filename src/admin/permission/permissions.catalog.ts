/**
 * Permission Catalog — single source of truth for all admin permissions.
 *
 * Adding a permission: append to a module's `permissions` array (or add a new
 * module). Bump CATALOG_VERSION. On next boot, the seeder syncs ws_permissions
 * to match this registry; removed keys are marked deprecated, never hard-deleted.
 *
 * Key naming: `{module}.{action}` or `{module}.{subResource}.{action}`,
 * lowercase kebab-case, dot-separated. Once shipped, a key must never be renamed.
 *
 * Guard scoping: every module belongs to exactly one guard (`web` | `educator` |
 * `promoter`). A Spatie permission row is guard-scoped and a role can only be
 * granted permissions of its OWN guard, so the catalog endpoint filters modules
 * by `?guard=` and the seeder seeds each module ONLY under its own guard. Most
 * admin modules are `web`; the promoter/educator portals get their own modules.
 */

import type { Guard } from "./permission.validation";

export const CATALOG_VERSION = "2026.07.20-2";

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
  /** Guard this module's permissions live under. Defaults to "web" via `mod()`. */
  guard: Guard;
  description?: string;
  permissions: CatalogPermission[];
}

// The `web` catalog exposes only these 5 core actions per module (2026-07-20).
// `list` was dropped (the admin UI gates list screens on `view`) and all
// sub-feature/extra actions were removed — the admin frontend checks none of them.
const STANDARD_5: { action: string; suffix: string; verb: string }[] = [
  { action: "view",          suffix: "view",          verb: "View"           },
  { action: "create",        suffix: "create",        verb: "Create"         },
  { action: "edit",          suffix: "edit",          verb: "Edit"           },
  { action: "delete",        suffix: "delete",        verb: "Delete"         },
  { action: "toggle-status", suffix: "toggle-status", verb: "Toggle status"  },
];

/**
 * Build a module entry. Pass `standard: false` to skip the standard actions
 * (for read-only modules like Dashboard / Tracking), or a subset array (e.g.
 * `["view"]` for reports, `["view","edit"]` for settings).
 */
const mod = (
  key: string,
  label: string,
  group: string,
  opts: {
    description?: string;
    standard?: boolean | string[]; // true (default), false, or subset of action ids
    extras?: CatalogPermission[];
    guard?: Guard; // defaults to "web"
  } = {}
): CatalogModule => {
  const standard = opts.standard ?? true;
  const want = standard === true
    ? STANDARD_5.map((s) => s.action)
    : standard === false
      ? []
      : standard;

  const base: CatalogPermission[] = STANDARD_5
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
    guard: opts.guard ?? "web",
    description: opts.description,
    permissions: [...base, ...(opts.extras ?? [])],
  };
};

/**
 * Define a module with an explicit, hand-listed permission set (keys that don't
 * follow the STANDARD_5 `{key}.{view|list|create|...}` shape). Used for the
 * promoter/educator portal permissions, whose historical keys are e.g.
 * `promoter`, `promoter.customers.read`.
 */
const rawMod = (
  key: string,
  label: string,
  group: string,
  guard: Guard,
  permissions: CatalogPermission[],
  description?: string
): CatalogModule => ({ key, label, group, guard, description, permissions });

// NOTE: the `web` catalog is capped at the 5 STANDARD_5 actions per module — no
// per-module `extras` (2026-07-20). The `extra()` helper was removed with them; if
// a future non-web guard needs bespoke keys, use `rawMod()` instead.

export const PERMISSION_CATALOG: CatalogModule[] = [
  // ── Master Data ──────────────────────────────────────────────────────────
  mod("goals", "Goals", "Master Data"),
  mod("educators", "Educators", "Master Data"),
  mod("materials", "Materials", "Master Data"),
  mod("pc-materials", "PC Materials", "Master Data"),
  mod("subject-categories", "Course Categories", "Master Data"),
  mod("package-categories", "Package Categories", "Master Data"),
  // Removed 2026-07-20 (keep-list reconciliation, guard `web`):
  //   • `video-categories` — legacy duplicate of the kept `videos.categories`;
  //     its /video-categories + /master/video-categories routes now gate on
  //     `videos.categories.*` in rbacRouteMap.
  //   • `customer-masters.*` (states/districts/educations/target-goals) — the
  //     admin panel gates these under `customers.*`; their /customer-masters/*
  //     routes were re-pointed to `customers.*` in rbacRouteMap.
  // See docs/backend-requests/permission-catalog-keep-list-web-guard-RESPONSE.md.

  // ── Address ──────────────────────────────────────────────────────────────
  mod("address.states", "States", "Address"),
  mod("address.cities", "Cities", "Address"),

  // ── Courses ──────────────────────────────────────────────────────────────
  mod("courses", "Courses", "Courses"),
  // courses.{plans,video-categories,videos,materials} removed 2026-07-20 — the
  // admin panel gates all Courses actions on `courses.*`; nested routes collapsed
  // into the parent key in rbacRouteMap.

  // ── Live Courses ─────────────────────────────────────────────────────────
  mod("live-courses", "Live Courses", "Live Courses"),
  // live-courses.{plans,folders,videos,subscriptions} removed 2026-07-20 —
  // collapsed into the parent `live-courses` key in rbacRouteMap.

  // ── Live Sessions ────────────────────────────────────────────────────────
  mod("live-sessions", "Live Sessions", "Live Sessions"),
  mod("live-sessions.chat", "Live Session Chat", "Live Sessions"),
  // live-sessions.polls removed 2026-07-20 — collapsed into `live-sessions`.
  mod("live-sessions.streamos", "StreamOS Config", "Live Sessions"),

  // ── Test Series ──────────────────────────────────────────────────────────
  mod("test-series", "Test Series", "Test Series"),
  // test-series.{plans,subscriptions} removed 2026-07-20 — collapsed into `test-series`.

  // ── Ebooks / Books ───────────────────────────────────────────────────────
  mod("ebooks", "Ebooks", "Ebooks / Books"),
  // ebooks.plans removed 2026-07-20 — collapsed into `ebooks`.
  // Reports → view only; their write routes gate on the parent module in rbacRouteMap.
  mod("ebooks.subscriptions", "Ebook Subscriptions", "Ebooks / Books", { standard: ["view"] }),
  mod("books", "Books", "Ebooks / Books"),
  mod("books.orders", "Book Orders", "Ebooks / Books", { standard: ["view"] }),

  // ── Packages ─────────────────────────────────────────────────────────────
  mod("packages", "Packages", "Packages"),
  mod("packages.types", "Package Types", "Packages"),
  // packages.plans removed 2026-07-20 — collapsed into `packages` (attach/detach → edit).
  mod("plans", "Standalone Plans", "Packages"),

  // ── Study Materials ──────────────────────────────────────────────────────
  mod("study-materials", "Study Materials", "Study Materials"),
  mod("study-materials.categories", "Study Material Categories", "Study Materials"),

  // ── Exam Countdowns ──────────────────────────────────────────────────────
  mod("exam-countdowns", "Exam Countdowns", "Exam Countdowns"),
  mod("exam-countdowns.categories", "Exam Countdown Categories", "Exam Countdowns"),

  // ── Quizzes ──────────────────────────────────────────────────────────────
  mod("quizzes", "Quizzes", "Quizzes"),
  mod("quizzes.categories", "Quiz Categories", "Quizzes"),
  // quizzes.{questions,submissions,analytics} removed 2026-07-20 — collapsed into
  // the parent `quizzes` key in rbacRouteMap.

  // ── Videos ───────────────────────────────────────────────────────────────
  mod("videos", "Videos", "Videos"),
  mod("videos.categories", "Video Categories", "Videos"),

  // ── Customers ────────────────────────────────────────────────────────────
  mod("customers", "Customers", "Customers"),
  // customers.{addresses,course-subscriptions,ebook-subscriptions} removed
  // 2026-07-20 — collapsed into the parent `customers` key in rbacRouteMap.

  // ── Subscriptions (admin-wide) ───────────────────────────────────────────
  mod("subscriptions", "Subscriptions", "Subscriptions"),
  mod("subscriptions.reports", "Subscription Reports", "Subscriptions", { standard: ["view"] }),

  // ── RBAC ─────────────────────────────────────────────────────────────────
  mod("administrators", "Administrators", "RBAC"),
  mod("roles", "Roles", "RBAC"),
  mod("permissions", "Permissions", "RBAC"),
  mod("permission-categories", "Permission Categories", "RBAC"),
  mod("guards", "Guards", "RBAC", { standard: ["view"] }),

  // ── Referrals ────────────────────────────────────────────────────────────
  mod("referrals.referrers", "Referral Referrers", "Referrals"),
  mod("referrals.report", "Referral Report", "Referrals", { standard: ["view"] }),
  mod("referrals.transactions", "Referral Transactions", "Referrals", { standard: ["view"] }),
  mod("referrals.terms", "Referral Terms", "Referrals"),
  mod("referrals.faqs", "Referral FAQs", "Referrals"),
  mod("referrals.settings", "Referral Settings", "Referrals", { standard: ["view", "edit"] }),

  // ── Promoters / Promocodes ───────────────────────────────────────────────
  mod("promoters", "Promoters", "Promoters / Promocodes"),
  // promoters.subscriptions removed 2026-07-20 — collapsed into `promoters`.
  mod("promocodes", "Promocodes", "Promoters / Promocodes"),

  // ── CMS ──────────────────────────────────────────────────────────────────
  mod("cms.banners", "Banners", "CMS"),
  mod("cms.live-banners", "Live Banners", "CMS"),
  mod("cms.popups", "Popups", "CMS"),
  mod("cms.testimonials", "Testimonials", "CMS"),
  mod("cms.faqs", "FAQs", "CMS"),
  mod("cms.faq-types", "FAQ Types", "CMS"),
  mod("cms.terms", "Terms", "CMS"),
  mod("cms.current-affairs", "Current Affairs", "CMS"),
  // Free-delivery is a single settings screen (read + Save) that reads/writes the
  // CMS book-terms row's free-shipping threshold — view + edit only.
  mod("cms.free-delivery", "Free Delivery", "CMS", { standard: ["view", "edit"] }),
  mod("cms.app-version", "App Version", "CMS", { standard: ["view", "edit"] }),
  mod("cms.app-update", "App Update", "CMS", { standard: ["view", "edit"] }),
  mod("cms.social-links", "Social Links", "CMS"),
  mod("cms.social-link-types", "Social Link Types", "CMS"),

  // ── Offline ──────────────────────────────────────────────────────────────
  mod("offline.banners", "Offline Banners", "Offline"),
  mod("offline.cities", "Offline Cities", "Offline"),
  mod("offline.centers", "Offline Centres", "Offline"),
  mod("offline.batches", "Offline Batches", "Offline"),
  mod("offline.enquiries", "Offline Enquiries", "Offline"),

  // ── Departments / Inquiries ──────────────────────────────────────────────
  mod("departments", "Departments", "Departments / Inquiries"),
  mod("inquiries", "Inquiries", "Departments / Inquiries"),
  mod("inquiries.mobile-app", "Mobile App Inquiries", "Departments / Inquiries"),

  // ── Notifications ────────────────────────────────────────────────────────
  mod("notifications", "Notifications", "Notifications"),

  // ── Tracking ─────────────────────────────────────────────────────────────
  mod("tracking", "Tracking", "Tracking", { standard: ["view"] }),

  // ── Dashboard ────────────────────────────────────────────────────────────
  mod("dashboard", "Dashboard", "Dashboard", { standard: ["view"] }),

  // ── Promoter Portal (guard: promoter) ────────────────────────────────────
  // The "Success Partner" promoter role is built from these keys. They gate the
  // /api/v1/promoter/* portal (dashboard, customers, promocodes). Enforcement is
  // currently role-based (requireRole("promoter")); these permissions exist so
  // promoter-guard roles render/manage them in the RBAC tree. Keys are the
  // historical ones (guard=promoter) and must never be renamed.
  rawMod("promoter", "Promoter Portal", "Promoter Portal", "promoter", [
    { key: "promoter", label: "Access promoter portal", action: "access" },
    { key: "promoter.dashboard", label: "View promoter dashboard", action: "view-dashboard" },
    { key: "promoter.customers", label: "Promoter customers", action: "view", subResource: "customers" },
    { key: "promoter.customers.read", label: "Read promoter customers", action: "read", subResource: "customers" },
    { key: "promoter.promocodes", label: "Promoter promocodes", action: "view", subResource: "promocodes" },
    { key: "promoter.promocodes.read", label: "Read promoter promocodes", action: "read", subResource: "promocodes" },
  ]),

  // ── Educator Portal (guard: educator) ────────────────────────────────────
  // Educator-guard roles (e.g. "WebSankul Educator") are built from this key; it
  // gates the educator dashboard. Same latent-orphan fix as the promoter portal.
  rawMod("educator", "Educator Portal", "Educator Portal", "educator", [
    { key: "educator.dashboard", label: "View educator dashboard", action: "view-dashboard" },
  ]),
];

export const ALL_CATALOG_KEYS: Set<string> = new Set(
  PERMISSION_CATALOG.flatMap((m) => m.permissions.map((p) => p.key))
);

/**
 * Catalog keys grouped by guard — the source of truth for guard-scoped catalog
 * responses and for the seeder (each key seeds ONLY under its module's guard).
 */
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

/** Modules for a guard (used by the catalog endpoint's `?guard=` filter). */
export const modulesForGuard = (guard: Guard): CatalogModule[] =>
  PERMISSION_CATALOG.filter((m) => m.guard === guard);

/** Catalog keys for a guard (used to compute the guard-scoped deprecated set). */
export const catalogKeysForGuard = (guard: Guard): Set<string> =>
  CATALOG_KEYS_BY_GUARD.get(guard) ?? new Set<string>();
