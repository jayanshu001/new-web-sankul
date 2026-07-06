# Frontend Guide — "With Materials" Delivery Address at Checkout

**Audience:** mobile/web FE engineers integrating the Course / Package / Live
Course payment screens.

**What changed:** the three create-order endpoints now accept an **optional**
delivery address (`customerShippingId`). This is the backend support for the
`CoursePayment` / `LiveCoursePayment` "With Materials" tab — when a buyer picks a
*With Materials* plan, collect a delivery address and pass its id to create-order.

**Base URL:** `/api/v1/client`
**Auth:** `Authorization: Bearer <token>` on every endpoint below.

---

## TL;DR for the FE

1. Detect a **With Materials** plan: the plan row has `withMaterial: true`
   (course/package plans). For live courses there's no plan flag — the FE's
   With/Without tab decides, so you send `withMaterial: true` yourself.
2. If With Materials, make the user pick/create a delivery address **before**
   checkout (FE-enforced — see "Who enforces what").
3. Pass the chosen address as `customerShippingId` (a `CustomerAddress._id`) in
   the create-order body. For live courses also pass `withMaterial: true`.
4. Without Materials → send nothing extra; behaves exactly as before.

---

## Step 1 — Get / create a delivery address

The `customerShippingId` you send must be a `CustomerAddress` the logged-in
customer owns. Use the existing address module:

| Action | Method | Endpoint |
|---|---|---|
| List my addresses | GET | `client/address` |
| Get one address | GET | `client/address/:id` |
| Create address | POST | `client/address` |
| Update address | PUT | `client/address/:id` |
| Set default | PATCH | `client/address/:id/default` |
| Delete | DELETE | `client/address/:id` |

A `CustomerAddress` looks like:

```json
{
  "_id": "65f0aa...",
  "name": "Asha Patel",
  "phone": "9876543210",
  "address": "12 MG Road",
  "address2": "Near City Mall",
  "cityId": "65e...",
  "stateId": "65e...",
  "pincode": "380001",
  "label": "home",
  "isDefault": true
}
```

Use the `_id` as `customerShippingId`.

---

## Step 2 — Create the order (with the address)

### Course

`POST client/payment/create-order/course`

```json
{
  "packageId": "<PackageCourseEbookPrice._id>",
  "customerShippingId": "<CustomerAddress._id>"   // optional
}
```

### Package

`POST client/payment/create-order/package`

```json
{
  "packageId": "<PackageCourseEbookPrice._id>",
  "customerShippingId": "<CustomerAddress._id>"   // optional
}
```

> `packageId` is the **selected plan's** `_id` (a `PackageCourseEbookPrice._id`),
> NOT the course/package id. The plan row is the source of truth for price and
> for `withMaterial` — the backend stamps `withMaterial` onto the subscription
> from the plan automatically, so you don't send it for course/package.

### Live Course

`POST client/payment/create-order/live-course`

```json
{
  "planId": "<LiveCoursePlan._id>",
  "promocode": "SAVE10",            // optional
  "withMaterial": true,             // optional — FE-driven (no plan flag)
  "customerShippingId": "<CustomerAddress._id>"  // optional
}
```

> Live-course plans have no `withMaterial` field, so the FE sends
> `withMaterial: true` when the user is on the With Materials tab.

### Success — `201 Created`

Same shape as before (the address doesn't change the response). Example (course):

```json
{
  "success": true,
  "data": {
    "subscriptionId": "65f...",
    "receiptId": "course-1715424000000-ab12cd",
    "razorpay": {
      "orderId": "order_Nx...",
      "keyId": "rzp_test_...",
      "amount": 49900,
      "currency": "INR"
    },
    "amountInRupees": 499,
    "course": { "_id": "65f...", "name": "..." },
    "plan": { "_id": "65f...", "duration": 180, "price": 499 }
  }
}
```

Hand `razorpay.orderId` + `keyId` + `amount` to the Razorpay SDK as usual, then
call `/verify`.

---

## Step 3 — Verify (unchanged)

`POST client/payment/verify`

```json
{
  "razorpay_order_id": "order_Nx...",
  "razorpay_payment_id": "pay_Nx...",
  "razorpay_signature": "<signature>"
}
```

After success the app fires
`DeviceEventEmitter.emit(PAYMENT_SUCCESS_REFRESH, { type, id })` to refresh
screens.

---

## Errors to handle

| Status | Body `message` | Cause | FE action |
|---|---|---|---|
| 400 | `Delivery address does not belong to this customer.` | `customerShippingId` isn't an address this customer owns (wrong id, or address deleted). | Re-fetch addresses, re-select, retry. |
| 400 | `errors: [...]` (zod) | `customerShippingId` not a 24-hex id, or bad body. | Fix the payload. |
| 404 | `Plan not found or inactive.` | Bad/expired plan id. | Reload plans. |
| 400 | `Plan amount is zero — use the free-grant flow instead.` | Plan price is 0. | Don't checkout; handle as free grant. |
| 401 | `Unauthorized.` | Missing/expired token. | Re-auth. |

---

## Who enforces what

- **FE enforces** the rule *"a delivery address is required when a With Materials
  plan is selected."* The API keeps `customerShippingId` **optional** — it does
  not reject a With-Materials order that omits the address. So block the
  checkout button on the FE until an address is chosen.
- **Backend enforces** that *if* an address is sent, it belongs to the customer
  (the only server-side address rule on these endpoints).
- The backend records `withMaterial` + `customerShippingId` on the subscription
  for fulfillment/admin.

> If we later decide the server should also hard-require the address for
> With-Materials orders, that's a one-line backend change — coordinate before
> relying on it.

---

## Open item (not in scope of this change)

`materialPrice` on a With-Materials plan is **not** currently added to the
charged amount — create-order charges `plan.price` only. If With-Materials is
meant to cost more, that's a separate backend change. Don't assume the FE-shown
"with materials" total matches what's charged until that's implemented.

---

## Related backend docs

- `docs/PAYMENT_APIS_CLIENT.md` — endpoint reference + backend behaviour.
- `docs/CREATE_ORDER_CLIENT.md` — full create-order response shapes per type.
- `docs/MIGRATION_QUERY_CHANGES.md` (2026-06-13 entry) — schema/query change log.
