# Popular Course — Client API

Surfaces courses that admins have flagged as popular. No new endpoint — the existing course listings accept an `isPopular` query param.

**Auth:** Bearer token, role `customer`.
**Base path:** `/api/v1/client/courses`

## Filter the main list
`GET /api/v1/client/courses?isPopular=true` (or `false`)

Returns active courses where `isPopular` matches, with their pricing plans pre-bucketed by `withMaterial` / `withoutMaterial`.

**Query params:** `isPopular`, `search`, `page` (default `1`), `limit` (default `10`), `sortBy` (default `createdAt`), `sortOrder` (`asc` | `desc`, default `desc`).

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "name": "...",
      "description": "...",
      "image": "...",
      "isPopular": true,
      "status": true,
      "isPaid": true,
      "courseEducatorId": { "_id": "...", "name": "..." },
      "courseSubjectCategoryId": { "_id": "...", "title": "..." },
      "videoCategoryId": { "_id": "...", "title": "..." },
      "pcMaterialId": { "_id": "...", "title": "..." },
      "plans": {
        "withMaterial": [ /* PackageCourseEbookPrice */ ],
        "withoutMaterial": [ /* PackageCourseEbookPrice */ ]
      }
    }
  ],
  "pagination": { "total": 0, "page": 1, "limit": 10, "totalPages": 0 }
}
```

## Inside category listings
`GET /api/v1/client/courses/categories/:categoryId/courses?isPopular=true` — narrows a category's courses to popular ones.

## Notes
- `isPopular` is included on every course object, so existing screens can render a "Popular" badge without an extra call.
- Only courses with `status: true` are returned by client endpoints; toggling `isPopular` on an inactive course will not surface it.
