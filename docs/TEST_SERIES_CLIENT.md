# Test Series — Client API

Base URL: `/api/v1/client/test-series` (discovery) and `/api/v1/client/payment` (checkout).
Auth: Bearer customer token. Required on every route.

## Flow at a glance (matches the mockup)

1. **Listing screen** → `GET /test-series`
2. **Detail screen (Overview tab)** → `GET /test-series/:id`
3. **Test Content tab** → `GET /test-series/:id/papers`
4. **Plan / subject picker** → use `prices[]` from detail, optionally call
   `POST /payment/apply-promo/test-series` to preview the order summary.
5. **Pay Now** → `POST /payment/create-order/test-series` → open Razorpay
   checkout with the returned `razorpay` payload → on success call
   `POST /payment/verify` → access is granted.
6. **My series** → `GET /test-series/my/subscriptions`.

## Response envelope

```json
{ "success": true, "code": 200, "data": { ... }, "message": "Fetched.", "messages": {} }
```

---

## 1. List test series

`GET /api/v1/client/test-series?search=&page=1&limit=20`

```json
{
  "data": {
    "data": [
      {
        "_id": "...",
        "title": "Online Mock test 2025",
        "description": "...",
        "thumbnail": "https://.../cover.png",
        "examCategoryIds": [
          { "_id": "66aa...", "name": "GPSC" },
          { "_id": "66bb...", "name": "UPSC" }
        ],
        "language": "gu",
        "paperCount": 5,
        "isFree": false,
        "isPaid": true,
        "defaultPlan": {
          "_id": "...",
          "durationDays": 30,
          "price": 270,
          "originalPrice": 300,
          "discountPct": 10
        },
        "isPurchased": false,
        "daysLeft": null,
        "shareableLink": "https://.../s/test-series/..."
      }
    ],
    "total": 12,
    "page": 1,
    "limit": 20
  }
}
```

`defaultPlan` powers the price + "10% off" badge on the listing card.
`isPurchased` is `true` when the customer has an active (un-expired) subscription.
`examCategoryIds` is an **array of populated category objects** `{ _id, name }`
(a series can belong to multiple categories). It may be `[]`. The deprecated
singular `examCategoryId` is **no longer returned** by the client list/detail
endpoints — read `examCategoryIds` only. See
`TEST_SERIES_CATEGORY_MIGRATION_CLIENT.md` for the parser snippet.

---

## 2. Test series detail

`GET /api/v1/client/test-series/:id`

```json
{
  "data": {
    "series": {
      /* full TestSeries doc, plus: */
      "examCategoryIds": [
        { "_id": "66aa...", "name": "GPSC" },
        { "_id": "66bb...", "name": "UPSC" }
      ],
      "isPaid": true,
      "shareableLink": "https://.../s/test-series/..."
    },
    "contentCategories": [
      { "_id": "...", "name": "GPSC Mains Lecture PDF", "icon": null, "orderBy": 0 }
    ],
    "prices": [
      {
        "_id": "...",
        "durationDays": 10,
        "price": 270,
        "originalPrice": 300,
        "isDefault": true,
        "name": null,
        "status": true
      }
    ],
    "isPurchased": true,
    "activeSubscription": {
      "_id": "...",
      "startAt": "2026-05-15T...",
      "endAt": "2026-09-17T...",
      "price": 315
    }
  }
}
```

Use this for the **Overview tab** of the mockup (title, MRP, "10% off",
papers count, language, validity from `prices[].durationDays`, description).

---

## 3. Papers — "Test Content" tab

`GET /api/v1/client/test-series/:id/papers`

```json
{
  "data": {
    "isPaid": true,
    "hasAccess": true,
    "categories": [
      {
        "_id": "...",
        "name": "GPSC Mains Lecture PDF",
        "icon": null,
        "orderBy": 0,
        "papers": [
          {
            "linkId": "...",
            "exam": {
              "_id": "...",
              "title": "GPSC Mains Lecture PDF",
              "isPaid": true,
              "durationMinutes": 10,
              "questionCount": 10,
              "positiveMarks": 1,
              "negativeMarks": 0,
              "language": "gu",
              "difficulty": "medium"
            },
            "orderBy": 0,
            "isPaid": true,
            "isLocked": false,
            "attemptState": "retake",
            "lastResult": {
              "score": 7,
              "total": 10,
              "success": 7,
              "failed": 2,
              "skip": 1,
              "timing": "08:34"
            }
          }
        ]
      }
    ]
  }
}
```

- **`isPaid`** (top level) → `true` when the series is not free (= `!series.isFree`).
  Drives the "paid series" badge / paywall on the Test Content tab.
- **`hasAccess`** → render `Start` / `Retake` buttons live only when `true`.
  Free series (`series.isFree === true`) always return `hasAccess: true`.
- **`paper.isPaid`** → the individual paper's own paid flag (from the Exam).
- **`paper.isLocked`** → `true` when the paper is paid **and** the customer has no
  access (`isPaid && !hasAccess`). Render a lock icon / "Buy to unlock" on these and
  disable the Start button regardless of `attemptState`.
- **`attemptState`** → `"start"` (button label "Start") or `"retake"` (button
  "Retake"). Mirrors the mockup's two states.
- The actual question delivery + submission still uses the existing
  `/api/v1/client/quizzes/...` endpoints — call `POST /quizzes/:examId/attempts/start`
  with `exam._id` when the user taps Start/Retake.

---

## 4. Checkout — Preview

Two ways to build the "Order Summary" card. Either works; pick one.

### Option A — pure preview (no promo dependency)
`POST /api/v1/client/test-series/checkout/preview`

```json
{ "planId": "...", "promocode": "WELCOME10" }   // promocode optional
```

