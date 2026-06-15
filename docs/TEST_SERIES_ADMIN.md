# Test Series — Admin API

Base URL: `/api/v1/admin/test-series`
Auth: Bearer admin token (`admin` or `super_admin`). Required on every route.

## Data model (one paragraph)

A **Test Series** (e.g. "Online Mock test 2025") bundles many existing `Exam` papers,
grouped by series-scoped **Content Categories** (e.g. "GPSC Mains Lecture PDF").
Each series has one or more **Price Plans** (`durationDays` + `price` + optional
`originalPrice` MRP for the strike-through discount badge). Customers buy a plan,
which provisions a **TestSeriesSubscription** that grants access until `endAt`.

Collections introduced:

| Collection                              | Purpose                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `ws_test_series`                        | The product / series                                          |
| `ws_test_series_content_category`       | Flat per-series grouping of papers                            |
| `ws_test_series_exam`                   | Series ↔ Exam link (unique on (testSeriesId, examId))         |
| `ws_test_series_prices`                 | Price plans                                                   |
| `ws_test_series_orders`                 | Razorpay order shell (PENDING → COMPLETE on /verify)          |
| `ws_test_series_subscriptions`          | Granted access window                                         |

Existing `Exam` / `ExamQuestion` / `ExamResult` are reused unchanged — the paper
itself, its questions, and its attempt history continue to live in the existing
exam stack. A "paper" in the UI is just an `Exam` linked into a series.

## Response shape

All admin endpoints use the project's `success` / `failure` envelope:

```json
{ "success": true, "code": 200, "data": { ... }, "message": "Fetched.", "messages": {} }
```

Validation errors return HTTP 422 with `data.errors` (zod messages).

---

## 1. Test Series CRUD

### List
`GET /api/v1/admin/test-series?search=&status=&examCategoryIds=&page=1&limit=20`

`data` → `{ data: TestSeries[], total, page, limit }`

Each row carries a **`defaultPlan`** preview so the list doesn't need a per-series
`/prices` call — the default plan, or the cheapest active plan when none is marked
default, or `null` if the series has no active plan:

```json
"defaultPlan": {
  "_id": "...", "name": null, "durationDays": 30,
  "price": 49, "originalPrice": null, "isDefault": false, "status": true
}
```

**Category filter:** pass `examCategoryIds` one or more times
(`?examCategoryIds=<id>&examCategoryIds=<id>`); a series matches if it belongs to
**any** of them. The legacy single param `?examCategoryId=<id>` is still accepted.
Both match migrated (`examCategoryIds`) and not-yet-migrated (`examCategoryId`) docs.

### Detail
`GET /api/v1/admin/test-series/:id`

`data` → `{ series, contentCategories[], prices[], papers[] }`
`papers[].examId` is populated with title/duration/etc.
`series.examCategoryIds` is an **array** of ExamCategory ObjectId strings (not
populated by default). The deprecated `series.examCategoryId` is still returned
during the migration window — prefer `examCategoryIds`.

### Create
`POST /api/v1/admin/test-series` — `multipart/form-data`, field `thumbnail` (image, optional).

Body fields (all optional unless noted):

| field          | type    | notes                                                  |
| -------------- | ------- | ------------------------------------------------------ |
| title           | string    | **required**, max 255                                 |
| description     | string    |                                                       |
| thumbnail       | string    | image url; send `""` to remove (see note). A file upload sets it. |
| examCategoryIds | objectId[]| optional links to global ExamCategory (see note below)|
| examCategoryId  | objectId  | **deprecated** — legacy single link; still accepted   |
| language        | enum      | `en` / `gu` / `hi` / `bilingual` (default `gu`)       |
| isFree         | boolean | when true, all customers get access without payment    |
| instructions   | string  |                                                        |
| policy         | string  |                                                        |
| orderBy        | int     | sort order                                             |
| status         | boolean | default `true`                                         |

### Update
`PUT /api/v1/admin/test-series/:id` — same shape as create, all fields optional.
Thumbnail re-upload supported via `multipart`.

