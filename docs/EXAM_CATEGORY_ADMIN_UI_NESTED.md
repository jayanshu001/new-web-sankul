# Exam Categories — Nested (Parent / Child) Support for Admin UI

**Audience:** Admin web UI team.
**Goal:** Build the UI for managing nested exam categories. The backend now stores parent/child relationships using the **same `childCategoryIds[]` array on the parent** as Video and Material categories — keep all three UIs consistent.

All endpoints are mounted under:

```
/api/v1/admin/exam/categories
```

Auth: `Bearer <admin token>` + role `admin` / `super_admin`.

---

## 1. The canonical relationship field

Every exam category document carries a `childCategoryIds: ObjectId[]` array that lists **its direct children**. This is the source of truth the UI should display and edit.

Backend continues to maintain `parentId` and `ancestors[]` on each child as well, but those are internal/legacy — the UI does **not** need to know about them. (They stay in sync automatically when the UI writes `childCategoryIds[]`.)

> Same shape as Video and Material categories. The three modules now behave identically — pick one UI pattern, reuse it for all three.

---

## 2. Data model — what every category row looks like

```json
{
  "_id": "66f0a1b2c3d4e5f600000010",
  "name": "Prelims",
  "image": "https://cdn.example.com/cats/prelims.png",
  "childCategoryIds": [
    "66f0a1b2c3d4e5f600000100",
    "66f0a1b2c3d4e5f600000101"
  ],
  "orderBy": 1,
  "status": true,
  "parentId": "66f0a1b2c3d4e5f600000001",   // backend-maintained; read-only for UI
  "ancestors": [                              // backend-maintained; read-only for UI
    "66f0a1b2c3d4e5f600000001"
  ],
  "createdAt": "2026-05-01T10:00:00.000Z",
  "updatedAt": "2026-05-12T08:30:00.000Z"
}
```

| Field | Read | Write (UI) |
|---|---|---|
| `childCategoryIds` | ✅ list of direct children | ✅ send the new full array of children when editing |
| `name`, `image`, `orderBy`, `status` | ✅ | ✅ |
| `parentId`, `ancestors` | ✅ | ❌ (backend maintains these from `childCategoryIds` mutations) |

**Sibling sort:** `orderBy` asc, then `name`.

---

## 3. Endpoints the UI needs

### 3.1 `GET /categories?parentId=…` — list at one level