Response:
```json
{
  "data": {
    "plan": { "_id": "...", "durationDays": 10, "price": 300, "originalPrice": 300 },
    "breakdown": {
      "basePrice": 300,
      "discountAmount": 20,
      "netPrice": 280,
      "gstAmount": 14,
      "handlingFee": 20,
      "totalAmount": 314,
      "promocodeId": "..."
    },
    "promo": {
      "promocode": "WELCOME10",
      "discountType": "flat",
      "discountValue": 20
    },
    "validUntil": "2026-05-25T..."
  }
}
```

### Option B — promo-only (matches the live-course flow shape)
`POST /api/v1/client/payment/apply-promo/test-series`

```json
{ "planId": "...", "promocode": "WELCOME10" }
```

Returns `{ promocode, promocodeId, discountType, discountValue, breakdown }`.

**Breakdown semantics:**

| field          | meaning                                        |
| -------------- | ---------------------------------------------- |
| `basePrice`    | plan price (MRP discount already baked in)     |
| `discountAmount` | promo discount applied on basePrice          |
| `netPrice`     | basePrice − discountAmount                     |
| `gstAmount`    | GST on netPrice (default 5%, env-configurable) |
| `handlingFee`  | flat internet handling fee (default ₹20)       |
| `totalAmount`  | netPrice + gstAmount + handlingFee — the amount the customer pays |

GST rate and handling fee are overridable per environment via
`TEST_SERIES_GST_PERCENT` and `TEST_SERIES_HANDLING_FEE` env vars.

---

## 5. Checkout — Create order (Razorpay)

`POST /api/v1/client/payment/create-order/test-series`

```json
{ "planId": "...", "promocode": "WELCOME10" }   // promocode optional
```

Response (HTTP 201):
```json
{
  "data": {
    "testSeriesOrderId": "...",
    "receiptId": "ts-1747000000000-abcd12",
    "razorpay": {
      "orderId": "order_NXXXX",
      "keyId": "rzp_test_XXXX",
      "amount": 31400,
      "currency": "INR"
    },
    "amountInRupees": 314,
    "breakdown": { /* same shape as preview */ },
    "testSeries": { "_id": "...", "title": "Online Mock test 2025" },
    "plan": { "_id": "...", "durationDays": 10, "price": 300, "originalPrice": 300 }
  }
}
```

Front-end opens Razorpay Checkout with `razorpay.orderId / keyId / amount /
currency`. On success the SDK returns `{ razorpay_order_id, razorpay_payment_id,
razorpay_signature }`.

Errors:

| status | reason                                                            |
| ------ | ----------------------------------------------------------------- |
| 400    | Promo invalid/expired, or final amount < ₹1                       |
| 404    | Plan / series not found                                           |
| 409    | Customer already has an active subscription to this series       |
| 500    | Razorpay creds not configured                                     |

---

## 6. Verify payment

`POST /api/v1/client/payment/verify`

```json
{
  "razorpay_order_id": "order_NXXXX",
  "razorpay_payment_id": "pay_NXXXX",
  "razorpay_signature": "..."
}
```

Response on success:
```json
{
  "data": {
    "kind": "test-series",
    "order": { /* TestSeriesOrder, status: "complete" */ },
    "subscription": {
      "_id": "...",
      "testSeriesId": "...",
      "startAt": "2026-05-15T...",
      "endAt": "2026-05-25T...",
      "price": 314,
      "paymentType": "online",
      "status": true
    }
  }
}
```

This endpoint is **idempotent**: re-running after success returns 200 with the
existing row and `message: "Already verified."`.

---

## 7. My subscriptions

`GET /api/v1/client/test-series/my/subscriptions`

```json
{
  "data": {
    "data": [
      {
        "_id": "...",
        "testSeriesId": {
          "_id": "...",
          "title": "Online Mock test 2025",
          "thumbnail": "...",
          "paperCount": 5
        },
        "startAt": "2026-05-15T...",
        "endAt": "2026-09-17T...",
        "price": 315,
        "isActive": true
      }
    ],
    "total": 1
  }
}
```

`isActive` is derived (`endAt > now && status`). Use this to populate the
"Purchased" tab and to drive the `Start` (vs `Buy Now`) CTA on the detail page
when a customer revisits a series they own.

---

## End-to-end front-end checklist

1. **Series list card** — `GET /test-series`, show `defaultPlan.price`, strike
   `defaultPlan.originalPrice`, render `discountPct` badge if > 0. Tap → detail.
2. **Detail Overview tab** — `GET /test-series/:id`. If `isPurchased === false`,
   show "Buy Now"; else "Start" (deep link into Test Content tab).
3. **Test Content tab** — `GET /test-series/:id/papers`. Per paper:
   `attemptState === "retake"` → render Retake button; else Start.
   Both call `POST /api/v1/client/quizzes/:examId/attempts/start`.
4. **Plan picker / Order Summary** — `POST /test-series/checkout/preview` for
   the live breakdown; bind GST, handling fee, total, valid-until from response.
5. **Pay Now** — `POST /payment/create-order/test-series`, launch Razorpay with
   the returned payload.
6. **On Razorpay success** — `POST /payment/verify`. Show success state, refresh
   `my/subscriptions`.

## Env vars used

| var                            | default | meaning                          |
| ------------------------------ | ------- | -------------------------------- |
| `TEST_SERIES_GST_PERCENT`      | `5`     | GST rate applied to `netPrice`   |
| `TEST_SERIES_HANDLING_FEE`     | `20`    | Flat internet handling fee (₹)   |
| `RAZORPAY_KEY_ID` / `_SECRET`  | —       | Razorpay merchant credentials    |
