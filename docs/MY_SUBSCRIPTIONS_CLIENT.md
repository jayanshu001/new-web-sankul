# My Subscriptions — Client API

Drives the **My Subscriptions** library screen — the user's *currently-active*
subscriptions for a requested `type`, with a per-card action target and a
**Days Left** indicator. Sorted expiring-soonest first. Every `type` returns the
**same card shape**, so the FE renders one list and switches only on
`action.kind`.

This is a distinct endpoint from Purchase History → Subscriptions tab. They
share underlying data but differ on filter, sort, and per-card payload:

| | Purchase History (Subs tab) | My Subscriptions |
|---|---|---|
| **Purpose** | Records of every verified purchase | The user's active library |
| **Filter** | verified (all time) | active: verified AND `endAt > now` |
| **Sort** | `createdAt desc` (newest first) | `endAt asc` (expiring soonest first) |
| **Card focus** | `amount`, `purchasedAt`, receipt | `daysLeft`, action target |

---

## Endpoint

`GET /api/v1/client/my-subscriptions`

**Auth:** `Authorization: Bearer <token>` required.

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `type` | `course` \| `test_series` \| `ebook` | `course` | Which library to return. |
| `page` | int ≥ 1 | `1` | |
| `limit` | int 1–100 | `20` | |

### What each `type` returns

| `type` | Returns | `action.kind` values |
|---|---|---|
| `course` | **Course AND Package** subscriptions together | `course`, `package` |
| `test_series` | Test-series subscriptions | `test_series` |
| `ebook` | eBook subscriptions | `ebook` |

> `type` defaults to `course`, so an existing call with **no** `type` behaves
> exactly as before (course + package combined). The `course` tab is the
> intentional combined course-and-package view — each card says which it is via
> `action.kind`.

**Active** means `status: true` and `endAt` in the future. Course/package
additionally require `paymentStatus: "verified"` (test-series and ebook rows
have no payment-status column — the row existing means access was granted).
Duplicate active rows for the same target (legacy data or a validity-extend that
landed as a new row) are collapsed to the one with the furthest-out `endAt`.

---

## Request

```http
GET /api/v1/client/my-subscriptions?type=course&page=1&limit=20
Authorization: Bearer <token>
```

## Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "_id": "6a1acf94dde3e6309cbc646b",
      "title": "PSI Constable 2.0 Live Batch",
      "author": "WebSankul",
      "thumbnail": "https://.../banner.jpg",
      "badge": "Live Class",
      "daysLeft": 9,
      "startAt": "2026-03-01T08:00:00.000Z",
      "endAt": "2026-05-20T08:00:00.000Z",
      "action": {
        "kind": "package",
        "courseId": null,
        "packageId": "6a180ffc9a0b2e62786a2f0c",
        "planId": "6a1acf80dde3e6309cbc6410",
        "testSeriesId": null,
        "ebookId": null
      },
      "meta": { "duration": 90, "packageName": "Live Batch" }
    }
  ],
  "pagination": { "total": 17, "page": 1, "limit": 20, "totalPages": 1 }
}
```

---

## Card fields (identical across all types)

| Field | Type | Notes |
|---|---|---|
| `_id` | string | The **subscription row** id (not the product id). |
| `title` | string | Course/package/ebook name, or test-series title. |
| `author` | string \| null | Course or ebook author; null for package/test-series. |
| `thumbnail` | string \| null | Best available product image; may be null. |
| `badge` | string \| null | Course/package: `PackageType.name` (e.g. "Live Class", "Recorded Class"). Test-series: `"Test Series"`. eBook: `"eBook"`. |
| `daysLeft` | int \| null | Whole days until `endAt`, ceiling-rounded (23h59m → 1). Never negative (expired rows are filtered out); `0` means "expires today". |
| `startAt` / `endAt` | date \| null | Subscription window, ISO 8601 UTC. |
| `action` | object | Deep-link target. See below. |
| `meta` | object | Type-specific extras. `{}` for test-series/ebook. Course/package: `{ duration, packageName }`. |

### `action` — building the deep link

`action.kind` tells the FE which screen to open. The relevant ids are populated
per kind; the rest are `null`. **All five keys are present in every card** so
the shape is stable:

| `kind` | Populated ids | FE opens |
|---|---|---|
| `course` | `courseId`, `planId` | Course player |
| `package` | `packageId`, `planId` | Package landing |
| `test_series` | `testSeriesId`, `planId` | Test-series screen |
| `ebook` | `ebookId` | eBook reader/detail |

> The API returns ids, **not** URLs — the route lives in the app.

> `meta.duration` is the plan's stored `duration` value (see the plan model for
> its unit on each product); use `startAt`/`endAt` for an exact remaining-time
> bar rather than deriving from `duration`.

---

## Errors

| Status | Body | Cause |
|---|---|---|
| 400 | `{ success:false, message, errors:[...] }` | Invalid `type` (not one of the three) or bad `page`/`limit`. |
| 401 | `{ success:false, message:"Unauthorized." }` | Missing/expired token. |
| 500 | `{ success:false, message }` | Server error. |

Empty library returns `200` with `data: []` and `totalPages: 0` — not an error.

---

## Frontend integration notes

1. **One list component** — branch only on `action.kind`; the envelope is
   identical across types. Use `badge` for any type-specific chip styling.
2. **Three tabs** → call with `type=course`, `type=test_series`, `type=ebook`.
   Paginate each independently; `total`/`totalPages` are per-`type` (post-dedup).
3. **Tap action** → navigate using the populated id(s) for that `kind`.
4. **Sort is server-side** (expiring-soonest first). Don't re-sort client-side.
5. **Empty state** — `data: []`, `total: 0`. Show a catalog CTA.
6. **Dates** are ISO 8601 UTC; display in user locale.

---

## Backend reference

- Controller: `src/client/my-subscriptions/my-subscriptions.controller.ts`
  (`buildCourseAndPackageCards` / `buildTestSeriesCards` / `buildEbookCards`).
- Sources: `ws_package_course_subscriptions`, `ws_test_series_subscriptions`,
  `ws_ebook_subscriptions`.
