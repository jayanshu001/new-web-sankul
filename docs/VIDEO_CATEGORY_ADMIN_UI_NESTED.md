# Video Categories — Nested (Parent / Child) Support for Admin UI

**Audience:** Admin web UI team.
**Goal:** Build the UI for managing nested video categories. Video categories use `childCategoryIds[]` natively (this is the module that all three category types are now aligned with).

All endpoints are mounted under:

```
/api/v1/admin/video-categories
```

Auth: `Bearer <admin token>` + role `admin` / `super_admin`.

---

## 1. The canonical relationship field

Every video category document carries a `childCategoryIds: ObjectId[]` array that lists **its direct children**. This is the source of truth.

> Video categories do **not** have a `parent` / `parentId` / `ancestors` field — the relationship is only stored on the parent side. (Material and Exam keep both sides for back-compat; Video keeps only `childCategoryIds[]`.)

> To find a category's parent in the UI, you have two options:
> - Read the active tree (`GET /?tree=true` style — if available) and walk it.
> - Or just keep the breadcrumb in the navigation state as the user drills in; you usually know which node you came from.

---

## 2. Data model

```json
{
  "_id": "66f0a1b2c3d4e5f600000010",
  "title": "Indian Polity",
  "slug": "indian-polity",
  "image": "https://cdn.example.com/cats/polity.png",
  "courseId": null,
  "liveCourseId": null,
  "childCategoryIds": [
    "66f0a1b2c3d4e5f600000100",
    "66f0a1b2c3d4e5f600000101"
  ],
  "educatorId": "66f0a1b2c3d4e5f600000900",
  "order_by": 1,
  "status": true,
  "createdAt": "2026-05-01T10:00:00.000Z",
  "updatedAt": "2026-05-12T08:30:00.000Z"
}
```

| Field | Read | Write (UI) |
|---|---|---|
| `childCategoryIds` | ✅ list of direct children | ✅ send the new full array of children when editing |
| `title`, `slug`, `image`, `order_by`, `status` | ✅ | ✅ |
| `courseId`, `liveCourseId`, `educatorId` | ✅ | ✅ — optional refs |

**Sibling sort:** `order_by` asc (request via `sort_by=order&sort_dir=asc`).

> **Field-name reminders** — Video uses `title` and `order_by` (snake_case here, unlike Material's `order` and Exam's `orderBy`). Only `childCategoryIds` is identical across the three.

---

## 3. Endpoints the UI needs

### 3.1 `GET /` — paginated list

Used by the main category management table.

| Query param         | Notes |
|---------------------|-------|
| `search`            | Substring match on `title`. |
| `status`            | `"true"` / `"false"`. |
| `educatorId`        | Filter by educator. |
| `childCategoryId`   | "Find the parents that contain this category as a child" — useful to locate a row's parent in the UI. |
| `page`              | Default `1`. |
| `per_page`          | Default `20`, max `200`. |
| `sort_by`           | `"name"` / `"order"` / `"created_at"` / `"updated_at"` (server maps these to actual fields). |
| `sort_dir`          | `"asc"` / `"desc"`. |

**Response 200** — paginated list of category rows, each with `childCategoryIds[]`.

### 3.2 `GET /pre-requisites` — picker data for the form

Returns the lookups the form needs (educators, courses, live-courses, candidate child categories). Use to populate the multi-select / dropdowns on the create / edit form.

### 3.3 `GET /:id` — single row for edit

Returns the row including its `childCategoryIds[]`.

### 3.4 `POST /` — create

`multipart/form-data`.

| Field             | Type             | Required | Notes |
|-------------------|------------------|----------|-------|
| `name`            | string           | yes      | 1–255 chars. Maps to the document's `title` field in the response. |
| `slug`            | string           | yes      | 1–255 chars. |
| `image`           | file             | no       | PNG/JPG/WEBP. |
| `childCategoryIds`| ObjectId[] **or** comma-separated string | no | Direct children of this category. |
| `educatorId`      | ObjectId         | no       | |
| `order`           | number           | no       | Maps to `order_by` in the response. |
| `status`          | boolean          | no       | Default `true`. |

> ⚠️ **Video has no `parent` input field.** To create a child under an existing category, **save the new row first, then edit the parent and add the new row's `_id` to the parent's `childCategoryIds[]`**. (Alternative: have the UI do both calls behind a single "Add Sub-category" action.)