Use this for **two-pane / drill-down browse UI** (most efficient — only loads what's visible).

| Query param   | Value                          | Meaning |
|---------------|--------------------------------|---------|
| `parentId`    | `"root"` or `"null"`           | Return root categories (those with no parent). |
| `parentId`    | `<ObjectId>`                   | Return direct children of that category. |
| `parentId`    | *(omitted)*                    | Returns **everything, flat** (no parent filter). Avoid for the tree UI. |
| `search`      | string                         | Case-insensitive substring match on `name`. |
| `status`      | `"true"` / `"false"`           | Filter active/inactive. |

**Response 200**
```json
{ "success": true, "data": [ /* ExamCategory rows, each with childCategoryIds[] */ ] }
```

Sorted by `orderBy` asc, then `name`.

> Alternatively, when rendering one category's row, you can just look at its own `childCategoryIds.length` to know whether it has children — no extra call needed for the "has children?" badge.

### 3.2 `GET /categories/tree` — full active tree

Use this for a single-shot tree view (e.g. a TreeView component or a Move-To dialog).

Returns only `status: true` rows. Each node is augmented with a nested `children[]` array.

```json
{
  "success": true,
  "data": [
    {
      "_id": "…rootA",
      "name": "UPSC",
      "childCategoryIds": ["…childA1"],
      "children": [
        {
          "_id": "…childA1",
          "name": "Prelims",
          "childCategoryIds": ["…leaf1"],
          "children": [
            { "_id": "…leaf1", "name": "Mock Test 1", "childCategoryIds": [], "children": [] }
          ]
        }
      ]
    }
  ]
}
```

### 3.3 `GET /categories/:id` — single category (for edit)

Standard get. Returns the row including `childCategoryIds[]` so the form can preselect the existing children in the multi-select.

### 3.4 `POST /categories` — create

`multipart/form-data` (because of optional `image` file upload).

| Field             | Type             | Required | Notes |
|-------------------|------------------|----------|-------|
| `name`            | string           | yes      | 1–255 chars. |
| `image`           | file             | no       | PNG/JPG/WEBP; server returns the S3 URL on the document. |
| `parentId`        | string (ObjectId) **or empty / omitted** | no | Omit for a **root** category. Send the parent's `_id` to nest the new row under it. The server will also add this new row to that parent's `childCategoryIds[]`. |
| `childCategoryIds`| ObjectId[] **or** comma-separated string | no | List of **existing** categories to re-parent under the newly created row (move them in as children). |
| `orderBy`         | number           | no       | Default `0`. |
| `status`          | boolean          | no       | Default `true`. |

> Both `parentId` and `childCategoryIds` can be used together: "create this as a child of X, and also pull these existing categories Y and Z under me."

### 3.5 `PUT /categories/:id` — update / move / reparent

Same fields as create, all optional.

**Two ways to change the tree:**

1. **Edit the parent's `childCategoryIds[]`** — preferred. Send the full desired array of children on a parent. Any added id is moved under this parent; the backend handles detaching from the old parent automatically.
2. **Edit the child's `parentId`** — still supported (you can send `parentId: null` / empty string / a new id). The server keeps both sides in sync.

The server:
- Recomputes the moved category's `ancestors[]`.
- **Cascades the recompute to every descendant** (children, grandchildren, …) so cached ancestor chains stay correct after a subtree move.
- Rejects with `400 "Category cannot be its own parent."` if `parentId === :id`.
- Rejects with `400 "Cannot move a category under one of its own descendants."` if it would create a cycle.
- Rejects with `400 "Parent category not found."` if `parentId` doesn't exist.
- Rejects with `422 "A category cannot be its own child"` / `"Cycle detected: …"` / `"One or more childCategoryIds are invalid"` when `childCategoryIds[]` is misshapen.

### 3.6 `DELETE /categories/:id`

Returns `400` if the category has either:
- sub-categories (`childCategoryIds.length > 0`), **or**
- exams attached (`Exam.categoryId === :id`).

The UI should:
1. Disable the delete button (or show a tooltip "Move children first") when `row.childCategoryIds.length > 0`.
2. Show the server error message inline if the user still hits delete.

---

## 4. UI requirements — what to build

### 4.1 "Children" multi-select on the create/edit form
A `childCategoryIds[]` picker on the form. Should:
- Be a **searchable multi-select** sourced from `GET /categories?status=true` (or `/categories/tree`).
- Default to the current row's `childCategoryIds[]` on edit.
- Filter out the row itself, and any of its existing ancestors (otherwise the server will reject with `422 "Cycle detected: …"`).
- Picking an existing category that already has a parent automatically moves it under the row being saved — make the UI copy reflect that ("Selected items will be moved under this category").

### 4.2 Listing screen — pick ONE pattern

**Option A — Two-pane drill-down**
- Left pane: roots from `GET /categories?parentId=root`.
- Click a row → right pane fetches children via `GET /categories?parentId=<id>`.
- Breadcrumb at the top reflects the active path.
- Pros: scales to large trees, works with inactive rows.

**Option B — Tree view**
- One call to `GET /categories/tree`.
- Expand/collapse nodes inline.
- Pros: full overview.
- Cons: inactive rows are not in this endpoint.

**Required columns / actions on each row**
- Indent / depth indicator.
- `name`, `orderBy`, `status` toggle.
- Quick action: **Add Sub-category** → opens the create form with `parentId = thisRow._id` pre-filled.
- Edit / Delete.
- "Has children" badge driven by `row.childCategoryIds.length > 0`.

### 4.3 Move-To dialog (recommended)
Reuse the tree from `GET /categories/tree`. On submit, either:
- `PUT /categories/<moved_id>` with the new `parentId`, or
- `PUT /categories/<target_parent_id>` with an updated `childCategoryIds[]` array.

Both work; pick whichever feels cleaner.

### 4.4 Delete UX
Before calling delete, check:
- Does `row.childCategoryIds.length > 0`? → Show "This category has X sub-categories. Move or delete them first."
- (Optional) hit `GET /api/v1/admin/exam?categoryId=<id>` to surface attached exam count.

### 4.5 Breadcrumbs
For breadcrumbs (e.g. on the edit screen), you can either walk `childCategoryIds[]` top-down from the tree call, or read the populated `ancestors[]` field directly — both work.

---

## 5. Error responses to handle in the UI

| Status | Body                                                              | When |
|--------|-------------------------------------------------------------------|------|
| 400    | `{ success: false, errors: [...Zod issues] }`                     | Validation failed on create/update. Field path is in `errors[i].path`. |
| 400    | `{ success: false, message: "Invalid category id." }`             | `:id` is not a valid ObjectId. |
| 400    | `{ success: false, message: "Category cannot be its own parent." }` | `parentId === :id`. |
| 400    | `{ success: false, message: "Cannot move a category under one of its own descendants." }` | Would create a cycle. |
| 400    | `{ success: false, message: "Parent category not found." }`      | `parentId` references a non-existent category. |
| 400    | `{ success: false, message: "Category has sub-categories. Delete or reassign them first." }` | Tried to delete a parent with children. |
| 400    | `{ success: false, message: "Category has exams. Reassign or delete them first." }` | Tried to delete a category that has exams attached. |
| 404    | `{ success: false, message: "Category not found." }`              | Wrong id. |
| 422    | `{ success: false, message: "A category cannot be its own child" }` | `childCategoryIds[]` contains the row's own id. |
| 422    | `{ success: false, message: "Cycle detected: …" }`                | `childCategoryIds[]` includes one of this row's ancestors. |
| 422    | `{ success: false, message: "One or more childCategoryIds are invalid" }` | Bad ids in the array. |
| 422    | `{ success: false, message: "Parent category not found" }`        | (From the attach helper.) |
| 500    | `{ success: false, message: "<reason>" }`                         | Server error — generic toast. |

---

## 6. Example request bodies

### Create a root category
```http
POST /api/v1/admin/exam/categories
Content-Type: multipart/form-data

name=UPSC
orderBy=1
status=true
image=<file>
```

### Create a child category under "UPSC"
```http
POST /api/v1/admin/exam/categories
Content-Type: multipart/form-data

name=Prelims
parentId=66f0a1b2c3d4e5f600000001
orderBy=1
status=true
```

### Reparent two existing categories under a new "Prelims" row in one shot
```http
POST /api/v1/admin/exam/categories
Content-Type: multipart/form-data

name=Prelims
childCategoryIds[]=66f0a1b2c3d4e5f600000100
childCategoryIds[]=66f0a1b2c3d4e5f600000101
```

### Move "Prelims" under a different root (e.g. "State PSC")
```http
PUT /api/v1/admin/exam/categories/66f0a1b2c3d4e5f600000010
Content-Type: multipart/form-data

parentId=66f0a1b2c3d4e5f600000002
```

### Promote "Prelims" back to root
```http
PUT /api/v1/admin/exam/categories/66f0a1b2c3d4e5f600000010
Content-Type: multipart/form-data

parentId=
```

### Replace the children of "Prelims"
```http
PUT /api/v1/admin/exam/categories/66f0a1b2c3d4e5f600000010
Content-Type: multipart/form-data

childCategoryIds[]=66f0a1b2c3d4e5f600000201
childCategoryIds[]=66f0a1b2c3d4e5f600000202
```
(Children listed here are moved under "Prelims"; any previous children of "Prelims" that you omit will **not** be automatically detached — they remain children. To detach a child, either move it elsewhere or update its own `parentId`.)

---

## 7. Why this matters for the client app

The client at `GET /api/v1/client/exam-categories/:id/children` reads from `childCategoryIds[]` and surfaces a `havingChildDirectory` flag on each card. **If admins can't manage `childCategoryIds[]` from the UI, the client app sees a flat list — no drill-down content appears, even though the screens are built for it.**

---

## 8. Backend source

- Model: [src/models/exam/ExamCategory.model.ts](../src/models/exam/ExamCategory.model.ts)
- Validators: [src/admin/exam/exam.validation.ts](../src/admin/exam/exam.validation.ts) (`createCategorySchema`, `updateCategorySchema`)
- Controller: [src/admin/exam/exam.controller.ts](../src/admin/exam/exam.controller.ts) (`getCategories`, `getCategoryTree`, `getCategoryById`, `createCategory`, `updateCategory`, `deleteCategory`, `attachExamChildren`)
- Routes: [src/admin/exam/exam.routes.ts](../src/admin/exam/exam.routes.ts)
