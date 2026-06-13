# Payment APIs (Client)

Frontend-facing reference for the Razorpay checkout flows, plus the backend
support for **With Materials** plans (delivery address capture).

All routes are under `POST /api/v1/client/payment/...` and require a Bearer token
(`router.use(authenticate)` in `payment.routes.ts`).

---

## Course / Package

Screen: `CoursePayment`
Trigger: `isPackage` route param decides which create-order endpoint is called.
UI: Has a **With Materials / Without Materials** tab that splits plans into two groups.

When a **With Materials** plan is selected, the buyer should provide a delivery
address before checkout. The address is passed to create-order as
`customerShippingId` (a `CustomerAddress._id`). It is **optional** at the API
level — the FE enforces the "address required" rule; the backend validates the
address belongs to the customer only when one is sent. See
[Delivery address (With Materials)](#delivery-address-with-materials) below.

| Step | Method | Endpoint | Body |
|------|--------|----------|------|
| Load promo codes | GET | `client/promocodes?page=1&limit=20` | — |
| Apply promo code | POST | `client/promocodes/apply` | `{ code, planId }` |
| Create order (package) | POST | `client/payment/create-order/package` | `{ packageId, customerShippingId? }` |
| Create order (course) | POST | `client/payment/create-order/course` | `{ packageId, customerShippingId? }` |
| Verify payment | POST | `client/payment/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` |

`packageId` is the selected **plan's** `_id` (a `PackageCourseEbookPrice._id`),
not the course/package id — the plan row is the source of truth for price and for
the `withMaterial` flag. The backend stamps `withMaterial` onto the subscription
from the chosen plan automatically.

---

## Live Course

Screen: `LiveCoursePayment`
UI: Has a **With Materials / Without Materials** tab that splits plans into two groups.

Live-course plans (`LiveCoursePlan`) currently carry **no** `withMaterial` flag,
so for live courses the materials intent is passed on the request as
`withMaterial: true` alongside the optional `customerShippingId`. Both are
optional and backward-compatible.

| Step | Method | Endpoint | Body |
|------|--------|----------|------|
| Fetch course details | GET | `client/live-courses/:id` | — |
| Apply promo | POST | `client/payment/apply-promo/live-course` | `{ code, liveCourseId, planId }` |
| Create order | POST | `client/payment/create-order/live-course` | `{ planId, promocode?, withMaterial?, customerShippingId? }` |
| Verify payment | POST | `client/payment/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` |

---

## Delivery address (With Materials)

`customerShippingId` is **optional** on all three create-order endpoints. Behaviour:

- **Not sent** → order is created exactly as before (no change for existing
  callers). The subscription stores `customerShippingId: null`.
- **Sent** → must be a `CustomerAddress` owned by the authenticated customer. If
  it isn't, the request is rejected:
  `400 { success: false, message: "Delivery address does not belong to this customer." }`

The chosen address is persisted on the resulting subscription as
`customerShippingId`, and `withMaterial` is recorded on the subscription too —
so fulfillment/admin can see which orders ship material and where. This mirrors
the existing **admin** create-subscription flow
(`src/admin/subscription/subscription.controller.ts`), which already validates
`customerShippingId` against `CustomerAddress` and requires it when
`withMaterial` is true.

> Note: the admin flow *requires* an address for With-Materials orders; the
> client create-order endpoints keep it optional at the API level (FE-enforced)
> for backward compatibility. If server-side enforcement is desired later,
> reject a `withMaterial` order with no `customerShippingId`.

---

## Notes

- All flows share the same `POST client/payment/verify` for Razorpay callback
  verification, which dispatches fulfillment based on which local row holds the
  `razorpay_order_id`.
- `createPackageOrderAPI` and `createCourseOrderAPI` both accept `packageId`
  (the selected plan's `_id`).
- After successful verification the app fires
  `DeviceEventEmitter.emit(PAYMENT_SUCCESS_REFRESH, { type, id })` to refresh the
  relevant screens.
