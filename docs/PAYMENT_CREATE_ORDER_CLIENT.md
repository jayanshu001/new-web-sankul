# Payment — Create Order (Client, Razorpay)

Endpoints the app calls **right before launching the Razorpay checkout**. The server reads the relevant local state (active cart, plan price, etc.), computes the amount itself (never trusts a client-supplied amount), creates a local row in a pending state, then creates a Razorpay order via Razorpay's REST API and returns everything the mobile SDK needs.

This document covers the **create-order** endpoints only. Verifying the payment signature (after the user pays) and fulfilling the order (flipping pending → verified, granting access) is a **separate** endpoint and a separate doc.

## Why one endpoint per purchase type

There is one endpoint per purchase type (book cart, course, …) rather than a single `/create-order` with a `purpose` field. Reason: the *Razorpay plumbing* is shared (build amount in paise, call `rp.orders.create`, return `{ orderId, keyId, amount, currency }`) but the *what does this purchase mean* is completely different per type:

| Step             | Book cart                                  | Course / Package                                        |
|------------------|--------------------------------------------|---------------------------------------------------------|
| Source of amount | Active `BookCart` + `Book.discountedPrice` + shipping | `PackageCourseEbookPrice.price` looked up by `packageId` |
| Local row        | `BookOrder` (with shipping, items, weight) | `PackageCourseSubscription` (with courseId, dates)      |
| Required input   | None (cart is implicit)                    | `{ packageId }`                                         |
| Validations      | Cart non-empty, shipping attached, books active | Plan active, course active, not already subscribed      |

The Razorpay client + response builder live in **`src/client/payment/razorpay.ts`** and are imported by every per-type handler. So we get the DRY benefit without a `switch (purpose)` polluting validation.

---

## 1) Book cart — `POST /api/v1/client/payment/create-order`

- **Auth:** required (`Authorization: Bearer <customerAccessToken>`).
- **Body:** none. The server reads the active cart on its own — that's the whole point of this design.

### Successful response (`201`)

```json
{
  "success": true,
  "data": {
    "bookOrderId": "66f...local Mongo id of the BookOrder we just created",
    "receiptId": "books-1715...-a1b2c3",
    "razorpay": {
      "orderId": "order_OQ7...",
      "keyId": "rzp_live_xxx",
      "amount": 629300,
      "currency": "INR"
    },
    "amountInRupees": 6293,
    "breakdown": {
      "totalListPrice": 6600,
      "totalDiscountedPrice": 6293,
      "shipping": 0,
      "shippingWaived": true
    }
  }
}
```

| Field                     | Why the app needs it                                                              |
|---------------------------|-----------------------------------------------------------------------------------|
| `bookOrderId`             | Send back to the verify endpoint so the server can correlate fulfillment.         |
| `receiptId`               | Stable human-readable id. Same string is the Razorpay `receipt`.                  |
| `razorpay.orderId`        | The `order_id` you pass to the Razorpay mobile SDK.                               |
| `razorpay.keyId`          | The publishable key the SDK expects. Not a secret — safe to send to the client.   |
| `razorpay.amount`         | In **paise** (Razorpay convention). What the SDK expects, no conversion needed.   |
| `razorpay.currency`       | Always `"INR"` for now.                                                           |
| `amountInRupees`          | Convenience — for showing on the Checkout summary. Equals `amount / 100`.         |
| `breakdown`               | Convenience — to render the final summary if the app wants to confirm one last time before launching the SDK. |

### Error responses

| Status | When                                                                                  |
|--------|---------------------------------------------------------------------------------------|
| `400`  | Cart is empty / missing shipping / one or more books unavailable / amount is `₹0`.    |
| `401`  | Missing or invalid bearer token.                                                      |
| `500`  | Razorpay credentials not configured on the server, or the Razorpay API call failed.   |

## Mobile-side flow

```
1.  POST /api/v1/client/payment/create-order
2.  read response → open Razorpay SDK with:
        key:       data.razorpay.keyId
        order_id:  data.razorpay.orderId
        amount:    data.razorpay.amount       // paise
        currency:  data.razorpay.currency
        prefill:   { name, email, contact from profile }
3.  on success callback the SDK gives you:
        razorpay_order_id
        razorpay_payment_id
        razorpay_signature
4.  POST /api/v1/client/payment/verify   ← separate endpoint, separate doc
        body: { bookOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
```

