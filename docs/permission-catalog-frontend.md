# Admin Frontend — Permission Catalog Integration

Backend now ships a **registry-driven RBAC catalog**. Permissions are defined
in code (single source of truth) and synced to the DB on boot. The frontend
must source the available permissions exclusively from the catalog endpoint
and drop all "Add Permission / Add Category" UI.

---

## 1. The endpoint

```
GET /api/v1/admin/permissions/catalog
```

- **Auth**: Bearer token, role `admin` or `super_admin`.
- **Query params**: none.
- **Path params**: none.
- **Cache**: cache the response in `sessionStorage` keyed by `data.version`.
  Invalidate when `version` changes.

### 200 response

```jsonc
{
  "success": true,
  "data": {
    "version": "2026.05.20-1",
    "modules": [
      {
        "key": "video-categories",
        "label": "Video Categories",
        "group": "Master Data",
        "description": null,
        "permissions": [
          { "key": "video-categories.view",          "label": "View video categories",          "action": "view" },
          { "key": "video-categories.list",          "label": "List video categories",          "action": "list" },
          { "key": "video-categories.create",        "label": "Create video categories",        "action": "create" },
          { "key": "video-categories.edit",          "label": "Edit video categories",          "action": "edit" },
          { "key": "video-categories.delete",        "label": "Delete video categories",        "action": "delete" },
          { "key": "video-categories.toggle-status", "label": "Toggle status video categories", "action": "toggle-status" },
          { "key": "video-categories.duplicate",     "label": "Duplicate video categories",     "action": "duplicate" }
        ]
      }
      // … one entry per module
    ],
    "deprecated": [
      { "key": "old-module.view", "deprecated": true }
    ]
  }
}
```

### Errors

| Status | When                              |
| ------ | --------------------------------- |
| 401    | Missing / invalid Bearer token    |
| 403    | Caller is not admin / super_admin |
| 500    | Unexpected server error           |

---

## 2. Key naming convention

- `{module}.{action}` — e.g. `videos.create`
- `{module}.{subResource}.{action}` — e.g. `books.orders.update-status`
- All lowercase kebab-case, dot-separated.
- **Keys never change once shipped.** Removed keys appear in `data.deprecated`
  so admins can clean role assignments before they are hard-deleted.

### Standard actions used across modules

`view` · `list` · `create` · `edit` · `delete` · `toggle-status` ·
`duplicate` · `bulk-delete` · `bulk-update` · `bulk-status` · `export` ·
`import` · `assign` · `revoke` · `start` · `end` · `cancel` · `publish` ·
`unpublish` · `moderate` · `send` · `extend` · `attach` · `detach` ·
`invalidate` · `update-status` · `assign-role` · `reset-password` ·
`assign-permissions` · `view-details` · `view-dashboard`

Modules may define non-standard actions; treat any string in `action` as
opaque and render the `label` field.

---

## 3. UI changes required

### Roles page (`/admin/roles/:id/edit`)

**Before** — manual multi-select of permission rows fetched from
`GET /admin/permissions`.

**After** — tree of checkboxes sourced from `GET /admin/permissions/catalog`:

```
Master Data
├─ Goals
│   ☑ View goals
│   ☑ List goals
│   ☐ Create goals
│   …
├─ Educators
│   …
Courses
├─ Courses
│   …
```

- Top-level grouping = `module.group` (e.g. `Master Data`, `Courses`, `RBAC`).
- Second level = `module.label`.
- Leaves = each `permission.label`; checkbox value = `permission.key`.
- On save, convert selected `key` strings → permission `_id`s using the
  existing `GET /admin/permissions?per_page=500` list, then call
  `PUT /admin/roles/:id` with `{ permissionIds: [...] }` (unchanged contract).

### Permissions list page (`/admin/permissions`)

- **Remove "Add Permission" button.** The `POST /admin/permissions` endpoint
  now returns **410 Gone**.
- Keep the list view (it doubles as a source for `key → _id` mapping).
- **Edit / delete:** keep the UI but expect that meaningful edits (renaming a
  key) will desync the row from the catalog. Recommend disabling edit on
  `name` field; backend may add server-side guards later.

### Permission Categories page (`/admin/permission-categories`)

- **Remove "Add Category" and "Edit Category" buttons.** `POST` returns
  **410**. Categories are now derived from the catalog `group` field; the
  seeder creates them automatically.
- Optionally remove the page entirely once existing roles are migrated.

### Deprecated permissions

- If `data.deprecated` is non-empty, show a banner on the Roles page:
  > N deprecated permissions are still assigned to one or more roles.
  > Review and remove them before they are cleaned up.
- In the tree, render deprecated keys (if a role still has them) under a
  collapsed **Deprecated** section, marked with a warning icon. Allow
  uncheck-only; do not allow re-assigning a deprecated key to a new role.

