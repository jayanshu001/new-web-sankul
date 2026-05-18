# Admin Dashboard API

Single endpoint that powers every widget on the admin dashboard landing page:

- Order Reports cards (Package / Course / Ebook / Book) with delta vs. previous period
- Total Order Reports (combined orders + earnings, with hourly/daily series for the chart)
- New Customers list
- Recent Package / Course Subscriptions
- Recent Book Orders
- Recent Ebook Subscriptions
- Catalog / team / enquiry counters

One round trip on first paint. Tab clicks on the two range pickers send a targeted refetch with the changed param.

---

## Endpoint

```
GET /api/v1/admin/dashboard
```

Auth: Bearer token. Roles: `admin`, `super_admin`.

### Query params

| Param         | Type   | Default   | Notes                                                                                 |
| ------------- | ------ | --------- | ------------------------------------------------------------------------------------- |
| `orderRange`  | enum   | `today`   | Range for the **Order Reports** cards. One of `today \| yesterday \| week \| month \| prevMonth \| year`. |
| `totalRange`  | enum   | `today`   | Range for the **Total Order Reports** widget and the chart series.                    |
| `fromDate`    | ISO    | —         | Optional raw override for Order Reports window. If set with `toDate`, takes precedence over `orderRange`. |
| `toDate`      | ISO    | —         | See above.                                                                            |
| `recentLimit` | int    | `7`       | Items per recent list (newCustomers, recent subs, etc.). Clamped to 25.               |

### Range semantics

- `today` — 00:00:00 → now (local)
- `yesterday` — full previous day
- `week` — Sunday of current week → now
- `month` — 1st of current month → now
- `prevMonth` — full previous month
- `year` — Jan 1 of current year → now

For each `orderRange`, the controller also computes a previous-period window of equal span to produce `deltaPct`.

### Chart bucket unit

Auto-selected from window span:

- Span ≤ 26 h → `unit: "hour"`, 24 fixed slots `00..23`
- Otherwise → `unit: "day"`, slots = days present in the window

Timezone: `Asia/Kolkata`.

---

## Response

```jsonc
{
  "success": true,
  "data": {
    "orderReports": {
      "range": "today",
      "windowStart": "2026-05-18T00:00:00.000Z",
      "windowEnd":   "2026-05-18T23:59:59.999Z",
      "package": { "amount": 7800, "deltaPct":  12 },
      "course":  { "amount":    0, "deltaPct":   0 },
      "ebook":   { "amount":    0, "deltaPct":   0 },
      "book":    { "amount":  905, "deltaPct":  -8 }
    },
    "totalOrderReports": {
      "range": "today",
      "windowStart": "2026-05-18T00:00:00.000Z",
      "windowEnd":   "2026-05-18T23:59:59.999Z",
      "unit": "hour",
      "totalOrders":   5,
      "totalEarnings": 8705,
      "series": [
        { "bucket": "00", "orders": 0, "earnings": 0 },
        { "bucket": "01", "orders": 0, "earnings": 0 },
        // ... 24 entries when unit=hour
        { "bucket": "23", "orders": 0, "earnings": 0 }
      ]
    },
    "newCustomers": [
      {
        "_id": "...",
        "firstName": "Websankul",
        "lastName": null,
        "phoneNumber": "9904451371",
        "profileImage": "https://.../avatar.png",
        "createdAt": "2025-10-16T16:39:22.000Z"
      }
    ],
    "recentPackageSubscriptions": [
      {
        "_id": "...",
        "paidAmount": 7800,
        "status": true,
        "createdAt": "...",
        "customerId": { "_id": "...", "firstName": "David", "lastName": "Horn", "phoneNumber": "..." },
        "targetPackageId": { "_id": "...", "name": "CCE", "image": "..." },
        "packageId": "..."
      }
    ],
    "recentCourseSubscriptions": [ /* same shape, populated courseId + customerId */ ],
    "recentBookOrders": [
      {
        "_id": "...",
        "receiptId": "order_RpSEcUZhhrcW3E",
        "amount": 130,
        "status": "verified",
        "createdAt": "...",
        "items": [
          {
            "bookId": { "_id": "...", "name": "Science and Technology", "image": "..." },
            "qty": 1,
            "price": 130
          }
        ]
      }
    ],
    "recentEbookSubscriptions": [
      {
        "_id": "...",
        "status": true,
        "createdAt": "...",
        "ebookId": { "_id": "...", "name": "test", "image": "..." }
      }
    ],
    "summary": {
      "customers": { "total": 472365, "active": 460000 },
      "catalog":   { "courses": 42, "packages": 18, "ebooks": 27, "books": 91 },
      "team":      { "promoters": 12, "educators": 34 },
      "enquiries": { "offline": 5, "website": 9 }
    }
  }
}
```

