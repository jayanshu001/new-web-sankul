# Response — Permission catalog keep-list (guard `web`)

**Re:** `permission-catalog-keep-list-web-guard.md`
**Date:** 2026-07-20 (updated — full reconciliation done)
**Status:** ✅ Implemented. Catalog reconciled to the keep-list; enforcement preserved by
collapsing nested keys into their parent module. 7 namespaces retained + flagged (below).

---

## 1. How the catalog is produced (context)

`GET admin/permissions/catalog?guard=web` renders **entirely from `ws_permissions` DB
rows**, not the in-code registry. The registry (`permissions.catalog.ts`) only drives
inserts at boot; the seeder never deletes. So the removal is two parts: (a) drop the
modules from the registry + re-point enforcement, done in code; (b) delete the stale DB
rows via `scripts/cleanup-web-permissions.ts` (dry-run → `--apply`) at deploy.

## 2. The conflict we had to solve

Your keep-list is derived from the **admin frontend** (`modulePermissions.ts`), which only
ever checks a module's parent key (`courses.*`, `customers.*`, …). But the **backend**
gated many routes on finer **sub-namespace** keys (`courses.plans.*`,
`customers.addresses.*`, …) via `middlewares/rbacRouteMap.ts`. Simply deleting those keys
would make the routes deny every non-super-admin once `RBAC_ENFORCE` flips on.

**Fix: collapse, don't just delete.** Each removed sub-namespace's route rules were
re-pointed to the kept parent key the frontend actually checks — so enforcement continues
under the parent, and the sub-namespace disappears from the catalog. No route lost
enforcement; no route became an ungrantable lockout (verified: every one of the 344
enforced keys exists in the catalog¹).

## 3. Removed from the `web` catalog (collapsed into parent)

| Removed namespace(s) | Now enforced under |
|---|---|
| `video-categories` (legacy dup) | `videos.categories` |
| `courses.{plans, videos, materials, video-categories}` | `courses` |
| `customers.{addresses, course-subscriptions, ebook-subscriptions}` | `customers` |
| `customer-masters.{states, districts, educations, target-goals}` | `customers` |
| `ebooks.plans` | `ebooks` |
| `quizzes.{questions, submissions, analytics}` | `quizzes` |
| `packages.plans` | `packages` |
| `test-series.{plans, subscriptions}` | `test-series` |
| `live-courses.{plans, folders, videos, subscriptions}` | `live-courses` |
| `live-sessions.polls` | `live-sessions` |
| `promoters.subscriptions` | `promoters` |

The DB rows for these are deleted (and unassigned from roles) by the cleanup script.

## 4. Retained + flagged — need your confirmation before we drop them

These are in your "remove" set but have **no kept parent to collapse into**, so dropping
their DB rows would leave their live backend routes either ungrantable or ungated. We left
them **in place** and enforced. Confirm per item whether the admin panel truly has no
screen for them; if so we'll remove enforcement + catalog together in a follow-up.

| Namespace | Live route(s) | Why retained |
|---|---|---|
| `subscriptions` (mgmt) | `crud /subscriptions`, `/subscriptions/{ebook,plans}` | Your own §4 "verify before dropping". |
| `cms.app-version` | `GET/PUT /cms/version` | App-version settings mutation; not in keep-list — oversight or dead? |
| `cms.app-update` | `GET/PUT /cms/app-update` | Same. |
| `offline.banners` | `crud /offline/banners` | Offline banners CRUD; keep-list Offline omits it. |
| `inquiries` (general) | `GET/DELETE /inquiries` | Distinct from the kept `inquiries.mobile-app`; no parent. |
| `tracking` | `GET /tracking[/summary]` | Read-only; not in keep-list. |
| `guards` | `GET /guards` | Read-only guard picker used by the RBAC UI. |

## 5. Scope notes

- **Module-level only.** Per-module action differences (e.g. `live-sessions` still has
  `start/end/cancel`; the missing `export` on `books.orders`/`ebooks.subscriptions`/
  `referrals.transactions`) were **not** touched. Say the word for an action-level pass.
- ¹ **Pre-existing (not ours):** the invariant check flags 8 keys — `permissions.*` and
  `permission-categories.*` `create/edit/delete/toggle-status` — as enforced-but-not-in-
  catalog. Those two modules are read-only (`view/list`) in the catalog, and their
  write routes are **410'd upstream**, so they never execute. Harmless; left as-is.

## 6. Deploy steps

1. Ship the code (registry + `rbacRouteMap` changes).
2. `npx tsx scripts/cleanup-web-permissions.ts` → review → `--apply` (deletes the removed
   `web` rows + unassigns them from roles). The seeder self-heals timestamps at boot.

See `docs/admin/PERMISSION_CATALOG_KEEPLIST_FRONTEND.md` for the admin-FE impact.
