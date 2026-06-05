# Package Course Material (PC Material) — Admin API

**Date:** 2026-06-05
**Backend status:** Live on this branch.
**Audience:** Admin panel frontend.

A small single-field master: each Package Course Material is just a **`title`**
(e.g. "Talati Cum Mantri and Jr Clerk"). This powers the "Package Course
Material" list/add/edit screens. The API is **JSON-only** — no file upload, no
multipart.

> Backed by the existing `PackageCourseMaterial` model (collection
> `ws_package_course_materials`). This is the same master that older builds
> reached via `/admin/master/materials` (multipart) and `/admin/courses/materials`;
> the new `/admin/pc-materials` routes below are the clean JSON variant — prefer
> these for the dedicated PC Material screens.

---

## Base

```
/api/v1/admin/pc-materials
```

**Auth:** Bearer token, role `admin` or `super_admin` (like all admin endpoints).

```
Authorization: Bearer <admin-access-token>
Content-Type: application/json
```

---

## Data shape

```jsonc
{
  "_id": "665f...",
  "title": "Talati Cum Mantri and Jr Clerk",
  "image": null,        // legacy field, always null from these endpoints
  "isActive": true,     // defaults to true on create
  "createdAt": "2026-06-05T08:30:00.000Z",
  "updatedAt": "2026-06-05T08:30:00.000Z"
}
```

The admin form only sends/edits `title`. `image` and `isActive` are not part of
this API's request body (kept on the document for backward compatibility).

---

## Endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| GET | `/api/v1/admin/pc-materials` | — | List all (newest first) |
| GET | `/api/v1/admin/pc-materials/:id` | — | Get one |
| POST | `/api/v1/admin/pc-materials` | `{ "title": "..." }` | Create (Add Material) |
| PUT | `/api/v1/admin/pc-materials/:id` | `{ "title": "..." }` | Update |
| DELETE | `/api/v1/admin/pc-materials/:id` | — | Delete |

---

### 1. List — `GET /api/v1/admin/pc-materials`

Returns every material, sorted by `createdAt` descending. Not paginated.

**200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "665f...",
      "title": "Talati Cum Mantri and Jr Clerk",
      "image": null,
      "isActive": true,
      "createdAt": "2026-06-05T08:30:00.000Z",
      "updatedAt": "2026-06-05T08:30:00.000Z"
    }
  ]
}
```

---

### 2. Get one — `GET /api/v1/admin/pc-materials/:id`

**200**
```json
{ "success": true, "data": { "_id": "665f...", "title": "...", "isActive": true, "...": "..." } }
```

**404** — `{ "success": false, "message": "Material not found." }`
**400** — `{ "success": false, "message": "Invalid material id." }`

---

### 3. Create — `POST /api/v1/admin/pc-materials`

This is the **Submit** button on the "Add Material" form.

**Request**
```json
{ "title": "Talati Cum Mantri and Jr Clerk" }
```

**201**
```json
{
  "success": true,
  "data": {
    "_id": "665f...",
    "title": "Talati Cum Mantri and Jr Clerk",
    "image": null,
    "isActive": true,
    "createdAt": "2026-06-05T08:30:00.000Z",
    "updatedAt": "2026-06-05T08:30:00.000Z"
  }
}
```

---

### 4. Update — `PUT /api/v1/admin/pc-materials/:id`

This is the **Submit** button on the "Update Package Course Material" form.

**Request**
```json
{ "title": "Talati Cum Mantri and Jr Clerk (2026)" }
```

**200** — returns the updated document (same shape as create).

---

### 5. Delete — `DELETE /api/v1/admin/pc-materials/:id`

**200**
```json
{ "success": true, "message": "Material deleted." }
```

---

## Validation & errors

`title` is **required**, trimmed, 1–255 characters. On validation failure the API
returns **400** with a Zod issues array:

```json
{
  "success": false,
  "errors": [
    { "path": ["title"], "message": "Title is required" }
  ]
}
```

Other error responses use `{ "success": false, "message": "..." }`:

| Status | When |
|--------|------|
| 400 | Invalid `:id` (not a Mongo ObjectId), or empty/missing `title` |
| 401 | Missing/expired Bearer token |
| 403 | Authenticated but not `admin` / `super_admin` |
| 404 | No material with that `:id` |

---

## Frontend wiring (admin panel)

```ts
const BASE = "/api/v1/admin/pc-materials";

// List
const { data } = await api.get(BASE);            // -> data.data: Material[]

// Add (Add Material form Submit)
await api.post(BASE, { title });                 // -> 201, data.data: Material

// Edit (Update form Submit)
await api.put(`${BASE}/${id}`, { title });       // -> 200, data.data: Material

// Delete
await api.delete(`${BASE}/${id}`);               // -> 200, { message }
```

- Send the body as JSON (`Content-Type: application/json`) — **not** FormData.
- The form has a single text input bound to `title`; everything else is server-managed.
- On a 400 with `errors`, surface `errors[0].message` under the title field.

---

## Notes

- This master is currently standalone (not linked to Package/Course records).
  The earlier `pcMaterialId` link on Package/Course was removed — see
  [PC_MATERIAL_REMOVAL_ADMIN.md](./PC_MATERIAL_REMOVAL_ADMIN.md). These CRUD
  endpoints remain so the PC Material list can still be managed.