### 3.5 `PUT /:id` — update

Same fields as create, all optional. The only way to change the tree is to **edit the parent's `childCategoryIds[]`**. There is no `parent` field on Video to flip from the child side.

### 3.6 `DELETE /:id`

Deletes the category. The UI should check whether any other category lists this one in its `childCategoryIds[]` before deleting — orphaning children is technically allowed by the API but breaks the tree.

### 3.7 `PATCH /:id/status` — toggle status

### 3.8 `POST /:id/duplicate` — duplicate the category

---

## 4. UI requirements

The Video module is the reference design — what you build here is the pattern to mirror in Material and Exam:

- **Children multi-select** on the create / edit form. Source: `GET /` (or `/pre-requisites`). Filter out the row itself. Server does NOT auto-detach the children from their previous parent's array on Video — be conscious that an id can technically appear in multiple parents' `childCategoryIds[]`. Use this only when you know the intent.
- **Listing screen** — paginated table is fine. Show a "Has children" badge using `row.childCategoryIds.length > 0`.
- **Add Sub-category quick action** — opens the create form, then after save, hits `PUT /:parent_id` adding the new row's `_id` to the parent's `childCategoryIds[]`.
- **Children panel on the edit screen** — render the populated children inline (one extra request to `GET /?` filtered by ids, or just show `_id`/`title` chips from the multi-select).

---

## 5. Error responses

| Status | When |
|---|---|
| 400 | Zod validation issues (`errors[]` payload). |
| 400 | `Invalid category id.` |
| 404 | Wrong id. |
| 500 | Generic server error. |

> Video's controller does not currently enforce a `400` on delete when children/videos are attached — be defensive on the UI side.

---

## 6. Example request bodies

### Create a category (no parent)
```http
POST /api/v1/admin/video-categories
Content-Type: multipart/form-data

name=Indian Polity
slug=indian-polity
order=1
status=true
image=<file>
```

### Attach children to an existing category
```http
PUT /api/v1/admin/video-categories/66f0a1b2c3d4e5f600000010
Content-Type: multipart/form-data

childCategoryIds[]=66f0a1b2c3d4e5f600000100
childCategoryIds[]=66f0a1b2c3d4e5f600000101
```

### Detach a child (remove its id from the parent's array)
Re-send the parent's `childCategoryIds[]` without that id:
```http
PUT /api/v1/admin/video-categories/66f0a1b2c3d4e5f600000010
Content-Type: multipart/form-data

childCategoryIds[]=66f0a1b2c3d4e5f600000100
```

---

## 7. Why this matters for the client app

`GET /api/v1/client/video-categories/:id/children` reads from `childCategoryIds[]` and exposes a `havingChildDirectory` flag per child. If the admin UI never builds children, the client app sees a flat list.

---

## 8. Differences vs Material / Exam (cheat sheet)

| | Video | Material | Exam |
|---|---|---|---|
| Children field | `childCategoryIds[]` | `childCategoryIds[]` | `childCategoryIds[]` |
| Parent stored on child? | ❌ no | ✅ `parent` (read-only for UI) | ✅ `parentId` (read-only for UI) |
| Server detaches from old parent automatically when you add a child here | ❌ no | ✅ yes | ✅ yes |
| Cycle prevention on add | ❌ no server-side guard today | ✅ yes (`422`) | ✅ yes (`422`) |
| Sibling sort field | `order_by` | `order` | `orderBy` |
| Display name field | `title` | `title` | `name` |

> Until Video adds server-side detach/cycle-prevention, the admin UI should be careful: avoid putting the same category id into multiple parents' `childCategoryIds[]` arrays.

---

## 9. Backend source

- Model: [src/models/course/VideoCategory.model.ts](../src/models/course/VideoCategory.model.ts)
- Validators: [src/admin/videoCategory/videoCategory.validation.ts](../src/admin/videoCategory/videoCategory.validation.ts)
- Controller: [src/admin/videoCategory/videoCategory.controller.ts](../src/admin/videoCategory/videoCategory.controller.ts)
- Routes: [src/admin/videoCategory/videoCategory.routes.ts](../src/admin/videoCategory/videoCategory.routes.ts)
