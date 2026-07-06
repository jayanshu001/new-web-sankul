# Material Categories — Nested (Parent / Child) Support for Admin UI

**Audience:** Admin web UI team.
**Goal:** Build the UI for managing nested material categories. The backend stores parent/child relationships using `childCategoryIds[]` on the parent — same shape as Video and Exam categories. Keep all three UIs consistent.

All endpoints are mounted under:

```
/api/v1/admin/materials/categories
```

Auth: `Bearer <admin token>` + role `admin` / `super_admin`.

---

## 1. The canonical relationship field

Every material category document carries a `childCategoryIds: ObjectId[]` array that lists **its direct children**. This is the source of truth the UI should display and edit.

Backend continues to maintain `parent` (singular) and `ancestors[]` on each child as well, but those are internal/legacy — the UI does **not** need to touch them. (They stay in sync automatically when `childCategoryIds[]` mutates.)

> Same field name and behavior as Video and Exam categories — one mental model, three modules.

---

## 2. Data model

```json
{
  "_id": "66f0a1b2c3d4e5f600000010",
  "title": "Current Affairs",
  "slug": "current-affairs",
  "image": "https://cdn.example.com/cats/current-affairs.png",
  "childCategoryIds": [
    "66f0a1b2c3d4e5f600000100",
    "66f0a1b2c3d4e5f600000101"
  ],
  "order": 1,
  "status": true,
  "parent": "66f0a1b2c3d4e5f600000001",   // backend-maintained; read-only for UI
  "ancestors": [                            // backend-maintained; read-only for UI
    "66f0a1b2c3d4e5f600000001"
  ],
  "createdAt": "2026-05-01T10:00:00.000Z",
  "updatedAt": "2026-05-12T08:30:00.000Z"
}
```

| Field | Read | Write (UI) |
|---|---|---|
| `childCategoryIds` | ✅ list of direct children | ✅ send the new full array of children when editing |
| `title`, `slug`, `image`, `order`, `status` | ✅ | ✅ |
| `parent`, `ancestors` | ✅ | ❌ (backend maintains these from `childCategoryIds` mutations) |

**Sibling sort:** `order` asc, then `title`.

> **Note the field names differ from Exam.** Material uses `title` (not `name`) and `order` (not `orderBy`) and `parent` (not `parentId`). The relationship field — `childCategoryIds` — is the same.

---

## 3. Endpoints the UI needs

### 3.1 `GET /categories?parent=…` — list at one level

| Query param   | Value                          | Meaning |
|---------------|--------------------------------|---------|
| `parent`      | `"root"` or `"null"`           | Return root categories. |
| `parent`      | `<ObjectId>`                   | Return direct children of that category. |
| `parent`      | *(omitted)*                    | Returns **everything, flat** (no parent filter). Avoid for the tree UI. |
| `search`      | string                         | Case-insensitive substring match on `title`. |
| `status`      | `"true"` / `"false"`           | Filter active/inactive. |
| `tree`        | `"true"`                       | Returns the full nested tree (overrides other filters except `status`). Same response shape as Exam's `/tree`. |

**Response 200**
```json
{ "success": true, "data": [ /* MaterialCategory rows, each with childCategoryIds[] */ ] }
```

Sorted by `order` asc, then `title`.

### 3.2 `GET /categories?tree=true` — full tree (in-line, no separate endpoint)

Returns the active rows as a nested tree. Each node has a `children: []` array attached.

```json
{
  "success": true,
  "data": [
    {
      "_id": "…rootA",
      "title": "Current Affairs",
      "childCategoryIds": ["…childA1"],
      "children": [
        {
          "_id": "…childA1",
          "title": "Daily News",
          "childCategoryIds": [],
          "children": []
        }
      ]
    }
  ]
}
```

### 3.3 `GET /categories/:id` — single row (for edit)

Returns the row including `childCategoryIds[]`.

### 3.4 `POST /categories` — create

`multipart/form-data` (because of optional `image`).

| Field             | Type             | Required | Notes |
|-------------------|------------------|----------|-------|
| `title`           | string           | yes      | 1–255 chars. |
| `slug`            | string           | no       | Defaults to a slugified `title` if omitted. |
| `image`           | file             | no       | PNG/JPG/WEBP. |
| `parent`          | string (ObjectId) **or empty / omitted** | no | Omit for a **root** category. Send the parent's `_id` to nest. Backend will also add the new row to that parent's `childCategoryIds[]`. |
| `childCategoryIds`| ObjectId[] **or** comma-separated string | no | List of **existing** categories to re-parent under the newly created row. |
| `order`           | number           | no       | Default `0`. |
| `status`          | boolean          | no       | Default `true`. |

### 3.5 `PUT /categories/:id` — update / move / reparent

Same fields as create, all optional.

