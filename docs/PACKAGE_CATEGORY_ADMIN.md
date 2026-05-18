# Package Categories — Admin Frontend Integration

Backend reference: `src/admin/master/packageCategory.controller.ts`, mounted at `/api/v1/admin/master/package-categories`.

Mirrors the existing **Subject Categories** master (`/api/v1/admin/master/subject-categories`) one-for-one. The link to Packages is **one-sided**, exactly like Course → SubjectCategory:

- **PackageCategory** is standalone master data (title, slug, image, order, status).
- **Package** stores the link via a new `packageCategoryId` field.
- Updates flow only from Package → PackageCategory. The category never stores a list of its packages.

---

## 1. Endpoints — Package Categories

Base URL: `/api/v1/admin/master/package-categories`. Auth: `Bearer <admin token>` (roles `admin` / `super_admin`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List all package categories (sorted by `order` asc) |
| POST | `/` | Create a package category |
| PUT | `/:id` | Update a package category |
| DELETE | `/:id` | Delete a package category |

### 1.1 List

```
GET /api/v1/admin/master/package-categories
```

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "67f3...",
      "title": "NEET",
      "slug": "neet",
      "image": "https://cdn.../neet.png",
      "order": 0,
      "status": true,
      "createdAt": "2026-05-16T10:00:00.000Z",
      "updatedAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

### 1.2 Create

```
POST /api/v1/admin/master/package-categories
Content-Type: multipart/form-data
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | ✔ | |
| `slug` | string | ✔ | Globally unique |
| `image` | file or URL | ✔ | Multipart file under field name `image`, or a string URL |
| `order` | number | – | Default `0` |
| `status` | boolean | – | Default `true`. Accepts `"true"`/`"false"` from form-data |

**201 Created** → `{ success: true, data: { ... } }`

### 1.3 Update

```
PUT /api/v1/admin/master/package-categories/:id
Content-Type: multipart/form-data
```

All fields optional (PATCH-style). Uploading a new `image` file replaces the URL.

### 1.4 Delete

```
DELETE /api/v1/admin/master/package-categories/:id
```

**200 OK** → `{ success: true, message: "Category deleted successfully" }`

---

## 2. Linking a Package to a Package Category

This is where the actual relation gets set — on the **Package** side, not on the category.

### 2.1 Field added to Package

`Package.packageCategoryId: ObjectId | null` (default `null`). One package belongs to at most one package category.

### 2.2 Create / Update Package

Existing endpoints (no path change):

```
POST /api/v1/admin/packages
PUT  /api/v1/admin/packages/:id
```

Just add `packageCategoryId` to the payload:

```json
{
  "name": "NEET 2026 Full Course",
  "description": "...",
  "packageCategoryId": "67f3..."
}
```

- Send `null` (or an empty string) to detach the package from any category.
- Send a valid PackageCategory `_id` to attach.
- Validation mirrors `examCountdownCategoryId`: invalid ObjectId → `400 { success: false, message: "Invalid packageCategoryId." }`.

### 2.3 Read Package

`GET /api/v1/admin/packages/:id` now populates `packageCategoryId` to `{ _id, title, slug, image }` (same shape Course uses for its `courseSubjectCategoryId` populate).

---

## 3. UI Wiring Cheat-sheet

1. **Package Categories listing page** — identical to Subject Categories. Columns: image, title, slug, order, status, actions.
2. **Package Category create/edit drawer** — identical to Subject Categories drawer **minus** the (unused) Parent dropdown. Fields: title, slug, image, order, status.
3. **Package create/edit form** — add a "Package Category" dropdown populated from `GET /api/v1/admin/master/package-categories`, bound to `packageCategoryId`. Allow "None" to send `null`.

---

## 4. Error Responses (Package Category endpoints)

| Status | When | Body |
|---|---|---|
| 400 | Invalid `:id` ObjectId | `{ success: false, message: "Invalid Package Category ID" }` |
| 400 | Zod validation failed | `{ success: false, errors: [ ...issues ] }` |
| 401 | Missing / invalid Bearer | standard auth error |
| 403 | Caller not admin/super_admin | standard role error |
| 404 | Row not found | `{ success: false, message: "Category not found" }` |
| 500 | Other (e.g. duplicate slug) | `{ success: false, message: "<reason>" }` |
