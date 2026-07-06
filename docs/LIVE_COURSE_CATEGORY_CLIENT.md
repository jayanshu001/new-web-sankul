# Live Course Categories — Client (App / Student Web)

Backend reference: `src/client/categories/categories.controller.ts` → `listLiveCourseCategories`, `listLiveCoursesByCategory`. Mounted under `/api/v1/client`.

Read-only. Only rows with `status: true` are returned. Auth: `Bearer <customer token>`.

---

## 1. Endpoints

### 1.1 List all live course categories

```
GET /api/v1/client/live-course-categories
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

Sorted by `order` asc.

### 1.2 Live courses under a category

```
GET /api/v1/client/live-course-categories/:id/live-courses
```

`:id` is the LiveCourseCategory `_id`. Returns active live courses whose `liveCourseCategoryId` matches.

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "664a...",
      "name": "JEE Advanced 2026 Live Batch",
      "image": "https://cdn.../lc.png",
      "ordered": 0,
      "isPaid": true,
      "isPopular": false,
      "classType": "live"
    }
  ]
}
```

Sorted by `ordered` asc.

---

## 2. Error Responses

| Status | When | Body |
|---|---|---|
| 400 | Invalid `:id` | `{ success: false, message: "Invalid live course category id" }` |
| 401 | Missing / invalid Bearer | standard auth error |
| 500 | Other | `{ success: false, message: "<reason>" }` |

---

## 3. Typical Usage

- **Browse / discovery screen**: call `/api/v1/client/live-course-categories` once, render tiles (image + title).
- **Tap a category tile** → call `/api/v1/client/live-course-categories/:id/live-courses` to render the live courses under it.
- For full live-course details, use the existing `/api/v1/client/live-courses/:id` endpoint (unchanged).
