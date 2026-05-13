# Create Order — Client APIs (Book / Course / Package / Ebook)

All four checkout flows live under `/api/v1/client/payment/`. They share Razorpay plumbing but are split into per-type endpoints because validation, price source, and the local DB row created differ. A single `/verify` endpoint handles post-payment fulfillment for all of them.

**Base URL:** `/api/v1/client/payment`
**Auth:** `Authorization: Bearer <token>` required on every endpoint below.

---

## 1. Create Book Order

`POST /api/v1/client/payment/create-order`

Creates a `BookOrder` in `PENDING` from the customer's active `BookCart`, then a Razorpay order. No request body — the active cart is the source of truth.

### Preconditions
- Active `BookCart` with at least one item.
- `shippingId` must be set on the cart.
- All cart items must reference active books.

### Request

```http
POST /api/v1/client/payment/create-order
Authorization: Bearer <token>
```

No body.

### Success — `201 Created`

```json
{
  "success": true,
  "data": {
    "bookOrderId": "65f...",
    "receiptId": "books-1715424000000-ab12cd",
    "razorpay": {
      "orderId": "order_Nx...",
      "keyId": "rzp_test_...",
      "amount": 49900,
      "currency": "INR"
    },
    "amountInRupees": 499,
    "breakdown": {
      "totalListPrice": 599,
      "totalDiscountedPrice": 499,
      "shipping": 0,
      "shippingWaived": true
    }
  }
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | `Cart is empty.` / `Shipping address is required before payment.` / `One or more books in the cart are unavailable.` / `Order amount is zero` |
| 401 | `Unauthorized.` |
| 500 | Razorpay creds missing / SDK error |

---

## 2. Create Course Order

`POST /api/v1/client/payment/create-order/course`

Creates a `PackageCourseSubscription` in `paymentStatus="pending"` plus a Razorpay order. Keyed on the price/plan row (`PackageCourseEbookPrice._id`) — that row is the single source of truth for price and duration.

### Request

```http
POST /api/v1/client/payment/create-order/course
Authorization: Bearer <token>
Content-Type: application/json

