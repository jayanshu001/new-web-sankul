# Live Banners — Client API

Banner slider dedicated to **Live Courses**. Each item links to exactly one Live Course, populated in the response so the client can render the title/thumbnail without an extra call.

## Endpoint
`GET /api/v1/client/cms/live-banners`

**Auth:** Bearer token (required, like all client endpoints).

**Query params:** none. The list is returned in full, sorted by `orderBy` ascending.

---

## Response shape

```json
{
  "success": true,
  "data": [
    {
      "_id": "6724a1b0c5e2b40012ab34cd",
      "image": "https://cdn.example.com/live-banners/lawyer.jpg",
      "liveCourseId": {
        "_id": "68d3a1f0c5e2b40012ab34cd",
        "title": "Advanced Civil Law — Live",
        "thumbnail": "https://...",
        "...": "...other LiveCourse fields"
      },
      "orderBy": 1,
      "createdAt": "2026-05-18T10:00:00.000Z",
      "updatedAt": "2026-05-18T10:00:00.000Z"
    }
  ]
}
```

### Field reference

| Field          | Type                                  | Notes |
|----------------|---------------------------------------|-------|
| `_id`          | string (ObjectId)                     | Banner id. |
| `image`        | string (URL)                          | S3 image URL. |
| `liveCourseId` | populated LiveCourse object or `null` | Full live course document. `null` if the referenced live course was deleted. |
| `orderBy`      | number                                | Sort order, ascending. |
| `createdAt`    | string (ISO date)                     | |
| `updatedAt`    | string (ISO date)                     | |

---

## Client tap behavior
Always route to the live-course detail page using the populated id:

```ts
function onLiveBannerTap(banner) {
  if (!banner.liveCourseId) return; // referenced course deleted
  openLiveCourse(banner.liveCourseId._id);
}
```

There is no `key` field on this resource — every entry is implicitly a Live Course link, so no client-side routing switch is needed (unlike `/banners`).

---

## How this differs from `/banners`
- `/banners` returns mixed types (Packages / Courses / Book / EBook) — clients must branch on `key`.
- `/live-banners` is single-type and exposes `liveCourseId` directly. No `key` / `keyId` / `keyRef`.

## Example

**Request**
```
GET /api/v1/client/cms/live-banners
Authorization: Bearer <token>
```

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6724a1b0c5e2b40012ab34cd",
      "image": "https://cdn.example.com/live-banners/lawyer.jpg",
      "liveCourseId": {
        "_id": "68d3a1f0c5e2b40012ab34cd",
        "title": "Advanced Civil Law — Live"
      },
      "orderBy": 1,
      "createdAt": "2026-05-18T10:00:00.000Z",
      "updatedAt": "2026-05-18T10:00:00.000Z"
    }
  ]
}
```