---

## 4. Caching

```ts
const KEY = "permissions:catalog";

async function loadCatalog() {
  const cached = sessionStorage.getItem(KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    // optional: do a HEAD/light check; simplest is to refetch on app boot
    return parsed;
  }
  const { data } = await api.get("/admin/permissions/catalog");
  sessionStorage.setItem(KEY, JSON.stringify(data.data));
  return data.data;
}
```

- Refetch the catalog on every fresh login.
- After fetch, compare `version` with cached value; if different, replace
  the cache and re-render any open Roles editor.

---

## 5. Permission checks in the UI

Continue using the existing pattern — match the **permission key string**
against the current user's effective permission keys.

```ts
function can(key: string) {
  return currentUser.permissionKeys.has(key);
}

// Hide the "Duplicate" button on the Video Categories list:
{can("video-categories.duplicate") && <DuplicateButton />}
```

If the current user response doesn't already expose permission keys (only
ids), add a backend follow-up to include them — but that's independent of
this catalog work.

---

## 6. Module reference (from the registry)

Groups and modules currently shipped. Each module gets the standard 6
actions (`view, list, create, edit, delete, toggle-status`) unless noted.

| Group                  | Module key                       | Extra actions |
| ---------------------- | -------------------------------- | ------------- |
| Master Data            | `goals`                          | — |
| Master Data            | `educators`                      | — |
| Master Data            | `materials`                      | `duplicate` |
| Master Data            | `subject-categories`             | — |
| Master Data            | `video-categories`               | `duplicate` |
| Master Data            | `package-categories`             | — |
| Master Data            | `live-course-categories`         | — |
| Master Data            | `customer-masters.states`        | — |
| Master Data            | `customer-masters.districts`     | — |
| Master Data            | `customer-masters.educations`    | — |
| Master Data            | `customer-masters.target-goals`  | — |
| Address                | `address.states`                 | — |
| Address                | `address.cities`                 | — |
| Courses                | `courses`                        | — |
| Courses                | `courses.plans`                  | — |
| Courses                | `courses.video-categories`       | — |
| Courses                | `courses.videos`                 | — |
| Courses                | `courses.materials`              | — |
| Live Courses           | `live-courses`                   | — |
| Live Courses           | `live-courses.plans`             | — |
| Live Courses           | `live-courses.folders`           | — |
| Live Courses           | `live-courses.videos`            | — |
| Live Courses           | `live-courses.subscriptions`     | — |
| Live Sessions          | `live-sessions`                  | `start`, `end`, `cancel` |
| Live Sessions          | `live-sessions.chat`             | `moderate` |
| Live Sessions          | `live-sessions.polls`            | `publish` |
| Live Sessions          | `live-sessions.streamos`         | — |
| Test Series            | `test-series`                    | — |
| Test Series            | `test-series.plans`              | — |
| Test Series            | `test-series.subscriptions`      | — |
| Ebooks / Books         | `ebooks`                         | — |
| Ebooks / Books         | `ebooks.plans`                   | — |
| Ebooks / Books         | `ebooks.subscriptions`           | — |
| Ebooks / Books         | `books`                          | — |
| Ebooks / Books         | `books.orders`                   | `update-status` |
| Packages               | `packages`                       | — |
| Packages               | `packages.types`                 | — |
| Packages               | `packages.plans`                 | `attach`, `detach` |
| Packages               | `plans`                          | — |
| Study Materials        | `study-materials`                | — |
| Study Materials        | `study-materials.categories`     | `duplicate` |
| Exam Countdowns        | `exam-countdowns`                | — |
| Exam Countdowns        | `exam-countdowns.categories`     | — |
| Quizzes                | `quizzes`                        | `publish`, `unpublish` |
| Quizzes                | `quizzes.categories`             | — |
| Quizzes                | `quizzes.questions`              | `import`, `export` |
| Quizzes                | `quizzes.submissions`            | `invalidate` |
| Quizzes                | `quizzes.analytics`              | view, list only |
| Videos                 | `videos`                         | — |
| Videos                 | `videos.categories`              | `duplicate` |
| Customers              | `customers`                      | `view-details` |
| Customers              | `customers.addresses`            | — |
| Customers              | `customers.course-subscriptions` | `extend`, `revoke` |
| Customers              | `customers.ebook-subscriptions`  | `extend`, `revoke` |
| Subscriptions          | `subscriptions`                  | — |
| Subscriptions          | `subscriptions.reports`          | view, list, `export` |
| RBAC                   | `administrators`                 | `assign-role`, `reset-password` |
| RBAC                   | `roles`                          | `assign-permissions` |
| RBAC                   | `permissions`                    | view, list only |
| RBAC                   | `permission-categories`          | view, list only |
| RBAC                   | `guards`                         | view, list only |
| Referrals              | `referrals.referrers`            | — |
| Referrals              | `referrals.report`               | view, list, `export` |
| Referrals              | `referrals.transactions`         | — |
| Referrals              | `referrals.terms`                | — |
| Referrals              | `referrals.faqs`                 | — |
| Referrals              | `referrals.settings`             | view, edit only |
| Promoters / Promocodes | `promoters`                      | `view-dashboard` |
| Promoters / Promocodes | `promoters.subscriptions`        | view, list only |
| Promoters / Promocodes | `promocodes`                     | `bulk-delete`, `bulk-status` |
| CMS                    | `cms.banners`                    | — |
| CMS                    | `cms.live-banners`               | — |
| CMS                    | `cms.popups`                     | — |
| CMS                    | `cms.testimonials`               | — |
| CMS                    | `cms.faqs`                       | — |
| CMS                    | `cms.faq-types`                  | — |
| CMS                    | `cms.terms`                      | — |
| CMS                    | `cms.app-version`                | view, edit only |
| CMS                    | `cms.app-update`                 | view, edit only |
| CMS                    | `cms.social-links`               | — |
| CMS                    | `cms.social-link-types`          | — |
| Offline                | `offline.banners`                | — |
| Offline                | `offline.cities`                 | — |
| Offline                | `offline.centers`                | — |
| Offline                | `offline.batches`                | — |
| Offline                | `offline.enquiries`              | `update-status`, `assign` |
| Departments / Inquiries| `departments`                    | — |
| Departments / Inquiries| `inquiries`                      | `update-status`, `assign` |
| Departments / Inquiries| `inquiries.mobile-app`           | — |
| Notifications          | `notifications`                  | `send`, `bulk-delete` |
| Tracking               | `tracking`                       | view, list only |
| Dashboard              | `dashboard`                      | view only |

