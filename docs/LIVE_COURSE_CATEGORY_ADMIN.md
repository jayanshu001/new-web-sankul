# Live Course Categories — Admin Frontend Integration

Backend reference: `src/admin/master/liveCourseCategory.controller.ts`, mounted at `/api/v1/admin/master/live-course-categories`.

Mirrors **PackageCategory** / **SubjectCategory** masters one-for-one. The link to Live Courses is **one-sided**, exactly like Course → SubjectCategory or Package → PackageCategory:

- **LiveCourseCategory** is standalone master data (title, slug, image, order, status).
- **LiveCourse** stores the link via a new `liveCourseCategoryId` field.
- The category never stores a list of its live courses.

---

## 1. Endpoints — Live Course Categories

Base URL: `/api/v1/admin/master/live-course-categories`. Auth: `Bearer <admin token>` (roles `admin` / `super_admin`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List all live course categories (sorted by `order` asc) |
| POST | `/` | Create a live course category |
| PUT | `/:id` | Update a live course category |
| DELETE | `/:id` | Delete a live course category |

### 1.1 List

```
GET /api/v1/admin/master/live-course-categories
```

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "67f3...",
      "title": "JEE Live",
      "slug": "jee-live",
      "image": "https://cdn.../jee-live.png",
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
POST /api/v1/admin/master/live-course-categories
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
PUT /api/v1/admin/master/live-course-categories/:id
Content-Type: multipart/form-data
```

All fields optional (PATCH-style). Uploading a new `image` file replaces the URL.

### 1.4 Delete

```
DELETE /api/v1/admin/master/live-course-categories/:id
```

**200 OK** → `{ success: true, message: "Category deleted successfully" }`

---

## 2. Linking a Live Course to a Live Course Category

Set on the **Live Course** side. See [LIVE_COURSE_ADMIN_CATEGORY_WIRING.md](./LIVE_COURSE_ADMIN_CATEGORY_WIRING.md) for the form wiring.

`LiveCourse.liveCourseCategoryId: ObjectId | null` (default `null`). One live course belongs to at most one live course category.

`GET /api/v1/admin/live-courses` and `GET /api/v1/admin/live-courses/:id` populate it to `{ _id, title, slug, image }`.

---

## 3. UI Wiring Cheat-sheet

1. **Listing page** — identical to Package Categories / Subject Categories. Columns: image, title, slug, order, status, actions.
2. **Create/Edit drawer** — fields: title, slug, image, order, status. No parent dropdown.

---

## 4. Error Responses

| Status | When | Body |
|---|---|---|
| 400 | Invalid `:id` ObjectId | `{ success: false, message: "Invalid Live Course Category ID" }` |
| 400 | Zod validation failed | `{ success: false, errors: [ ...issues ] }` |
| 401 | Missing / invalid Bearer | standard auth error |
| 403 | Caller not admin/super_admin | standard role error |
| 404 | Row not found | `{ success: false, message: "Category not found" }` |
| 500 | Other (e.g. duplicate slug) | `{ success: false, message: "<reason>" }` |
