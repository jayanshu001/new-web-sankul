# API — Products by Exam Countdown

> **For app developers.** A single endpoint that returns **both packages and live
> courses** tied to one specific exam countdown, in one merged, paginated list.
> Each row is tagged with a `type` so you can split it into sections in the UI.

---

## Endpoint

```
GET /api/v1/client/exam-countdown/:id/packages
```

- **Auth:** Required. Send `Authorization: Bearer <token>`.
- **`:id`:** the **ExamCountdown** `_id` (a single exam event — e.g. "NEET 2026"),
  **not** a category id.

> ⚠️ Do not confuse with the older
> `GET /api/v1/client/exam-countdown-categories/:id/packages`. That one is keyed by
> an **ExamCountdownCategory** and returns **packages only**. The new endpoint below
> is keyed by an **ExamCountdown** and returns **packages + live courses**.

---

## Query parameters

| Param    | Type   | Default | Description                                  |
|----------|--------|---------|----------------------------------------------|
| `page`   | number | `1`     | Page number (1-based).                       |
| `limit`  | number | `20`    | Items per page (applies to the merged list). |
| `search` | string | —       | Case-insensitive match on the item `name`.   |

Pagination is applied **after** packages and live courses are merged and sorted by
`createdAt` (newest first). So a single page can contain a mix of both types.

---

## Response

`200 OK`

```json
{
  "success": true,
  "data": {
    "examCountdown": {
      "_id": "665...",
      "title": "NEET 2026",
      "categoryId": "664...",
      "examDate": "2026-05-03T00:00:00.000Z",
      "description": "",
      "status": true
    },
    "list": [
      {
        "_id": "661...",
        "name": "NEET Complete Package",
        "type": "package",
        "image": "https://...",
        "active": true,
        "isPaid": true,
        "packageTypeId": { "_id": "...", "name": "..." },
        "goalId": { "_id": "...", "title": "..." },
        "plans": {
          "withMaterial":    [ { "_id": "...", "duration": 30, "price": 999,  "withMaterial": true } ],
          "withoutMaterial": [ { "_id": "...", "duration": 30, "price": 699,  "withMaterial": false } ]
        },
        "subscriberCount": 1243,
        "isPurchased": false,
        "daysLeft": null
      },
      {
        "_id": "662...",
        "name": "NEET Live Crash Course",
        "type": "live-course",
        "image": "https://...",
        "classType": "live",
        "isPaid": true,
        "courseEducatorId": { "name": "...", "image": "..." },
        "packageCategoryId": { "title": "...", "slug": "...", "image": "..." },
        "plans": [
          { "_id": "...", "duration": 3, "price": 1499, "originalPrice": 1999, "discountPercent": 25 }
        ],
        "subscriberCount": 318,
        "isPurchased": false,
        "daysLeft": null
      }
    ]
  },
  "pagination": { "total": 27, "page": 1, "limit": 20, "totalPages": 2 }
}
```

### How to render

1. Read `data.list`.
2. Branch on each row's **`type`**:
   - `"package"` → render as a package card.
   - `"live-course"` → render as a live-course card.
3. If you want two separate sections in the UI, group the list client-side by `type`.

### Uniform flags on every row

Both types always carry these three flags, so the FE can treat them uniformly:

| Field         | package                                            | live-course                                        |
|---------------|----------------------------------------------------|----------------------------------------------------|
| `isPaid`      | `Package.isPaid` (admin flag)                      | `LiveCourse.isPaid` (admin flag)                   |
| `isPurchased` | active verified subscription (via plan→package)    | active verified subscription                       |
| `daysLeft`    | days left on the longest-lived active sub; `null` if not owned or lifetime | same; `null` if not owned or lifetime |

### Row fields by type

**`type: "package"`** — full `Package` document, plus:

| Field             | Notes                                                              |
|-------------------|--------------------------------------------------------------------|
| `plans`           | Object: `{ withMaterial: [...], withoutMaterial: [...] }`. Each plan's `duration` is **in DAYS**. |
| `subscriberCount` | Count of active subscriptions for this package.                    |
| `packageTypeId`   | Populated `{ _id, name }`.                                          |
| `goalId`          | Populated `{ _id, title }`.                                         |
| `isPaid` / `isPurchased` / `daysLeft` | See uniform-flags table above.                 |

**`type: "live-course"`** — full `LiveCourse` document, plus:

| Field             | Notes                                                                       |
|-------------------|-----------------------------------------------------------------------------|
| `plans`           | **Array** of plans. Each has `price`, `originalPrice` (null if no discount), `discountPercent`, and `duration` (**in MONTHS** for live courses). |
| `subscriberCount` | Count of verified-payment subscriptions.                                    |
| `isPaid` / `isPurchased` / `daysLeft` | See uniform-flags table above.                          |
| `courseEducatorId`| Populated `{ name, image }`.                                                |
| `packageCategoryId`| Populated `{ title, slug, image }`.                                        |

> **Note the plan-duration difference:** package plan `duration` is in **days**;
> live-course plan `duration` is in **months**. Format each accordingly.

---

## Error responses

| Status | Body                                                              | When                                  |
|--------|-------------------------------------------------------------------|---------------------------------------|
| `400`  | `{ "success": false, "message": "Invalid exam countdown id." }`   | `:id` is not a valid ObjectId.        |
| `401`  | (auth middleware)                                                 | Missing/invalid Bearer token.         |
| `404`  | `{ "success": false, "message": "Exam countdown not found." }`    | No ExamCountdown with that `_id`.     |
| `500`  | `{ "success": false, "message": "<error>" }`                      | Unexpected server error.              |

---

## How matching works (FYI)

A package or live course shows up here when its **`examCountdownIds`** array contains
this exam's `_id`. Admins assign exams to packages/live courses in the admin panel.
Only `active: true` packages and `status: true` live courses are returned.

## cURL

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://<host>/api/v1/client/exam-countdown/665abc.../packages?page=1&limit=20"
```
