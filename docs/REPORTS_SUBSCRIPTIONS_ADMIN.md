# Admin Reports — Subscriptions Contract (Course / Package / Live Course / Test Series)

Status: **spec locked 2026-07-07** — one shared filter + summary contract across four admin
subscription list endpoints. Rows mostly existed already; this adds a consistent filter set
+ a summary header to each.

## Endpoints

| Report | Method + path | Backing table | Product param |
|---|---|---|---|
| Course   | `GET /api/v1/admin/subscriptions?type=course`   | `ws_package_course_subscription` | `courseId` |
| Package  | `GET /api/v1/admin/subscriptions?type=package`  | `ws_package_course_subscription` | `packageId` |
| Live Course | `GET /api/v1/admin/live-courses/subscriptions` | `ws_live_course_subscription` | `liveCourseId` |
| Test Series | `GET /api/v1/admin/test-series/subscriptions` | `ws_test_series_subscription` (+ `ws_test_series_order` for method) | `testSeriesId` |

All require an admin / super_admin Bearer token (unchanged).

## Shared query params (all optional)

| Param | Meaning |
|---|---|
| `search` | customer name / phone / **email** (SQL id-resolver + `OR { in }`) |
| `dateFrom`, `dateTo` | range on `createdAt` (`gte` / `lte`) |
| `status` | `active` \| `expired` \| `inactive` (normalized, see below) |
| `paymentMethod` | `online` \| `backend` (normalized, see below) |
| `courseId`/`packageId`/`liveCourseId`/`testSeriesId` | product filter (per endpoint) |
| `customerId` | exact customer |
| `page`, `limit` | pagination (default 1 / 20, max 100) |
| `sortBy`, `sortOrder` | `createdAt`\|`startAt`\|`endAt`\|`amount`; `asc`\|`desc` (default `createdAt` desc) |

## Shared response

```jsonc
{
  "success": true,
  "summary": {           // over the WHOLE filtered set — respects filters, ignores pagination
    "totalCount": 0,
    "totalRevenue": 0,   // rupees, Number(Decimal), no paise
    "activeCount": 0,
    "expiredCount": 0
  },
  "data": [{
    "customer": { "_id": "", "name": "", "phone": "", "email": "" },
    "product":  { "_id": "", "type": "course|package|liveCourse|testSeries", "name": "", "image": "" },
    "plan":     { "_id": "", "name": "", "duration": 0, "price": 0 },
    "amount":   0,
    "paymentMethod": "online|backend",
    "status":   "active|expired|inactive",
    "startAt":  null,
    "endAt":    null,
    "createdAt": null
  }],
  "pagination": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 }
}
```

Envelope is **hand-rolled top-level** (`summary`/`data`/`pagination` are siblings) — this is
NOT the `utils/httpResponse.success()` shape (which nests under `data`). Matches the existing
`subscription.controller.ts` style.

## Normalization rules (the important bits)

### status (computed — NEW; today all four return a raw boolean)
- `active`   = `status = true AND (endAt IS NULL OR endAt > now)`
- `expired`  = `status = true AND endAt <= now`
- `inactive` = `status = false`

`summary.activeCount` / `expiredCount` use the same expressions over the filtered set.

### paymentMethod (normalized to `online` | `backend`)
The real gateway (razorpay/paytm/cash…) is not recoverable for course/package (collapsed at
write time), so all four expose a coarse 2-value field:
- Course/Package: `payment_type` (already `online`/`backend`).
- Live Course: `online` if `razorpay_order_id` present, else `backend` (admin grant).
- Test Series: joined order's `payment_method` → `online` when an order exists, else `backend`
  (admin backend-grant subs have no order).

### amount / totalRevenue (source column per endpoint)
| Endpoint | Row `amount` & `SUM` |
|---|---|
| Course/Package | `amount` |
| Live Course | `paid_amount` |
| Test Series | `price` (subscription; universal, incl. admin grants) |

All amounts are plain rupees via `Number(decimal)` — no paise conversion.

## Per-endpoint gaps closed
- **Course/Package** — already had type/customerId/course/package/status/date/search/sort;
  ADD: `paymentMethod` filter + normalized `status` + inline `summary` + unified `product` object
  (today course uses `courseId`, package uses `targetPackageId`).
- **Live Course** — ADD: `search`, `dateFrom/dateTo`, `paymentMethod`, normalized `status`, `summary`.
  (Amount already native.)
- **Test Series** — ADD: `search`, `dateFrom/dateTo`, `paymentMethod` (via order join), `amount`
  already present as `price`, normalized `status`, `summary`.

## Reused building blocks
- Pagination: `parseListQuery` + `buildPagination` (`src/utils/listQuery.ts`).
- Search over SQL: id-resolver + `OR { …Id: { in: [...] } }` (pattern from
  `admin-subscription.repository.ts`); extend customer resolver to also match email.
- Date range + status normalization: new shared helper `src/utils/reportFilters.ts`
  (lifts the inline `dateWhere` from `admin-subscription.service.ts` and adds the status expr).
- Summary: Prisma `count` / `aggregate _sum` / dual-count for active/expired (template from
  `admin-subscription` reports).

## Left untouched
The existing `GET /admin/subscriptions/reports/{summary,by-course,by-ebook,book-orders}`
endpoints are NOT modified — the new per-list `summary` block is additive.
