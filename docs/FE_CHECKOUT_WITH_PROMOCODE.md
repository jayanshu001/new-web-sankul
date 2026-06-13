# Frontend Guide — Applying a Promo Code at Checkout

**Audience:** FE engineers on the package / course / ebook payment screens.

## The one thing that's wrong right now

The FE currently sends:
```json
POST /api/v1/client/payment/create-order/package
{ "packageId": "6a1d172edde3e6309cbc7fbe" }
```

There is **no `promocode` in the body**, so the backend has nothing to apply and
charges full price. Razorpay shows the full amount because the order *was created*
at the full amount.

**The preview call (`/promocodes/apply`) does NOT redeem the discount.** It only
shows the user the discounted price. The actual discount is applied **only** when
you send the `promocode` to **create-order**. Preview ≠ redeem.

### ✅ The fix — send the code to create-order

```json
POST /api/v1/client/payment/create-order/package
{
  "packageId": "6a1d172edde3e6309cbc7fbe",
  "promocode": "WEBSANKUL70"
}
```

That's it. The backend re-validates the code server-side and returns a Razorpay
order for the **discounted** amount. Hand that amount/order straight to the
Razorpay SDK.

---

## Full checkout flow (3 steps)

### Step 1 — (optional) preview the discount

Only to *show* the user the new price before they commit. Skippable.

```http
POST /api/v1/client/promocodes/apply
{ "promocode": "WEBSANKUL70", "targetType": "package", "targetId": "<packageId>" }
```

Use the returned discounted prices for display. **Do not** treat this as
"applied" — you still must pass the code in Step 2.

### Step 2 — create the order WITH the promo code

```http
POST /api/v1/client/payment/create-order/package
{
  "packageId": "<plan _id>",          // PackageCourseEbookPrice._id (the plan, not the package)
  "promocode": "WEBSANKUL70",          // ← REQUIRED to get the discount
  "customerShippingId": "<addr _id>"   // optional, only for "With Materials" plans
}
```

**Response (`201`):**
```json
{
  "success": true,
  "data": {
    "subscriptionId": "65f...",
    "receiptId": "package-...",
    "razorpay": {
      "orderId": "order_Nx...",
      "keyId": "rzp_test_...",
      "amount": 45000,          // ← PAISE, already discounted (₹450, not ₹1500)
      "currency": "INR"
    },
    "amountInRupees": 450,       // charged amount (post-discount)
    "package": { "_id": "...", "name": "..." },
    "plan": { "_id": "...", "duration": 180, "price": 1500 },  // price = pre-discount MRP
    "promo": {                   // present only when a code was applied
      "promocodeId": "...",
      "originalAmount": 1500,
      "discountAmount": 1050,
      "finalAmount": 450
    }
  }
}
```

> **Drive the Razorpay SDK from `data.razorpay.amount`** (paise, discounted) and
> `data.razorpay.orderId` / `keyId`. Never recompute the amount on the FE — use
> exactly what create-order returns.

### Step 3 — verify after payment (unchanged)

```http
POST /api/v1/client/payment/verify
{
  "razorpay_order_id": "order_Nx...",
  "razorpay_payment_id": "pay_Nx...",
  "razorpay_signature": "<signature>"
}
```

---

## Same pattern for course and ebook

`promocode` is an **optional** field on all three create-order endpoints. Send it
whenever the user applied a code; omit it otherwise.

| Buying | Endpoint | Body |
|---|---|---|
| Package | `POST /payment/create-order/package` | `{ packageId, promocode?, customerShippingId? }` |
| Course | `POST /payment/create-order/course` | `{ packageId, promocode?, customerShippingId? }` |
| eBook | `POST /payment/create-order/ebook` | `{ planId, promocode? }` |

> Note: course & package use `packageId` (the **plan** `_id`); ebook uses
> `planId`. That naming is pre-existing — match the table.

**Live course / test series** use different endpoints that take `promocode` +
`planId` directly:
`POST /payment/create-order/live-course` and `/create-order/test-series`.

---

## Errors to handle (when a promo code is sent)

| Status | `message` | Cause | FE action |
|---|---|---|---|
| 400 | `Invalid or expired promo code.` | Code wrong / outside its date window / inactive. | Clear the code, show "invalid". |
| 400 | `This promo code is not valid for this item.` | Code exists but doesn't cover this package/course/ebook. | Tell the user it doesn't apply here. |
| 400 | `This promo code has no discount configured.` | Admin set 0 discount. | Treat as not applicable. |
| 400 | `This promo code reduces the price below the minimum payable amount...` | Discount drops total below ₹1. | Ask user to contact support / free-grant. |
| 400 | `errors: [...]` (zod) | `promocode` empty string or bad `packageId`. | Fix payload (omit `promocode` entirely if no code). |

If **no** promo code is sent, none of these fire — the order is created at full
price as before.

---

## Common mistakes (checklist)

- ❌ Calling `/promocodes/apply` and assuming the discount "sticks" → it doesn't.
  You MUST also send `promocode` to create-order.
- ❌ Sending `{ packageId }` with no `promocode` → full price (current bug).
- ❌ Recomputing/overriding the Razorpay amount on the FE → always use
  `data.razorpay.amount` from create-order.
- ❌ Putting the package id in the wrong field on the preview call → for
  `/promocodes/apply`, use `targetType` + `targetId` (the backend auto-detects
  the type, but send them correctly anyway).

---

## Backend reference

- `src/client/payment/package-payment.controller.ts` (`promocode` re-validated via
  `resolveLivePromo`).
- `docs/PROMOCODE_DISCOUNT_CLIENT.md` — the preview endpoint.
- `docs/PAYMENT_APIS_CLIENT.md` — full payment surface.