{
  "packageId": "65f..."   // PackageCourseEbookPrice._id (the plan)
}
```

### Success — `201 Created`

```json
{
  "success": true,
  "data": {
    "subscriptionId": "65f...",
    "receiptId": "course-1715424000000-ab12cd",
    "razorpay": {
      "orderId": "order_Nx...",
      "keyId": "rzp_test_...",
      "amount": 299900,
      "currency": "INR"
    },
    "amountInRupees": 2999,
    "course": {
      "_id": "65f...",
      "name": "Gujarat Geography By Abhijeetsinh Zala"
    },
    "plan": {
      "_id": "65f...",
      "duration": 12,
      "price": 2999
    }
  }
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid `packageId` / not a course plan / plan amount is zero |
| 401 | `Unauthorized.` |
| 404 | Plan not found / Course not found or inactive |
| 409 | `You already have an active subscription to this plan.` |
| 500 | Razorpay creds missing / SDK error |

---

## 3. Create Package Order

`POST /api/v1/client/payment/create-order/package`

Mirror of the course endpoint, for plan rows whose target is a `Package` (a bundle of courses / materials) rather than a single `Course`. Keyed on the same `PackageCourseEbookPrice._id` field — the plan row internally references the `Package`.

### Request

```http
POST /api/v1/client/payment/create-order/package
Authorization: Bearer <token>
Content-Type: application/json

{
  "packageId": "65f..."   // PackageCourseEbookPrice._id (the plan)
}
```

> **Note:** `packageId` here is the **plan/price row id**, not the `Package._id`. Same naming convention as the course endpoint — the plan row is the single source of truth for price and duration.

### Success — `201 Created`

```json
{
  "success": true,
  "data": {
    "subscriptionId": "65f...",
    "receiptId": "package-1715424000000-ab12cd",
    "razorpay": {
      "orderId": "order_Nx...",
      "keyId": "rzp_test_...",
      "amount": 499900,
      "currency": "INR"
    },
    "amountInRupees": 4999,
    "package": {
      "_id": "65f...",
      "name": "Constable Hybrid Offline + Live With Material"
    },
    "plan": {
      "_id": "65f...",
      "duration": 6,
      "price": 4999
    }
  }
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid `packageId` / `This plan is not a package plan` / plan amount is zero |
| 401 | `Unauthorized.` |
| 404 | Plan not found / Package not found or inactive |
| 409 | `You already have an active subscription to this plan.` |
| 500 | Razorpay creds missing / SDK error |

---

## 4. Create Ebook Order

`POST /api/v1/client/payment/create-order/ebook`

Creates an `EbookOrder` in `PENDING` plus a Razorpay order. Keyed on `EbookPrice._id` (the plan/duration row).

### Request

```http
POST /api/v1/client/payment/create-order/ebook
Authorization: Bearer <token>
Content-Type: application/json

{
  "planId": "65f..."   // EbookPrice._id
}
```

### Success — `201 Created`

```json
{
  "success": true,
  "data": {
    "ebookOrderId": "65f...",
    "receiptId": "ebook-1715424000000-ab12cd",
    "razorpay": {
      "orderId": "order_Nx...",
      "keyId": "rzp_test_...",
      "amount": 29900,
      "currency": "INR"
    },
    "amountInRupees": 299,
    "ebook": {
      "_id": "65f...",
      "name": "Vartaman Vishesh March 2026"
    },
    "plan": {
      "_id": "65f...",
      "duration": 6,
      "price": 299
    }
  }
}
```

### Errors

| Status | Cause |
|---|---|
| 400 | Invalid `planId` / plan amount is zero |
| 401 | `Unauthorized.` |
| 404 | Plan not found / Ebook not found or inactive |
| 409 | `You already have an active subscription to this ebook.` |
| 500 | Razorpay creds missing / SDK error |

---

## 5. Verify Payment (shared)

`POST /api/v1/client/payment/verify`

Single endpoint for all four flows. Called from the app after Razorpay's checkout succeeds. HMAC-verifies the signature, then dispatches fulfillment based on which local row holds the `razorpay_order_id` (`BookOrder` / `PackageCourseSubscription` / `EbookOrder`).

Course and package purchases share `PackageCourseSubscription` — the response just identifies which kind by the `kind` field below.

Idempotent: re-running on an already-verified order returns 200 with the existing row.

### Request

```http
POST /api/v1/client/payment/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "razorpay_order_id": "order_Nx...",
  "razorpay_payment_id": "pay_Nx...",
  "razorpay_signature": "abcdef..."
}
```

### Success — `200 OK`

Response shape depends on the matched order kind:

**Book:**
```json
{ "success": true, "data": { "kind": "book", "order": { ... } } }
```

**Course or Package** (both write to `PackageCourseSubscription`; the `subscription.courseId` vs `subscription.targetPackageId` field tells them apart):
```json
{ "success": true, "data": { "kind": "course", "subscription": { ... } } }
```

**Ebook:**
```json
{ "success": true, "data": { "kind": "ebook", "order": { ... } } }
```

### Errors

| Status | Cause |
|---|---|
| 400 | `Signature verification failed.` / schema validation |
| 401 | `Unauthorized.` |
| 404 | `No local order found for this Razorpay order id.` |
| 500 | Server error |

---

## Frontend Integration Notes

1. **Pick the right create-order endpoint** based on the product context (cart vs. course plan vs. ebook plan).
2. **Open Razorpay checkout** with the returned `razorpay` block (`keyId`, `orderId`, `amount`, `currency`).
3. **On checkout success**, immediately call `POST /payment/verify` with the three Razorpay fields returned by the SDK.
4. **Treat 200 as fulfilled.** The webhook may have already flipped the row — the verify endpoint is idempotent.
5. **Amount fields:** `razorpay.amount` is in **paise**; `amountInRupees` is the human-readable rupee value. Display `amountInRupees`; pass `razorpay.amount` to the SDK.
6. **Currency** is hard-coded to `INR` everywhere today.
7. **`plan.duration` is in MONTHS** for course, package, and ebook plans. On payment verify, `endAt = paidAt + duration months` (calendar months, not 30-day blocks). So a 6-month plan bought on Mar 11 ends on Sep 11.
8. **Course vs Package** — both endpoints store the resulting subscription in `PackageCourseSubscription`. The shape of the row differs: course subs have `courseId` set and `targetPackageId = null`; package subs have `targetPackageId` set and `courseId = null`. Downstream APIs (`/my-subscriptions`, `/purchase-history/subscriptions`) expose a `kind: "course" | "package"` field so the FE can render the right card and route.

## Why four endpoints, not one

Each purchase type has its own validation, its own price source, and creates a different local row with different post-payment fulfillment. The only shared concern (Razorpay SDK call) is factored into `src/client/payment/razorpay.ts`. A single discriminated endpoint would collapse this into a switch statement and a union-typed body — more fragile, not more useful.

Course and Package use separate endpoints despite sharing the `PackageCourseSubscription` row because their *plan validation* differs (the plan row must reference a `Course` vs a `Package`) — letting a client pass either kind to a single endpoint would push that branching into the wrong layer.
