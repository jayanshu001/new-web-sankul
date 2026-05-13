# Purchase History — Client APIs

Drives the three tabs on the **Purchase History** screen (Subscriptions / Books / E-Book) and the per-row **Receipt** action.

**Base URL:** `/api/v1/client/purchase-history`
**Auth:** `Authorization: Bearer <token>` required on every endpoint.

All list endpoints accept the same pagination query:
- `page` (default `1`, min `1`)
- `limit` (default `20`, min `1`, max `100`)

Each list endpoint returns:

```json
{
  "success": true,
  "data": [ /* rows — shape depends on the tab */ ],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

Only **successful** purchases are returned:
- Subscriptions → `paymentStatus === "verified"`
- Books → `status in [verified, shipped, delivered]`
- E-Books → `status === "complete"`

Pending / failed / cancelled orders are intentionally hidden from this screen.

---

## 1. Subscriptions Tab

`GET /api/v1/client/purchase-history/subscriptions`

Course and package purchases (both stored in `PackageCourseSubscription`). Each row carries a badge (`Live` / `Recorded` / `Test Series`) resolved through `Package → PackageType` and a `kind` field that distinguishes course vs package.

### Row shape

```json
{
  "_id": "65f...",
  "kind": "course",
  "title": "Gujarat Geography By Abhijeetsinh Zala",
  "author": "Abhijeetsinh Zala",
  "thumbnail": "https://.../thumb.jpg",
  "badge": "Recorded",
  "amount": 3999,
  "purchasedAt": "2026-03-12T08:00:00.000Z",
  "startAt": "2026-03-12T08:00:00.000Z",
  "endAt": "2027-03-12T08:00:00.000Z",
  "receiptUrl": "/api/v1/client/purchase-history/subscriptions/65f.../receipt",
  "meta": {
    "courseId": "65f...",
    "targetPackageId": null,
    "planId": "65f...",
    "razorpayOrderId": "order_Nx...",
    "razorpayPaymentId": "pay_Nx..."
  }
}
```

**`kind`** is one of `"course" | "package"`:
- `course` → `meta.courseId` set, `meta.targetPackageId` null
- `package` → `meta.targetPackageId` set, `meta.courseId` null

`meta.planId` is the `PackageCourseEbookPrice._id` in both cases.

---

## 2. Books Tab

`GET /api/v1/client/purchase-history/books`

Physical book orders. Title shows the first item; multi-line orders are suffixed with `+N more`.

### Row shape

```json
{
  "_id": "65f...",
  "title": "Vartaman Vishesh March 2026",
  "thumbnail": "https://.../thumb.jpg",
  "amount": 199,
  "purchasedAt": "2026-03-12T08:00:00.000Z",
  "status": "delivered",
  "receiptUrl": "/api/v1/client/purchase-history/books/65f.../receipt",
  "meta": {
    "receiptId": "books-1715424000000-ab12cd",
    "itemsCount": 1,
    "razorpayOrderId": "order_Nx...",
    "razorpayPaymentId": "pay_Nx..."
  }
}
```

---

## 3. E-Book Tab

`GET /api/v1/client/purchase-history/ebooks`

Digital ebook purchases.

### Row shape

```json
{
  "_id": "65f...",
  "title": "E-Book: Vartaman Vishesh March 2026",
  "author": "Editorial Team",
  "thumbnail": "https://.../thumb.jpg",
  "amount": 299,
  "purchasedAt": "2026-03-12T08:00:00.000Z",
  "status": "complete",
  "receiptUrl": "/api/v1/client/purchase-history/ebooks/65f.../receipt",
  "meta": {
    "ebookId": "65f...",
    "razorpayOrderId": "order_Nx...",
    "razorpayPaymentId": "pay_Nx...",
    "transactionId": null
  }
}
```

---

## 4. Receipts (uniform JSON shape)

Each list row exposes a `receiptUrl`. Hitting it returns a uniform receipt object the frontend can use to render a receipt screen or generate a PDF. Server-side PDF can be added later without changing the URL.

### Endpoints

| Tab | Endpoint |
|---|---|
| Subscriptions | `GET /api/v1/client/purchase-history/subscriptions/:id/receipt` |
| Books | `GET /api/v1/client/purchase-history/books/:id/receipt` |
| E-Books | `GET /api/v1/client/purchase-history/ebooks/:id/receipt` |

`:id` is the `_id` of the row from the corresponding list endpoint. The endpoint enforces ownership — a customer can only fetch their own receipts.

### Response shape (all three)

```json
{
  "success": true,
  "data": {
    "kind": "book",
    "receiptId": "books-1715424000000-ab12cd",
    "purchasedAt": "2026-03-12T08:00:00.000Z",
    "paidAt": "2026-03-12T08:01:14.000Z",
    "status": "delivered",
    "customer": { "id": "65f..." },
    "payment": {
      "method": "razorpay",
      "razorpayOrderId": "order_Nx...",
      "razorpayPaymentId": "pay_Nx..."
    },
    "items": [
      {
        "name": "Vartaman Vishesh March 2026",
        "qty": 1,
        "unitPrice": 199,
        "lineTotal": 199
      }
    ],
    "totals": {
      "subTotal": 199,
      "shipping": 0,
      "discount": 100,
      "grandTotal": 199,
      "currency": "INR"
    },
    "extra": {
      "shippingId": "65f...",
      "tracking": { "status": "delivered", "history": [ /* ... */ ] }
    }
  }
}
```

**`kind` is one of `"book" | "course" | "ebook"`.**

**Notes per kind:**

- **Book** — `totals.shipping` and `totals.discount` populated; `extra` carries `shippingId` and `tracking`.
- **Course** — single line item titled `"<course> — <package>"`; `extra` carries `courseId`, `packageId`, `duration`, `startAt`, `endAt`.
- **E-Book** — single line item titled `"E-Book: <name>"`; `extra` carries `ebookId`, `planId`, `duration`, `transactionId`.

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid id |
| 401 | `Unauthorized.` |
| 404 | Order not found, or not owned by the authenticated customer |
| 500 | Server error |

---

## Frontend Integration Notes

1. **Tab switching** = three independent GETs. Each tab paginates independently.
2. **Receipt button** on any row → GET the row's `receiptUrl` → render the receipt JSON in a modal or screen. The shape is uniform across kinds, so a single component can render all three.
3. **Amount fields are in rupees** (not paise) on list endpoints and receipts. Currency is `INR`.
4. **Dates** are ISO 8601 UTC. Display in user locale.
5. **Empty state** — list endpoints return `data: []` with `pagination.total = 0` when there's nothing to show.
6. **Badge values** on Subscriptions come from `PackageType.name` — exact strings depend on admin config but typically `Live` / `Recorded` / `Test Series`.
