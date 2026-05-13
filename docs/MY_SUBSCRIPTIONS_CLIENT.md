# My Subscriptions — Client API

Drives the **My Subscriptions** library screen — the user's *currently-active* course/package subscriptions, with a per-card **View Course** action and a **Days Left** indicator.

This is a distinct endpoint from Purchase History → Subscriptions tab. They share the same underlying data (`PackageCourseSubscription`) but differ on filter, sort, and per-card payload:

| | Purchase History (Subs tab) | My Subscriptions |
|---|---|---|
| **Purpose** | Records of every verified course purchase | The user's active library |
| **Filter** | `paymentStatus = "verified"` (all time) | `paymentStatus = "verified"` AND `endAt > now` |
| **Sort** | `createdAt desc` (newest first) | `endAt asc` (expiring soonest first) |
| **Card focus** | `amount`, `purchasedAt`, receipt | `daysLeft`, banner, **View Course** action |

---

## Endpoint

`GET /api/v1/client/my-subscriptions`

**Auth:** `Authorization: Bearer <token>` required.

### Query

- `page` (default `1`, min `1`)
- `limit` (default `20`, min `1`, max `100`)

### Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f...",
      "title": "PSI Constable 2.0 Live Batch",
      "author": "WebSankul",
      "thumbnail": "https://.../banner.jpg",
      "badge": "Live Class",
      "daysLeft": 9,
      "startAt": "2026-03-01T08:00:00.000Z",
      "endAt": "2026-05-20T08:00:00.000Z",
      "action": {
        "kind": "course",
        "courseId": "65f...",
        "packageId": null,
        "planId": "65f..."
      },
      "meta": {
        "duration": 90,
        "packageName": "Live Batch"
      }
    }
  ],
  "pagination": {
    "total": 3,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### Errors

| Status | Cause |
|---|---|
| 401 | `Unauthorized.` |
| 500 | Server error |

---

## Field Notes

- **`title`** — falls back to package name if the course name is missing. Practically always the course name.
- **`thumbnail`** — `Course.thumbnail || Course.image`. May be `null` if neither is set.
- **`badge`** — `PackageType.name`. Exact strings depend on admin config (e.g. `Live Class`, `Recorded Class`, `Subject Course`).
- **`daysLeft`** — integer days until `endAt`, ceiling-rounded. A subscription ending in 23h59m reads `1` (matches the "9 Days Left" copy in the mockup). Never negative — expired subscriptions are filtered out before this point, so a `0` here means "expires today". Falls naturally below 30 when less than a month remains on a multi-month plan.
- **`action.kind`** — `"course"` or `"package"`. Tells the frontend which screen to open.
- **`action.courseId` / `action.packageId`** — exactly one is set, matching `action.kind`. The frontend builds its in-app route (course player vs package landing) from the populated id. `action.planId` is the underlying `PackageCourseEbookPrice._id` if you need it.
- **`meta.duration`** — original plan duration in **months** (from `EbookPrice`/`PackageCourseEbookPrice.duration`). Useful if the UI wants to render a progress bar — convert to days first (`monthsToDays`) or compare against `startAt`/`endAt` directly.

---

## Frontend Integration Notes

1. **Cards render directly from the row** — no extra lookups needed.
2. **"View Course" tap** → navigate to your course-player route using `action.courseId` (and optionally `action.packageId` if the player needs to know the plan).
3. **Empty state** — `data: []`, `pagination.total = 0`. Show a CTA back to the course catalog.
4. **Sort is server-side** (expiring-soonest first). Don't re-sort client-side.
5. **Pagination is independent** of the Purchase History screen — fresh state per screen.
6. **Dates** are ISO 8601 UTC; display in user locale.