**Two ways to change the tree:**
1. **Edit the parent's `childCategoryIds[]`** (preferred). Backend detaches each child from its old parent automatically.
2. **Edit the child's `parent`** to point at a new parent (or `null` / empty string to make it a root).

Backend behavior:
- Recomputes `ancestors[]` on the moved row.
- Cascades `ancestors[]` recompute through all descendants.
- Rejects `400 "Category cannot be its own parent."` if `parent === :id`.
- Rejects `422 "A category cannot be its own child"` / `"Cycle detected: …"` / `"One or more childCategoryIds are invalid"` / `"Parent category not found"` for bad `childCategoryIds[]`.

### 3.6 Other useful endpoints already in the module

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/categories/reorder` | Bulk-reorder siblings (`{ orders: [{ id, order }] }`). |
| `PATCH`| `/categories/:id/status` | Toggle `status`. |
| `POST` | `/categories/:id/duplicate` | Duplicate a category (server picks a `(Copy N)` title automatically). |
| `GET`  | `/categories/:id/courses` | Courses that reference this category (use for delete UX warning). |
| `GET`  | `/categories/:id/materials` | Materials inside this category. |

### 3.7 `DELETE /categories/:id`

Returns `400` if the category has either:
- sub-categories (`childCategoryIds.length > 0`), **or**
- materials attached (`Material.materialCategoryId === :id`).

UI should disable the delete button when `row.childCategoryIds.length > 0` and surface the server error otherwise.

---

## 4. UI requirements

Same shape as the Exam category UI doc — pick one pattern and reuse the component:

- **Children multi-select** on create/edit form, sourced from a search endpoint. Filter out the row itself and any ancestors.
- **Two-pane drill-down** or **tree view** for listing.
- **"Has children" badge** driven by `row.childCategoryIds.length > 0`.
- **Add Sub-category** quick action that opens create with `parent` pre-filled.
- **Move-To dialog** that calls `PUT /categories/:id` with a new `parent` (or with a new `childCategoryIds[]` on the target parent).
- **Delete UX** that checks `row.childCategoryIds.length` before calling delete.

---

## 5. Error responses to handle

| Status | Message | When |
|---|---|---|
| 400 | `Invalid category id.` | Bad `:id`. |
| 400 | `Category cannot be its own parent.` | `parent === :id`. |
| 400 | `Category has sub-categories. Delete or reassign them first.` | Delete with children. |
| 400 | `Category has materials. Delete or reassign them first.` | Delete with attached materials. |
| 400 | Zod issues array on `errors[]` | Body validation. |
| 404 | `Category not found.` | Wrong id. |
| 422 | `A category cannot be its own child` | `childCategoryIds[]` contains own id. |
| 422 | `Cycle detected: one of the selected categories is an ancestor of this category` | Tried to make an ancestor a child. |
| 422 | `One or more childCategoryIds are invalid` | Bad ids. |
| 404 | `Parent category not found` | The `parent` value points at a row that doesn't exist. |

---

## 6. Example request bodies

### Create a root category
```http
POST /api/v1/admin/materials/categories
Content-Type: multipart/form-data

title=Current Affairs
order=1
image=<file>
```

### Create a child under "Current Affairs"
```http
POST /api/v1/admin/materials/categories
Content-Type: multipart/form-data

title=Daily News
parent=66f0a1b2c3d4e5f600000010
order=1
```

### Reparent existing categories in one shot
```http
POST /api/v1/admin/materials/categories
Content-Type: multipart/form-data

title=Daily News
childCategoryIds[]=66f0a1b2c3d4e5f600000100
childCategoryIds[]=66f0a1b2c3d4e5f600000101
```

### Move a row to a different parent
```http
PUT /api/v1/admin/materials/categories/<id>
Content-Type: multipart/form-data

parent=66f0a1b2c3d4e5f600000020
```

### Promote a row back to root
```http
PUT /api/v1/admin/materials/categories/<id>
Content-Type: multipart/form-data

parent=
```

---

## 7. Why this matters for the client app

`GET /api/v1/client/material-categories/:id/children` reads from `childCategoryIds[]` and surfaces a `havingChildDirectory` flag on each card. If admins can't manage `childCategoryIds[]`, the client app's drill-down stays empty.

---

## 8. Backend source

- Model: [src/models/course/MaterialCategory.model.ts](../src/models/course/MaterialCategory.model.ts)
- Validators: [src/admin/material/material.validation.ts](../src/admin/material/material.validation.ts) (`createMaterialCategorySchema`, `updateMaterialCategorySchema`)
- Controller: [src/admin/material/material.controller.ts](../src/admin/material/material.controller.ts) (`listCategories`, `getCategoryById`, `createCategory`, `updateCategory`, `deleteCategory`, `attachChildrenToParent`)
- Routes: [src/admin/material/material.routes.ts](../src/admin/material/material.routes.ts)