Step 4 doesn't exist yet. It will land next, alongside the webhook handler.

## Server behaviour, in order

1. **Auth check** — 401 if no user.
2. **Razorpay credentials check** — if `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` env vars are missing, returns `500 "Razorpay credentials not configured on the server."` We chose request-time failure (not boot-time) so local dev can run without real keys.
3. **Cart sanity** — active cart exists, has items, has a `shippingId` attached. If any of those fail, `400`.
4. **Books still active** — every cart line resolves to a `Book` with `status: true`. If a book was disabled while it sat in the cart, `400` (so the cart screen can refresh and show the user what changed).
5. **Server-side amount computation** — uses `listPrice`, `discountedPrice`, `shippingPrice` from the **server's** copy of each Book, plus `BookSetting.freeShippingMinOrderAmount`. No part of this comes from the request body.
6. **Create local `BookOrder`** in a transaction with `status: PENDING`, `paymentMethod: RAZORPAY`, `razorpayOrderId` blank (filled in step 7).
7. **Create Razorpay order** by calling `Razorpay.orders.create({ amount, currency, receipt, notes })` *outside* the DB transaction (external HTTP call shouldn't hold a Mongo session open).
8. **Patch the `BookOrder`** with `razorpayOrderId` and store the full Razorpay response in `razorpayOrderPayload` for debugging.
9. **Return** the payload above.

## Idempotency / what happens on retries

If the app calls `create-order` twice (network retry, double-tap on the Buy Now button) you get **two** Razorpay orders and **two** `BookOrder` rows in `PENDING`. The user only pays one of them, so the unpaid one stays `PENDING` forever. That's intentional for now — Razorpay treats unpaid orders as expired automatically, and the unpaid `BookOrder` is harmless because it never goes anywhere.

If we want stricter idempotency later: accept an `Idempotency-Key` header from the app and reuse the same Razorpay order on identical retries. Out of scope for this pass.

## Configuration

Add to `.env` (or whatever env source the deployment uses):

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

The `key_secret` **never** leaves the server. Only `key_id` is returned to the app (it's marked publishable in Razorpay's docs).

## Migration note — old `placeOrder` removed

The previous `POST /api/v1/client/books/order` (`placeOrder`) created a `BookOrder` row but never called Razorpay, so the app had no `order_id` to launch the SDK with. It has been **deleted** — both the route and the controller. The new `POST /api/v1/client/payment/create-order` is its replacement and does the full job in one call.

The `placeOrderSchema` Zod schema and the unused `PaymentMethod` import in `book.validation.ts` were also removed.

---

## 2) Course purchase — `POST /api/v1/client/payment/create-order/course`

Used when the user buys access to a course/package plan from the Course Detail screen.

### Auth

Required (`Authorization: Bearer <customerAccessToken>`).

### Request body

```json
{ "packageId": "66f1c2..." }
```

| field        | type   | required | notes                                                                   |
|--------------|--------|----------|-------------------------------------------------------------------------|
| `packageId`  | string | yes      | The `_id` of a `PackageCourseEbookPrice` row (the specific plan/duration). |

We deliberately key on `PackageCourseEbookPrice._id` rather than `(courseId, duration)` because that row is the single source of truth for the price. There is no way for the client to ask for a `(courseId, duration)` that exists in their head but not in our DB.

### Successful response (`201`)

```json
{
  "success": true,
  "data": {
    "subscriptionId": "66f1c2... local PackageCourseSubscription _id (pending)",
    "receiptId": "course-1715...-a1b2c3",
    "razorpay": {
      "orderId": "order_OQ7...",
      "keyId": "rzp_live_xxx",
      "amount": 199900,
      "currency": "INR"
    },
    "amountInRupees": 1999,
    "course":  { "_id": "...", "name": "UPSC CSE Foundation 2026" },
    "plan":    { "_id": "...", "duration": 365, "price": 1999 }
  }
}
```

### Error responses

| Status | When                                                                                  |
|--------|---------------------------------------------------------------------------------------|
| `400`  | `packageId` missing/malformed; plan is not a course plan (no `courseId`); price is 0. |
| `401`  | Missing/invalid bearer token.                                                         |
| `404`  | Plan inactive or doesn't exist; course inactive or doesn't exist.                     |
| `409`  | Customer already has a verified active subscription to this exact plan.               |
| `500`  | Razorpay credentials missing on the server, or the Razorpay API call failed.          |

### Server behaviour, in order

1. Auth check → 401 if no user.
2. Razorpay credentials check → 500 with a clear message if env vars are missing.
3. Validate body → 400 on bad `packageId`.
4. Look up `PackageCourseEbookPrice` (status: true). 404 if missing.
5. Reject if the plan is *not* a course plan (`courseId` is null — those are ebook plans, handled by a future ebook endpoint). 400.
6. Reject if `price <= 0`. The free-grant flow is a separate path.
7. Look up `Course` (status: true). 404 if missing.
8. **Double-buy guard** — return 409 if the customer already has `(customerId, courseId, packageId, status: true, paymentStatus: "verified")`. Pending rows are intentionally *not* a guard, because a user whose previous attempt failed should be able to retry.
9. **Create local `PackageCourseSubscription`** with `paymentStatus: "pending"`, `paidAmount: plan.price`, `status: true`. `startAt`/`endAt` stay null for now — they're set by the verify endpoint when the payment is confirmed (using `plan.duration`).
10. **Call `Razorpay.orders.create`** with `amount: round(price * 100)`, `currency: "INR"`, `receipt: receiptId`, and `notes: { kind: "course", subscriptionId, courseId, packageId, customerId }`. The `notes` are what the verify endpoint and webhook use to find this row.
11. **Patch the subscription** with `razorpayOrderId`.
12. Return the payload above.

### Schema additions to `PackageCourseSubscription`

This change adds four fields to support pending → verified state:

```ts
paymentStatus: "pending" | "verified" | "failed"   // default "verified" — see below
razorpayOrderId?: string
razorpayPaymentId?: string
paidAt?: Date
```

**Why `default: "verified"`** — legacy rows (created before this change) have no `paymentStatus`, and so do rows created via admin/promoter free-grant flows that already exist in the codebase. Defaulting to `"verified"` means none of the ~20 existing read sites change behaviour: every legacy and admin-granted sub continues to count as paid, exactly as it did before. The only rows that will ever read back as `"pending"` are ones this new endpoint just created.

**Access-gating is unchanged** — `lecture.controller.ts` and friends already gate on `endAt > now`, and pending rows have `endAt: null`, so they fail the gate naturally. That's why this whole change can land without touching access-gating sites.

**Profile dashboard `activePlans` count was tightened** to `paymentStatus: "verified"` (in addition to `status: true`) so a freshly-created pending sub doesn't bump the badge before payment lands.

### Why a separate endpoint instead of a `purpose` field

See "Why one endpoint per purchase type" at the top. Concretely for course:
- request body is different (`{ packageId }` vs nothing for book cart)
- pre-checks are different (plan active + course active + double-buy guard)
- local row is different (`PackageCourseSubscription`)
- success response includes course/plan info the app shows on the success screen

Mashing both into one handler would mean a `switch` over a `purpose` discriminator with nothing structural in common except the Razorpay call — and the Razorpay call is already shared via the helper.

---

---

## 3) Verify — `POST /api/v1/client/payment/verify`

Called by the app **after** Razorpay's checkout SDK fires its success callback. Verifies the signature is genuine, then performs the actual fulfillment (mark order paid, grant access, clear cart). One endpoint handles both book and course payments — it dispatches by which local row owns the `razorpay_order_id`.

### Auth

Required (`Authorization: Bearer <customerAccessToken>`).

### Request body

```json
{
  "razorpay_order_id":   "order_OQ7...",
  "razorpay_payment_id": "pay_OQ8...",
  "razorpay_signature":  "9b...hex"
}
```

These three values come **straight from Razorpay's success callback** on the mobile SDK. Don't transform them; pass through.

### Successful response (`200`)

For a book payment:
```json
{
  "success": true,
  "data": {
    "kind": "book",
    "order": { "_id": "...", "status": "verified", "razorpayPaymentId": "pay_OQ8...", "paidAt": "2026-05-08T...", "...": "..." }
  }
}
```

For a course payment:
```json
{
  "success": true,
  "data": {
    "kind": "course",
    "subscription": { "_id": "...", "paymentStatus": "verified", "startAt": "...", "endAt": "...", "...": "..." }
  }
}
```

### Error responses

| Status | When                                                                                  |
|--------|---------------------------------------------------------------------------------------|
| `400`  | Body fields missing/malformed; **signature verification failed** (forged/replayed).   |
| `401`  | Missing/invalid bearer token.                                                         |
| `404`  | No local order or subscription owns this `razorpay_order_id` for this user.           |

### Server behaviour, in order

1. Parse body. 400 on validation failure.
2. **HMAC-verify** the signature: `expected = HMAC-SHA256(key_secret, "${order_id}|${payment_id}").hex`. Constant-time compare against `razorpay_signature`. Mismatch → 400. **This is the only thing standing between us and a forged "I paid" claim — never skip.**
3. Look up the local row by `razorpayOrderId` in **both** `BookOrder` and `PackageCourseSubscription`, scoped to this `customerId`.
4. **Idempotency short-circuit.** If the row is already non-pending (verified / shipped / etc.), return 200 with `message: "Already verified."` and skip side effects. The webhook (when it ships) shares this short-circuit so the app and Razorpay's server-to-server callback can race safely.
5. **Book branch:** flip `status: PENDING → VERIFIED`, set `razorpayPaymentId`, set `paidAt = now`, save. Then deactivate the cart row that pointed at this order's `shippingId` (`status: false`) so the user starts a fresh cart for their next purchase.
6. **Course branch:** look up the `PackageCourseEbookPrice` for `duration`, set `paymentStatus: "verified"`, `razorpayPaymentId`, `paidAt = now`, `startAt = now`, `endAt = now + duration days`, save. After this, the access gate in `lecture.controller` will pass and the user can play their course.

### `plan.duration` is treated as **days**

The course endpoint computes `endAt = now + duration * 86400000 ms`. If `duration` on `PackageCourseEbookPrice` is actually months (or weeks), change the multiplier in [verify.controller.ts](../src/client/payment/verify.controller.ts) — only one call site to update.

### Idempotency notes

- Calling `/verify` twice for the same order returns 200 both times. The second call is a no-op (short-circuited by `status !== PENDING` / `paymentStatus !== "pending"`).
- A future webhook (`POST /webhook/razorpay`) will use the **same fulfillment branches**, sharing the idempotency check. Either one running first is fine; whichever wins flips the status, the loser short-circuits.
- The cart-deactivation step is idempotent on its own — `updateOne` on an already-inactive cart is a no-op.

### Mobile flow (full picture)

```
1. POST /payment/create-order            → returns razorpay.orderId, keyId, amount
2. open Razorpay SDK with those values   → user pays
3. SDK success callback fires with:
        razorpay_order_id, razorpay_payment_id, razorpay_signature
4. POST /payment/verify with those three → server flips order to VERIFIED
5. App navigates to "Order Placed" screen
```

Step 4 is what makes the order appear in **Purchase History** ([PURCHASE_HISTORY_CLIENT.md](PURCHASE_HISTORY_CLIENT.md)) — the Books tab filters by `status` ∈ `verified|shipped|delivered`, so PENDING orders are invisible until verify runs.

### Existing pending orders

If you have orders that paid through Razorpay before this endpoint shipped, they're stuck at `status: "pending"` forever. Two ways to repair:

- **Re-run via Razorpay dashboard:** find the payment, copy the `order_id` / `payment_id` / `signature`, manually POST `/verify` with them. Cleanest — exercises the same code path real traffic uses.
- **Direct DB patch (one-time):** `db.bookorders.updateOne({ _id: ObjectId("...") }, { $set: { status: "verified", paidAt: ISODate(), razorpayPaymentId: "pay_…" } })`. Faster but bypasses signature verification, so only do it for orders you've already confirmed in Razorpay's dashboard.

---

## What's next (not in this PR)

1. **`POST /api/v1/client/webhook/razorpay`** — server-to-server webhook. Same fulfillment branches as `verify`, but used as a safety net when the app's success callback never reaches us (network drop after payment). Idempotent — shares the `status !== PENDING` short-circuit with `/verify`.
2. **Ebook plan create-order** — `POST /api/v1/client/payment/create-order/ebook` once that flow is needed. Same shape as the course endpoint, looks up `PackageCourseEbookPrice` where `ebookId` is set instead of `courseId`. The verify endpoint already has a place to add the third branch.
3. **Refunds and partial fulfillment** — only when needed.