---

## Data sources (collection → widget map)

| Widget                           | Collection / model                                | Filter                                                  |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Package Orders revenue           | `PackageCourseSubscription`                       | `courseId: null`, `createdAt ∈ orderWindow`             |
| Course Orders revenue            | `PackageCourseSubscription`                       | `courseId: { $ne: null }`, `createdAt ∈ orderWindow`    |
| Ebook Orders revenue             | `EbookOrder`                                      | `status: COMPLETE`, `createdAt ∈ orderWindow`           |
| Book Orders revenue              | `BookOrder`                                       | `status: "verified"`, `createdAt ∈ orderWindow`         |
| Total Order Reports + series     | union of all four above                           | `createdAt ∈ totalWindow`                               |
| New Customers list               | `Customer`                                        | `isAccountDeleted: false`, sort `createdAt -1`          |
| Recent Package Subscriptions     | `PackageCourseSubscription` populate `targetPackageId` + `customerId` | `courseId: null`, sort `createdAt -1` (package name lives on `targetPackageId`, not `packageId` which refs the price row) |
| Recent Course Subscriptions      | `PackageCourseSubscription` populate `courseId`   | `courseId: { $ne: null }`, sort `createdAt -1`          |
| Recent Book Orders               | `BookOrder` populate `items.bookId`               | sort `createdAt -1` (book metadata lives inside `items[]`) |
| Recent Ebook Subscriptions       | `EbookSubscription` populate `ebookId`            | sort `createdAt -1`                                     |

---

## Frontend binding guide

The widgets in the screenshots were showing `Unknown package`, `Unknown book`, and `User #undefined` because of incorrect field paths on the FE. Use the paths below — these are the **only** valid bindings.

### New Customers card

| UI element        | Path                                            | Fallback                       |
| ----------------- | ----------------------------------------------- | ------------------------------ |
| Display name      | `firstName + " " + (lastName ?? "")` (trimmed)  | If both null → `phoneNumber`   |
| Sub-line / ID     | `phoneNumber`                                   | else `_id`                     |
| Avatar            | `profileImage`                                  | else initials from name        |
| Joined timestamp  | `createdAt`                                     | —                              |

> ⚠️ There is **no `userId` field** on `Customer`. The big numbers in the design (9904451371, 8160530058, …) are `phoneNumber` values, not IDs. Bind to `phoneNumber`.

### Recent Package Subscriptions card

| UI element     | Path                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| Package title  | `targetPackageId.name`                                                            |
| Package image  | `targetPackageId.image`                                                           |
| Customer name  | `customerId.firstName + " " + customerId.lastName` → fallback `customerId.phoneNumber` |
| Amount         | `paidAmount`                                                                      |
| Status         | `status` (boolean — `true` = active, `false` = inactive)                          |
| Order ID line  | `_id` (the subscription id; there is no human order id on this collection)        |

> ⚠️ Do **not** read `packageId.name`. `packageId` refs a price row (`PackageCourseEbookPrice`), not the package. Always read `targetPackageId.*`.

### Recent Course Subscriptions card

