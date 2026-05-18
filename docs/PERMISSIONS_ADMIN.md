# Permissions & Permission Categories (Admin)

Admin-side APIs for managing **permission categories** (groupings like "Course Management", "User Management") and **permissions** (atomic rights like `course.create`, `user.delete`). Permissions now belong to a category via a real DB relation (`Permission.categoryId → PermissionCategory`), replacing the old name-prefix grouping.

All endpoints require a logged-in admin with the `super_admin` role.

```
Authorization: Bearer <admin-token>
```

---

## What is a "guard"?

A **guard** identifies *which kind of user* a permission/role applies to. The system supports three guards, each gating a separate dashboard:

| Guard       | Applies to                                  | Token issuer                 | Typical use                                                      |
| ----------- | ------------------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `web`       | Internal admin staff (the Admin Dashboard)  | `/api/v1/admin/auth/login`   | Managing courses, users, content, payments — back-office actions |
| `educator`  | Educators / instructors (Educator Portal)   | educator auth flow           | Upload lectures, manage their own course content                 |
| `promoter`  | Affiliate / referral promoters              | promoter auth flow           | Track referrals, withdrawals, view their dashboard               |

A permission like `course.create` under guard `web` lives in a **completely separate namespace** from `course.create` under guard `educator`. The unique constraint is on `(name, guardName)`, so the same `name` can exist under different guards with different meanings.

> A role under guard `web` can only hold `web` permissions. The same applies to `educator` and `promoter`. Mixing across guards is invalid.

Source: [src/admin/permission/permission.validation.ts](../src/admin/permission/permission.validation.ts) → `GUARDS = ["web", "educator", "promoter"]`.

---

# 1. Permission Categories

Manages the grouping bucket that permissions belong to.

Base path: `/api/v1/admin/permission-categories`

## 1.1 List categories

```
GET /api/v1/admin/permission-categories
```

### Query Params

| Param      | Type    | Default      | Notes                                                       |
| ---------- | ------- | ------------ | ----------------------------------------------------------- |
| `search`   | string  | —            | Case-insensitive match on `title`                           |
| `status`   | boolean | —            | `true` / `false` — filter active/inactive                   |
| `page`     | number  | `1`          |                                                             |
| `per_page` | number  | `20`         | Max `200`                                                   |
| `sort_by`  | enum    | `order`      | `id`, `title`, `order`, `created_at`, `updated_at`          |
| `sort_dir` | enum    | `asc`        | `asc` or `desc`                                             |

### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "670a1b2c3d4e5f6000000001",
        "title": "Course Management",
        "slug": "course-management",
        "order": 1,
        "status": true,
        "permission_count": 12,
        "created_at": "2026-05-10T10:00:00.000Z",
        "updated_at": "2026-05-10T10:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "per_page": 20, "total": 1 }
  }
}
```

`permission_count` is the number of `Permission` documents currently linked to this category (across all guards).

## 1.2 Get category by id

```
GET /api/v1/admin/permission-categories/:id
```

### Response `200 OK`

Same shape as list item.

### Errors

- `400` — invalid id
- `404` — not found

## 1.3 Create category

```
POST /api/v1/admin/permission-categories
```

### Body

| Field    | Type    | Required | Notes                                                                         |
| -------- | ------- | -------- | ----------------------------------------------------------------------------- |
| `title`  | string  | yes      | Display name, max 255                                                         |
| `slug`   | string  | yes      | Unique. Lowercase alphanumeric with hyphens (`/^[a-z0-9]+(-[a-z0-9]+)*$/`)    |
| `order`  | number  | no       | Default `0` — used for ascending display order                                |
| `status` | boolean | no       | Default `true` — inactive categories cannot be assigned to new permissions    |

### Response `201 Created`

```json
{
  "success": true,
  "message": "Permission category created successfully",
  "data": {
    "id": "670a1b2c3d4e5f6000000001",
    "title": "Course Management",
    "slug": "course-management",
    "order": 1,
    "status": true,
    "permission_count": 0,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### Errors

- `422` — validation failed (`errors` map keyed by field)
- `409` — slug already exists

## 1.4 Update category

```
PUT /api/v1/admin/permission-categories/:id
```

### Body

All fields optional. Same validation rules as create. Slug uniqueness re-checked when changed.

### Response `200 OK`

Same shape as get.

### Errors

- `400` — invalid id
- `404` — not found
- `409` — slug conflict
- `422` — validation failed

## 1.5 Delete category

```
DELETE /api/v1/admin/permission-categories/:id
```

Hard-deletes the category.

### Response `200 OK`

```json
{ "success": true, "message": "Permission category deleted successfully", "data": {} }
```

### Errors

- `400` — invalid id
- `404` — not found
- `409` — `"Category has permissions assigned and cannot be deleted"` — reassign or delete those permissions first.

---

# 2. Permissions

Base path: `/api/v1/admin/permissions`

Every permission belongs to **one** `PermissionCategory` (required) and one `guardName`.

## 2.1 List permissions

```
GET /api/v1/admin/permissions
```

### Query Params

| Param         | Type   | Default        | Notes                                                            |
| ------------- | ------ | -------------- | ---------------------------------------------------------------- |
| `guard`       | enum   | —              | `web` / `educator` / `promoter`                                  |
| `category_id` | string | —              | Filter by `PermissionCategory` id                                |
| `search`      | string | —              | Case-insensitive match on `name`                                 |
| `page`        | number | `1`            |                                                                  |
| `per_page`    | number | `20`           | Max `200`                                                        |
| `sort_by`     | enum   | `created_at`   | `id`, `name`, `created_at`, `updated_at`                         |
| `sort_dir`    | enum   | `desc`         | `asc` or `desc`                                                  |

### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "670c1b2c3d4e5f6000000101",
        "name": "course.create",
        "guard_name": "web",
        "category": {
          "id": "670a1b2c3d4e5f6000000001",
          "title": "Course Management",
          "slug": "course-management"
        },
        "assigned_role_count": 3,
        "created_at": "...",
        "updated_at": "..."
      }
    ],
    "pagination": { "page": 1, "per_page": 20, "total": 1 }
  }
}
```

`assigned_role_count` is the number of `Role` documents referencing this permission.

## 2.2 Get permission

```
GET /api/v1/admin/permissions/:id?guard=web
```

Same item shape as list, plus an attached `roles` array of `{ id, name, guard_name }`.

### Errors

- `400` — invalid id
- `404` — not found

## 2.3 Create permission

```
POST /api/v1/admin/permissions
```

### Body

| Field         | Type   | Required | Notes                                                          |
| ------------- | ------ | -------- | -------------------------------------------------------------- |
| `name`        | string | yes      | e.g. `"course.create"`, max 255                                |
| `guard`       | enum   | yes      | `web` / `educator` / `promoter`                                |
| `category_id` | string | yes      | Must be an existing `PermissionCategory` with `status = true`  |

### Response `201 Created`

```json
{
  "success": true,
  "message": "Permission created successfully",
  "data": {
    "id": "670c1b2c3d4e5f6000000101",
    "name": "course.create",
    "guard_name": "web",
    "category": { "id": "...", "title": "Course Management", "slug": "course-management" },
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### Errors

- `400` — invalid or inactive `category_id`
- `409` — `Permission '<name>' already exists for guard '<guard>'`
- `422` — validation failed

## 2.4 Update permission

```
PUT /api/v1/admin/permissions/:id
```

### Body

All fields optional: `name`, `guard`, `category_id`. Same validation as create. Uniqueness of `(name, guardName)` re-checked when either changes. `category_id` (if provided) must reference an active category.

## 2.5 Delete permission

```
DELETE /api/v1/admin/permissions/:id
```

Refuses deletion (`409`) if any `Role` or `AdminUser` references it.

## 2.6 List roles using a permission

```
GET /api/v1/admin/permissions/:id/roles?guard=web
```

Returns roles that have this permission attached.

## 2.7 Permissions tree (grouped by guard → category)

```
GET /api/v1/admin/permissions/tree
```

Returns all permissions grouped first by guard, then by category. Useful for rendering the role-editor checkbox tree.

### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "web": {
      "course-management": {
        "id": "670a1b2c3d4e5f6000000001",
        "title": "Course Management",
        "slug": "course-management",
        "order": 1,
        "permissions": [
          { "id": "670c1b2c3d4e5f6000000101", "name": "course.create" },
          { "id": "670c1b2c3d4e5f6000000102", "name": "course.update" }
        ]
      },
      "user-management": {
        "id": "670a1b2c3d4e5f6000000002",
        "title": "User Management",
        "slug": "user-management",
        "order": 2,
        "permissions": [
          { "id": "670c1b2c3d4e5f6000000201", "name": "user.view" }
        ]
      }
    },
    "educator": { "...": "..." },
    "promoter": { "...": "..." }
  }
}
```

> Permissions without a valid category are skipped from the tree (shouldn't happen after migration — see below).

---

# 3. How a Permission links to a Category

1. **Create the category first** (`POST /permission-categories`). You get back an `id`.
2. **Pass that `id` as `category_id`** when creating the permission (`POST /permissions`).
3. The Permission document stores `categoryId: ObjectId(ref → PermissionCategory)`. On read, the category is `populate()`-ed into the response as `category: { id, title, slug }`.
4. The grouping in the tree (`GET /permissions/tree`) is driven by this real relation, not by the permission name's prefix anymore.

### Re-categorising

To move a permission to a different category, `PUT /permissions/:id` with `{ "category_id": "<new-id>" }`. To rename a category (without moving its permissions), `PUT /permission-categories/:id` with `{ "title": "...", "slug": "..." }`.

### Migration note for existing data

The `categoryId` field is **required**. Existing rows in `ws_permissions` without a category will fail validation on save. Before deploying, backfill:

1. Create the initial set of `PermissionCategory` rows.
2. For each existing `Permission`, set `categoryId` (e.g. inferring from the old name prefix).
3. Then the new model's `required: true` constraint will hold for all writes.

---

# 4. Source

- Permission model: [src/models/admin/Permission.model.ts](../src/models/admin/Permission.model.ts)
- PermissionCategory model: [src/models/admin/PermissionCategory.model.ts](../src/models/admin/PermissionCategory.model.ts)
- Permission controller: [src/admin/permission/permission.controller.ts](../src/admin/permission/permission.controller.ts)
- Permission routes: [src/admin/permission/permission.routes.ts](../src/admin/permission/permission.routes.ts)
- PermissionCategory controller: [src/admin/permissionCategory/permissionCategory.controller.ts](../src/admin/permissionCategory/permissionCategory.controller.ts)
- PermissionCategory routes: [src/admin/permissionCategory/permissionCategory.routes.ts](../src/admin/permissionCategory/permissionCategory.routes.ts)
- Admin router mount: [src/admin/admin.routes.ts](../src/admin/admin.routes.ts)
