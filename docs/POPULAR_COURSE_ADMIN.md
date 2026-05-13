# Popular Course — Admin API

Adds an `isPopular` flag on a course so admins can curate a "Popular" rail surfaced to clients.

**Auth:** Bearer token, role `admin` or `super_admin`.
**Base path:** `/api/v1/admin/courses`

## Field
- `isPopular` (boolean, default `false`) — when `true`, the course is exposed under the client's popular-courses endpoint.

## 1. Toggle popular flag
`PATCH /api/v1/admin/courses/:id/popular`

Toggles `isPopular`, or sets it explicitly when supplied.

**Body (optional):**
```json
{ "isPopular": true }
```
If body is omitted (or `isPopular` not provided), the current value is flipped.

**Response 200:**
```json
{
  "success": true,
  "message": "Course marked as popular",
  "data": { "_id": "<courseId>", "isPopular": true }
}
```

**Errors:** `400` invalid id, `404` course not found.

## 2. Set on create / update
`POST /api/v1/admin/courses` and `PUT /api/v1/admin/courses/:id` accept `isPopular` (boolean) alongside existing fields. Multipart form values `"true"` / `"false"` are coerced.

## 3. Filter the list
`GET /api/v1/admin/courses?isPopular=true|false`

Combines with existing `search`, `status`, `isPaid`, `page`, `limit`, `sortBy`, `sortOrder` filters.
