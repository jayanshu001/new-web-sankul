# API — Books & Ebooks by Exam Countdown

> **For app developers.** Returns **books and ebooks** linked to one specific exam
> countdown, in a single merged, paginated list. Each row is tagged with a `type`
> so you can split it into sections in the UI.

---

## Endpoint

```
GET /api/v1/client/exam-countdown/:id/books-ebooks
```

- **Auth:** Required. Send `Authorization: Bearer <token>`.
- **`:id`:** the **ExamCountdown** `_id` (a single exam event — e.g. "NEET 2026"),
  **not** a category id.

> ⚠️ Sibling endpoint: `GET /api/v1/client/exam-countdown/:id/packages` (packages +
> live courses for the same exam). And do not confuse with the older
> `GET /api/v1/client/exam-countdown-categories/:id/books-ebooks`, which is keyed by
> an **ExamCountdownCategory** instead of an ExamCountdown.

---

## Query parameters

| Param    | Type   | Default | Description                                  |
|----------|--------|---------|----------------------------------------------|
| `page`   | number | `1`     | Page number (1-based).                       |
| `limit`  | number | `20`    | Items per page (applies to the merged list). |
| `search` | string | —       | Case-insensitive match on the item `name`.   |

Pagination is applied **after** books and ebooks are merged and sorted by
`createdAt` (newest first), so one page can contain a mix of both types.

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
        "_id": "671...",
        "name": "NEET Physics Handbook",
        "type": "book",
        "author": "...",
        "image": "https://...",
        "thumbnail": "https://...",
        "listPrice": 499,
        "discountedPrice": 399,
        "shippingPrice": 0,
        "language": "English",
        "status": true,
        "isPaid": true,
        "isPurchased": false,
        "daysLeft": null
      },
      {
        "_id": "672...",
        "name": "NEET Biology eBook",
        "type": "ebook",
        "author": "...",
        "publisher": "...",
        "image": "https://...",
        "plans": [
          { "_id": "...", "duration": 90, "price": 199, "status": true }
        ],
        "isPaid": true,
        "isPurchased": false,
        "subscriptionEndAt": null,
        "daysLeft": null
      }
    ]
  },
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### How to render

1. Read `data.list`.
2. Branch on each row's **`type`**:
   - `"book"` → render a physical-book card (price comes inline on the row:
     `listPrice` / `discountedPrice` / `shippingPrice`).
   - `"ebook"` → render an ebook card using the `plans` array + the entitlement
     fields below.
3. To show two separate sections, group the list client-side by `type`.

### Uniform flags on every row

Both types always carry these three flags, so the FE can treat them uniformly:

| Field         | book                                              | ebook                                             |
|---------------|---------------------------------------------------|---------------------------------------------------|
| `isPaid`      | always `true` (physical books, no free concept)   | admin flag (price-derived fallback)               |
| `isPurchased` | fulfilled `BookOrder` (verified/shipped/delivered)| active subscription (`endAt > now`)               |
| `daysLeft`    | always `null` (one-time purchase, no expiry)      | days left on active subscription, else `null`     |

### Row fields by type

**`type: "book"`** — full `Book` document. Pricing is **inline** on the row
(`listPrice`, `discountedPrice`, `shippingPrice`). No `plans` array. Plus the
uniform flags above (`isPaid` always `true`, `daysLeft` always `null`,
`isPurchased` reflects whether the user has bought it).

**`type: "ebook"`** — full `Ebook` document, plus joined entitlement info:

| Field               | Notes                                                                  |
|---------------------|------------------------------------------------------------------------|
| `plans`             | Array of active `EbookPrice` plans (sorted by `duration`). Empty if none. Each plan's `duration` is **in DAYS**. |
| `isPaid`            | Admin-controlled flag (source of truth). Falls back to "any plan price > 0" only if the flag is absent. |
| `isPurchased`       | `true` if the current user has an active subscription (`endAt > now`). |
| `subscriptionEndAt` | The active subscription's end date, or `null`.                         |
| `daysLeft`          | Days remaining on the active subscription, or `null` if not purchased. |

This is the same ebook shape as `GET /client/ebooks`, so you can reuse the same card.

---

## Error responses

| Status | Body                                                              | When                              |
|--------|-------------------------------------------------------------------|-----------------------------------|
| `400`  | `{ "success": false, "message": "Invalid exam countdown id." }`   | `:id` is not a valid ObjectId.    |
| `401`  | (auth middleware)                                                 | Missing/invalid Bearer token.     |
| `404`  | `{ "success": false, "message": "Exam countdown not found." }`    | No ExamCountdown with that `_id`. |
| `500`  | `{ "success": false, "message": "<error>" }`                      | Unexpected server error.          |

---

## How matching works (FYI)

A book or ebook shows up here when its **`examCountdownIds`** array contains this
exam's `_id`. Admins assign exams to books/ebooks in the admin panel (`/admin/books`,
`/admin/ebooks`). Only `status: true` items are returned.

## cURL

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://<host>/api/v1/client/exam-countdown/665abc.../books-ebooks?page=1&limit=20"
```