---

## 7. Adding a new module (backend dev workflow)

The catalog is a **hand-maintained registry** in
[src/admin/permission/permissions.catalog.ts](../src/admin/permission/permissions.catalog.ts).
This is intentional — auto-scanning routes can't infer labels, groupings,
or which actions are meaningful (a module with 8 routes may only need 3
permissions). The standard RBAC pattern (Laravel Spatie, Django, Casbin)
uses a code-controlled registry for the same reason.

When you ship a new admin module (say `blogs`):

1. Append one line to `PERMISSION_CATALOG`:
   ```ts
   mod("blogs", "Blogs", "Content", {
     extras: [extra("blogs", "publish", "Publish blog")],
   }),
   ```
   - Arg 1: module key (kebab-case, stable forever).
   - Arg 2: human label.
   - Arg 3: group (top-level UI heading).
   - `extras`: any non-standard actions beyond the standard 6.
   - `standard: ["view", "list"]` to opt into a subset (read-only modules).

2. Bump `CATALOG_VERSION` (e.g. `"2026.05.21-1"`).

3. Restart the server. The seeder inserts the new permission rows into
   `ws_permissions`. The frontend sees a new `version` on next catalog
   fetch, busts its `sessionStorage` cache, and the new module appears in
   the Roles tree automatically.

**No frontend changes, no DB migrations, no manual SQL** — one line +
version bump.

### Removing a module

Delete its entry from `PERMISSION_CATALOG` and bump the version. The DB
rows stay (so existing roles don't silently lose access); they appear in
`data.deprecated` and the frontend banner prompts admins to clean up role
assignments. Hard-delete via a one-off script later, once no role
references them.

---

## 8. Migration checklist (frontend)

- [ ] Add an API client method for `GET /admin/permissions/catalog`.
- [ ] Cache the response by `version` in `sessionStorage`.
- [ ] Replace the Roles permission picker with a checkbox tree sourced from
      the catalog (grouped by `module.group` → `module.label`).
- [ ] On Role save, map selected keys → permission `_id`s and `PUT
      /admin/roles/:id { permissionIds }`.
- [ ] Hide / remove **Add Permission** button on `/admin/permissions`.
- [ ] Hide / remove **Add Category** and **Edit Category** buttons on
      `/admin/permission-categories`.
- [ ] Show a deprecated-permissions warning banner when
      `data.deprecated.length > 0`.
- [ ] (Optional) Wire `can("module.action")` helpers in feature pages to
      hide buttons the user isn't authorized for.

---

## 9. Open questions for frontend

1. Do you need the catalog response to include each permission's DB `_id`
   directly (avoids a second `GET /admin/permissions` call to map keys →
   ids on Role save)? Easy backend addition if yes.
2. Should the current-user `/auth/me` response expose `permissionKeys: string[]`
   for client-side `can()` checks? Currently returns ids only.

Ping backend on both if needed — independent of this rollout.