| UI element     | Path                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| Course title   | `courseId.name`                                                                   |
| Course image   | `courseId.image` → fallback `courseId.thumbnail`                                  |
| Customer name  | `customerId.firstName + " " + customerId.lastName` → fallback `customerId.phoneNumber` |
| Amount         | `paidAmount`                                                                      |
| Status         | `status`                                                                          |

### Recent Book Orders card

A book order can contain multiple books, so book metadata lives **inside `items[]`**.

| UI element     | Path                                                              |
| -------------- | ----------------------------------------------------------------- |
| Book title     | `items[0].bookId.name` → fallback `items[0].name` (denormalized, always present) |
| Book image     | `items[0].bookId.image` → fallback `items[0].bookId.thumbnail`    |
| Order ID line  | `receiptId`                                                       |
| Amount         | `amount` (total order amount, not per-item)                       |
| Status badge   | `status` (string — `pending` / `verified` / `shipped` / `delivered` / `cancelled`) |
| Item count     | `items.length` (only display if > 1, e.g. "+2 more")              |

> ⚠️ There is **no top-level `bookId`** on `BookOrder`. Reading `order.bookId.name` will always be undefined → "Unknown book". Always go through `items[]`.

### Recent Ebook Subscriptions card

| UI element     | Path                                                              |
| -------------- | ----------------------------------------------------------------- |
| Ebook title    | `ebookId.name`                                                    |
| Ebook image    | `ebookId.image`                                                   |
| Customer name  | `customerId.firstName + " " + customerId.lastName` → fallback `customerId.phoneNumber` |
| Status         | `status`                                                          |

### Order Reports cards (top row)

| UI element                  | Path                                  |
| --------------------------- | ------------------------------------- |
| Package Orders amount       | `orderReports.package.amount`         |
| Package Orders delta chip   | `orderReports.package.deltaPct` (integer; positive = up arrow green, negative = down arrow red, zero = neutral) |
| Course Orders amount/delta  | `orderReports.course.amount` / `.deltaPct` |
| Ebook Orders amount/delta   | `orderReports.ebook.amount` / `.deltaPct`  |
| Book Orders amount/delta    | `orderReports.book.amount` / `.deltaPct`   |

### Total Order Reports widget

| UI element        | Path                                         |
| ----------------- | -------------------------------------------- |
| Total Orders      | `totalOrderReports.totalOrders`              |
| Total Earnings    | `totalOrderReports.totalEarnings`            |
| Chart x-axis      | `totalOrderReports.series[].bucket` (string) |
| Chart y-axis      | `totalOrderReports.series[].earnings` (or `.orders` depending on the toggle) |
| X-axis unit label | `totalOrderReports.unit` (`"hour"` → "Hour of day", `"day"` → "Date") |

### Universal fallback rule

For every populated reference (`targetPackageId`, `courseId`, `ebookId`, `items[].bookId`, `customerId`), the FE should null-check the populated object before reading `.name`. If the referenced document was deleted, populate returns `null` — render `"—"` or `"Deleted"` instead of `"Unknown"`.

```ts
// good
const title = sub.targetPackageId?.name ?? "—";
const customer =
  [sub.customerId?.firstName, sub.customerId?.lastName].filter(Boolean).join(" ")
  || sub.customerId?.phoneNumber
  || "—";
```

---

## Notes

- Package vs. Course split relies on `PackageCourseSubscription.courseId === null` (package sale) vs. set (course sale). On the same row, `packageId` refs a `PackageCourseEbookPrice` price row, while `targetPackageId` refs the actual `Package` document — that's why the FE must use `targetPackageId` for the package name.
- `deltaPct` compares the current window's revenue to a window of equal span immediately preceding it. When the previous window is 0 and the current is > 0, it returns `100` rather than `Infinity`.
- All revenue values are in INR (no currency conversion).
- Auth is enforced at the router level (`authenticate` + `requireRole`). See `src/admin/dashboard/dashboard.routes.ts`.
