# Frontend Guide — Promo Code + Order, End to End (All Modules)

**Audience:** FE engineers wiring checkout across every purchasable product.
**Goal:** one clear map of *which endpoint to call when*, so applying a promo and
placing an order works the same way in every module.

**Base:** `/api/v1/client` · **Auth:** `Authorization: Bearer <token>` on all.

---

## The golden rule

> **Preview ≠ Redeem.**
> The "apply promo" endpoints only *show* the discounted price. The discount is
> actually applied **only** when you pass `promocode` to **create-order**.
> Always drive Razorpay from the `amount` that **create-order** returns — never
> recompute it on the FE.

Every module follows the same 3 beats:

1. **(optional) Preview** the discount → show the user the new price.
2. **Create order** WITH `promocode` → returns a Razorpay order at the
   **discounted** amount.
3. **Verify** after payment → provisions access.

---

## Module map — which endpoints per product

| Module | Preview promo | Create order | Order body |
|---|---|---|---|
| **Package** | `POST /promocodes/apply` | `POST /payment/create-order/package` | `{ packageId, promocode?, customerShippingId? }` |
| **Course** | `POST /promocodes/apply` | `POST /payment/create-order/course` | `{ packageId, promocode?, customerShippingId? }` |
| **eBook** | `POST /promocodes/apply` | `POST /payment/create-order/ebook` | `{ planId, promocode? }` |
| **Live Course** | `POST /payment/apply-promo/live-course` | `POST /payment/create-order/live-course` | `{ planId, promocode? }` |
| **Test Series** | `POST /payment/apply-promo/test-series` | `POST /payment/create-order/test-series` | `{ planId, promocode? }` |
| **Books (cart)** | — (no promo) | `POST /payment/create-order` | (no body — uses active cart) |
| **Verify (ALL)** | — | `POST /payment/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` |

### Two important id/field quirks (don't trip on these)

- **Course & Package** send the **plan** id in a field literally named
  `packageId` (it's a `PackageCourseEbookPrice._id`, NOT the course/package id).
  Pre-existing naming — match the table.
- **eBook, Live Course, Test Series** send the plan id in `planId`.
- **`customerShippingId`** (a delivery address) applies only to package/course
  "With Materials" plans, and is optional.

---

## Which preview endpoint for which type

There are **two** preview systems. Use the right one or you'll get a confusing error.

### A) `POST /promocodes/apply` — package / course / ebook

Unified, self-describing body. The backend **auto-detects** the entity type from
the id, so the field name doesn't even have to be right — but send it correctly:

```json
{ "promocode": "WEBSANKUL70", "targetType": "package", "targetId": "<packageId>" }
```
`targetType`: `"package" | "course" | "ebook"`.

> If you send `targetType: "liveCourse"` or `"testSeries"` here, you get a `400`
> telling you to use their dedicated endpoint (below). That's expected.

### B) Dedicated previews — live course / test series

These are plan-based and live under `/payment/`:

```json
POST /payment/apply-promo/live-course   { "promocode": "X", "planId": "<LiveCoursePlan._id>" }
POST /payment/apply-promo/test-series   { "promocode": "X", "planId": "<TestSeriesPrice._id>" }
```

Both return the discounted price breakdown for display only.

---

## Step-by-step (worked example: Package)

### 1. Preview (optional — for UI display)
```http
POST /api/v1/client/promocodes/apply
{ "promocode": "WEBSANKUL70", "targetType": "package", "targetId": "<packageId>" }
```
Show the discounted plan prices. **Do not** treat the code as "applied" yet.

### 2. Create order WITH the code  ← this is where the discount actually happens
```http
POST /api/v1/client/payment/create-order/package
{ "packageId": "<plan _id>", "promocode": "WEBSANKUL70" }
```
Response (`201`):
```json
{
  "success": true,
  "data": {
    "subscriptionId": "...",
    "razorpay": { "orderId": "order_...", "keyId": "rzp_...", "amount": 45000, "currency": "INR" },
    "amountInRupees": 450,
    "plan": { "_id": "...", "duration": 180, "price": 1500 },
    "promo": { "promocodeId": "...", "originalAmount": 1500, "discountAmount": 1050, "finalAmount": 450 }
  }
}
```
- `razorpay.amount` is **paise, already discounted** → hand straight to the SDK.
- `plan.price` is the pre-discount MRP (for strikethrough display).
- `promo` is present only when a code was applied.

### 3. Verify after payment
```http
POST /api/v1/client/payment/verify
{ "razorpay_order_id": "order_...", "razorpay_payment_id": "pay_...", "razorpay_signature": "..." }
```
On success the app emits `PAYMENT_SUCCESS_REFRESH` to refresh screens.

**Every other module is identical** — only the create-order URL and the plan-id
field name change (see the module map).

---

## Will my promo even apply to this product?

A promo only discounts a product if the **admin attached it** to that product
(`appliesTo`). Promos can now target: **package, course, ebook, liveCourse,
testSeries** (all five). If a code is valid but not attached to the item, the
preview/create-order returns *"not valid for this item"* — that's correct, not a
bug; the code simply doesn't cover that product.

---

## Error handling (when a promo code is sent to create-order)

| Status | message | Meaning |
|---|---|---|
| 400 | `Invalid or expired promo code.` | Wrong code / outside date window / inactive. |
| 400 | `This promo code is not valid for this item.` | Valid code, but not attached to this product. |
| 400 | `This promo code has no discount configured.` | Admin set 0 discount. |
| 400 | `This promo code reduces the price below the minimum payable amount...` | Discount drops total < ₹1. |
| 401 | `Unauthorized.` | Missing/expired token. |

If **no** `promocode` is sent, none of these fire — the order is created at full
price (this is the current "discount not applying" symptom: the FE simply isn't
sending the code to create-order).

---

## FE checklist per checkout

- [ ] Pick the **correct preview endpoint** for the product type (A vs B above).
- [ ] On "Pay", call **create-order** with `promocode` included if the user
      applied one.
- [ ] Read `data.razorpay.{orderId,keyId,amount,currency}` and launch the SDK
      with that **exact amount** (paise, already discounted).
- [ ] After SDK success, call `/payment/verify` with the 3 razorpay fields.
- [ ] Use `data.promo` (when present) to show the discount breakdown on the
      confirmation screen.
- [ ] Never send a plan id in the wrong field (see the id/field quirks).

---

## Common failures → cause

| Symptom | Cause |
|---|---|
| Razorpay shows full price after applying a code | `promocode` not sent to create-order (only previewed). |
| "not applicable for this item" | Plan id sent in the wrong field, or id is a plan id where an entity id was expected (`/promocodes/apply` auto-detects, but send correctly). |
| "not valid for this item" | Promo not attached to this product by admin. |
| liveCourse/testSeries preview returns a redirect 400 | Used `/promocodes/apply` instead of the dedicated `/payment/apply-promo/*`. |

---

## Backend references

- `docs/FE_CHECKOUT_WITH_PROMOCODE.md` — deep dive on the create-order promo field.
- `docs/PROMOCODE_DISCOUNT_CLIENT.md` — the `/promocodes/apply` preview.
- `docs/PAYMENT_APIS_CLIENT.md` — full payment surface.
- `docs/FE_WITH_MATERIALS_DELIVERY_ADDRESS.md` — `customerShippingId` for materials.
