# Recently Added Live Courses API — Client (Frontend Guide)

A standalone, paginated feed of the **newest live courses** (created date desc).
Separate from the dashboard — call it wherever you render a "Recently Added Live
Courses" rail/screen.

## Endpoint

```
GET /api/v1/client/live-courses/recently-added
```

- Auth: **required** — `Authorization: Bearer <customerAccessToken>`.
- Response envelope: standard `{ success, code, data, message, messages }`.

### Query params

| param   | type | required | default | notes |
|---------|------|----------|---------|-------|
| `page`  | int  | no       | `1`     | 1-based page index. |
| `limit` | int  | no       | `10`    | Page size, max `50`. |

### Example

```
GET /api/v1/client/live-courses/recently-added?page=1&limit=10
Authorization: Bearer <token>
```

### Success — 200

```json
{
  "success": true,
  "code": 200,
  "data": {
    "liveCourses": [
      {
        "_id": "4",
        "name": "GPSC Non-Featured Batch",
        "subtitle": "GPSC Subtitle",
        "image": "https://cdn.websankul.com/live/gpsc.jpg",
        "level": "Beginner",
        "classType": "live",
        "status": true,
        "isPaid": true,
        "isPopular": false,
        "startTime": "2026-05-30T13:11:00.000Z",
        "courseEducatorId": "12",
        "packageCategoryId": "5",
        "isPurchased": false,
        "daysLeft": null,
        "plans": [
          {
            "_id": "41",
            "liveCourseId": "4",
            "name": "1 Year",
            "duration": 365,
            "price": 9800,
            "originalPrice": 12000,
            "discountPercent": 18,
            "isDefault": true,
            "status": true
          }
        ],
        "shareableLink": "https://.../live-courses/4"
      }
    ],
    "total": 4,
    "page": 1,
    "limit": 10
  },
  "message": "Recently added live courses fetched.",
  "messages": {}
}
```

## Card shape (`data.liveCourses[]`)

**Identical to the `GET /api/v1/client/live-courses` listing card** — reuse the same
card component. Key fields:

- `_id` — live course id; navigate to detail via `GET /api/v1/client/live-courses/:id`.
- `name`, `subtitle`, `image`, `level`, `classType`, `startTime` — display.
- `isPaid` — always `true` (all live courses are paid).
- `isPurchased` — `true` if the user has an active subscription to this course.
- `daysLeft` — remaining days for an owned course; `null` = not owned (or lifetime).
- `plans[]` — pricing plans (same shape as the listing). May be `[]` if none configured.
  Use `plans[0]` or the `isDefault` plan for the displayed price.
- `shareableLink` — canonical deep link for sharing.

> Unlike the main listing, this feed is **pure newest-first** (by created date) and
> omits the listing-only hero fields (`purchaseCount` / `cardVariant`).

## Pagination

- `total` is the full count of active live courses; `page`/`limit` echo the request.
- Use `page * limit < total` to decide whether to load more (infinite scroll / "Load more").

## Errors

| status | when |
|--------|------|
| 401 | missing/invalid bearer token |
| 500 | unexpected server error |

## Backend reference
- Route: `src/client/live-course/live-course.routes.ts` (`GET /recently-added`, declared before `/:id`)
- Controller: `src/client/live-course/live-course.controller.ts` → `listRecentlyAddedLiveCourses`
- Service: `src/modules/admin-live-course/admin-live-course.service.ts` → `listRecentLiveCourses`