> **Remove thumbnail:** send `thumbnail: ""` (empty string) to clear/unset the stored
> thumbnail. A **missing** `thumbnail` field = "no change"; an **empty string** = "remove".
> Uploading a new file replaces it as before.
>
> **Paid requires a plan:** if `isFree` resolves to `false` for the series (the value you
> send, or the stored value if you don't send it), the update is **rejected with 422**
> unless the series already has ≥1 active price plan. Add a plan via the `/prices`
> endpoints first, or set `isFree: true`. (Not enforced on create, since plans are added
> after the series exists.)

> **Sending `examCategoryIds`:**
> - **JSON body** (no thumbnail change): send a real JSON array —
>   `{ "examCategoryIds": ["<id1>", "<id2>"] }`.
> - **`multipart/form-data`** (thumbnail uploaded): repeat the field — either
>   `examCategoryIds=<id1>` + `examCategoryIds=<id2>`, or the bracketed
>   `examCategoryIds[]=<id1>` + `examCategoryIds[]=<id2>`. The server normalizes
>   both, and also accepts a single value or a JSON-encoded string.
> - Omit the field to leave it unchanged on update; send `[]` to clear it.
> - Each entry must be a valid ExamCategory ObjectId (24-hex). The field is
>   optional — omitting it on create stores `[]`.
>
> During the migration window the server keeps the deprecated single
> `examCategoryId` in sync (set to the first array entry) so old readers stay
> correct.

### Delete
`DELETE /api/v1/admin/test-series/:id`

Refuses with **409** if any active subscription points at the series. Toggle
`status: false` instead to retire a series.

---

## 2. Content Categories (per series)

### List
`GET /api/v1/admin/test-series/:id/content-categories`

### Create
`POST /api/v1/admin/test-series/:id/content-categories` — `multipart/form-data`, optional `icon`.

| field    | type    | notes                |
| -------- | ------- | -------------------- |
| name     | string  | **required**, max 255 |
| icon     | string  | image url            |
| orderBy  | int     |                      |
| status   | boolean | default true         |

### Update
`PUT /api/v1/admin/test-series/content-categories/:categoryId` — same fields, all optional.

### Delete
`DELETE /api/v1/admin/test-series/content-categories/:categoryId`

Refuses with **409** if any paper is still linked to this category.

---

## 3. Papers (Exam links)

### List
`GET /api/v1/admin/test-series/:id/papers`

Returns `data[].examId` (populated) and `data[].contentCategoryId` (populated with `name`).

### Link a paper to the series
`POST /api/v1/admin/test-series/:id/papers`

```json
{ "contentCategoryId": "...", "examId": "...", "orderBy": 0, "status": true }
```

Validates that the content category belongs to the same series and that the exam
exists. Returns **409** on duplicate link. Recomputes `series.paperCount`.

### Update a link
`PUT /api/v1/admin/test-series/papers/:linkId`

Can move a paper to a different content category (same series only) or change
order / status.

### Unlink
`DELETE /api/v1/admin/test-series/papers/:linkId` — recomputes `series.paperCount`.

---

## 4. Price Plans

### List
`GET /api/v1/admin/test-series/:id/prices`

### Create
`POST /api/v1/admin/test-series/:id/prices`

| field          | type    | notes                                                         |
| -------------- | ------- | ------------------------------------------------------------- |
| name           | string  | optional display label                                        |
| durationDays   | int     | **required**, > 0 — validity in DAYS (mockup: "10 days")      |
| price          | number  | **required**, ≥ 0                                             |
| originalPrice  | number  | optional MRP shown struck-through                             |
| isDefault      | boolean | only one default per series (others auto-unset)               |
| status         | boolean |                                                               |

### Update / Delete
`PUT /api/v1/admin/test-series/prices/:priceId`
`DELETE /api/v1/admin/test-series/prices/:priceId`

Delete refuses with **409** if any active subscription references the plan.

---

## 5. Subscriptions / Orders

### List active subscriptions
`GET /api/v1/admin/test-series/subscriptions?testSeriesId=&customerId=&status=&page=&limit=`

Returns rows populated with `testSeriesId.title` and `customerId.{name,phone,email}`.

### Grant a free subscription (admin)
`POST /api/v1/admin/test-series/:id/grant`

```json
{
  "customerId": "...",
  "planId": "...",          // optional — derives durationDays/price
  "durationDays": 30,       // required if planId not given
  "price": 0,               // optional override
  "startAt": "2026-05-15",  // optional, defaults to now
  "remarks": "Free for staff"
}
```

`paymentType` is recorded as `Backend`. `endAt = startAt + durationDays`.

### Edit subscription
`PUT /api/v1/admin/test-series/subscriptions/:subscriptionId`

Can change `endAt`, `status`, `remarks`. Use this to extend, revoke, or annotate.

### Delete subscription
`DELETE /api/v1/admin/test-series/subscriptions/:subscriptionId`

### List orders (audit / refunds)
`GET /api/v1/admin/test-series/orders?testSeriesId=&customerId=&status=&page=&limit=`

Returns the order rows with `basePrice / discountAmount / gstAmount / handlingFee /
orderPrice / razorpay*Id`. Shape is the same as the customer's checkout breakdown.

---

## Quick implementation checklist (front-end)

1. **Test Series list page** — call `GET /test-series`, show title, thumbnail,
   paperCount, price + originalPrice from `defaultPlan`.
2. **Detail page** — `GET /test-series/:id`. Render `contentCategories` (left tab list)
   and `prices` (plan picker). Use `papers` for the "Test Content" tab.
3. **Subject / plan picker** — list `prices`. On select, call **client** preview
   endpoint for the order summary; on Pay Now, call **client** create-order, then
   `/payment/verify` after Razorpay completes.
4. **Admin grant** — call `POST /:id/grant` with `customerId` + either `planId` or
   explicit `durationDays`.

Versioning notes:
- `language` enum values: `en`, `gu`, `hi`, `bilingual`.
- `durationDays` is **DAYS**, not months. (Course/ebook use months — DO NOT
  cross-wire.)
