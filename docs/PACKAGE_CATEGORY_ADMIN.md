# Package Categories — Admin Frontend Integration

Backend reference: `src/admin/master/packageCategory.controller.ts`, mounted at `/api/v1/admin/master/package-categories`.

Mirrors the existing **Subject Categories** master (`/api/v1/admin/master/subject-categories`) exactly. The only structural difference: each Package Category is linked to a **parent Package** chosen from the Packages listing (`/api/v1/admin/packages`).

---

## 1. Mental Model

- A **Package Category** is a master-data row that groups related items under one Package.
- Parent is a single Package `_id` (picked from [/api/v1/admin/packages](http://localhost:4001/api/v1/admin/packages?limit=100&sortBy=updatedAt&sortOrder=desc)).
- Same CRUD shape, same image upload (S3, multipart `image` field), same `order` + `status` toggles as Subject Categories.
- Collection: `ws_package_categories`. Indexed on `{ packageId, status, order }`.

---

## 2. Auth

All four endpoints require:

```
Authorization: Bearer <admin token>
```

Roles: `admin` or `super_admin` (inherited from the master router).

---

## 3. Endpoints

Base URL: `/api/v1/admin/master/package-categories`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List all package categories (sorted by `order` asc) |
| POST | `/` | Create a package category |
| PUT | `/:id` | Update a package category |
| DELETE | `/:id` | Delete a package category |

### 3.1 List

```
GET /api/v1/admin/master/package-categories
Authorization: Bearer <admin token>
```

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "67f3...",
      "title": "UPSC Prelims Pack",
      "slug": "upsc-prelims-pack",
      "image": "https://cdn.../pkg-cat.png",
      "packageId": {
        "_id": "664a...",
        "name": "UPSC 2026 Foundation",
        "image": "https://cdn.../pkg.png"
      },
      "order": 0,
      "status": true,
      "createdAt": "2026-05-16T10:00:00.000Z",
      "updatedAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

> The admin UI's listing URL form (`?limit=100&sortBy=updatedAt&sortOrder=desc`) is accepted; the backend currently returns the full list ordered by `order` asc — same as Subject Categories. If pagination/sort is needed, the admin should sort/filter client-side just as it does for `subject-categories`.

### 3.2 Create

```
POST /api/v1/admin/master/package-categories
Authorization: Bearer <admin token>
Content-Type: multipart/form-data
```

**Form fields**
| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | ✔ | |
| `slug` | string | ✔ | Must be globally unique |
| `image` | file | ✔* | Multipart file under field name `image` (uploaded to S3). *Either a file OR an `image` string URL must be present. |
| `packageId` | ObjectId string | ✔ | One Package `_id` from `/api/v1/admin/packages` |
| `order` | number | – | Default `0` |
| `status` | boolean | – | Default `true`. Accepts `"true"`/`"false"` strings from form-data |

**201 Created**
```json
{ "success": true, "data": { "_id": "...", "title": "...", "packageId": "664a...", ... } }
```

### 3.3 Update

```
PUT /api/v1/admin/master/package-categories/:id
Authorization: Bearer <admin token>
Content-Type: multipart/form-data
```

All fields are optional (PATCH-style merge). Uploading a new `image` file replaces the old URL.

**200 OK**
```json
{ "success": true, "data": { /* updated row */ } }
```

### 3.4 Delete

```
DELETE /api/v1/admin/master/package-categories/:id
Authorization: Bearer <admin token>
```

**200 OK**
```json
{ "success": true, "message": "Category deleted successfully" }
```

---

## 4. Error Responses

| Status | When | Body |
|---|---|---|
| 400 | Invalid `:id` ObjectId | `{ success: false, message: "Invalid Package Category ID" }` |
| 400 | Validation failure | `{ success: false, errors: [ ...zod issues ] }` |
| 401 | Missing / invalid Bearer | standard auth error |
| 403 | Caller not admin/super_admin | standard role error |
| 404 | Parent Package not found | `{ success: false, message: "Parent package not found" }` |
| 404 | Row not found (update/delete) | `{ success: false, message: "Category not found" }` |
| 500 | Other | `{ success: false, message: "<reason>" }` |

---

## 5. UI Wiring Cheat-sheet

1. **Listing page**: GET the endpoint above, render columns: image, title, slug, `packageId.name`, order, status, actions.
2. **Create / Edit drawer**: identical to Subject Categories — add one extra field: a Package dropdown populated from `/api/v1/admin/packages?limit=100&sortBy=updatedAt&sortOrder=desc`, bound to `packageId`.
3. **Image upload**: send as multipart `image`. The server returns the resolved S3 URL inside `data.image`.
4. **Slug**: enforce uniqueness on submit by surfacing the 500 from the unique index (or pre-check via list).
