# Extend Validity — Client (App) Integration Guide

How the React Native app should handle **re-purchasing / extending** a
subscription the customer **already owns**, for: **course, package, live-course,
ebook, test-series**.

Backend is **complete** — this doc covers only the **behavior change** the
frontend must react to. There are **no new endpoints** and **no payload changes**;
"Extend Validity" uses the *exact same* create-order → Razorpay → verify flow as a
first-time purchase.

---

## TL;DR for the frontend dev

1. **The `409` is gone.** Re-buying an active plan no longer returns
   `409 "You already have an active subscription…"`. Remove any UI branch that
   treated that 409 as "already owned / cannot buy again."
2. **Extend = normal purchase.** Call the same `create-order/*` endpoint, run the
   same Razorpay checkout, call the same `POST /payment/verify`. No `isExtend`
   flag, no separate route.
3. **`daysLeft` is _added_, not reset.** Buying a 30-day plan when 5 days remain
   results in **35 days**, not 30. After verify, **re-fetch** the entity (or its
   listing) and show the new `daysLeft` / `subscriptionEndAt`.
4. There is **never a duplicate subscription** — the backend folds the new window
   onto the existing one, so "My Subscriptions" still shows a single card.

If your purchase flow already works for first-time buys, **extend already works** —
you mainly need to (a) delete the dead 409 handling and (b) refresh `daysLeft`
after verify.

---

## Auth

Every endpoint requires the customer **Bearer token** (same as all client APIs).

```
Authorization: Bearer <accessToken>
```

---

## The flow (identical for first-buy and extend)

```
POST /api/v1/client/payment/create-order/<module>   → { razorpay, subscriptionId|ebookOrderId, … }
        ↓  open Razorpay checkout with the returned order
POST /api/v1/client/payment/verify                  → { success: true, data: { kind, … } }
        ↓
Re-fetch the entity / listing → show updated daysLeft
```

### create-order — endpoint + body per module

| Module       | Endpoint                                          | Body                                          |
| ------------ | ------------------------------------------------- | --------------------------------------------- |
| Course       | `POST /api/v1/client/payment/create-order/course`       | `{ "packageId": "<plan _id>" }`         |
| Package      | `POST /api/v1/client/payment/create-order/package`      | `{ "packageId": "<plan _id>" }`         |
| Live-course  | `POST /api/v1/client/payment/create-order/live-course`  | `{ "planId": "<plan _id>", "promocode?": "" }` |
| Ebook        | `POST /api/v1/client/payment/create-order/ebook`        | `{ "planId": "<plan _id>" }`            |
| Test-series  | `POST /api/v1/client/payment/create-order/test-series`  | `{ "planId": "<plan _id>", "promocode?": "" }` |

> The id field is the **price/plan row** `_id` (the specific duration the user
> picked), not the course/ebook id. Same as today's first-purchase flow.

### verify

```
POST /api/v1/client/payment/verify
{
  "razorpay_order_id":   "...",
  "razorpay_payment_id": "...",
  "razorpay_signature":  "..."
}
```

On success: `{ "success": true, "data": { "kind": "course" | "package" | "live-course" | "ebook" | "test-series", ... } }`

Whether this was a first purchase or an extend is **transparent** to the client —
the response shape is the same. The backend decides:
- **No active sub** → creates the subscription (first purchase).
- **Active sub exists** → extends its `endAt` (stacks the duration) and folds in
  the amount paid. No second row is created.

---

## What to change in the app

- **Remove** the `409` "already subscribed" handling on all five modules. It will
  not fire anymore. If your code disabled/hid the buy button when a sub was
  active, change it to an **"Extend Validity"** button instead.
- **After `verify` succeeds**, re-fetch so the new validity shows everywhere:
  - detail screen (`daysLeft`, `subscriptionEndAt`)
  - "My Subscriptions" / purchase history
  - dashboard cards (`daysLeft` on package/course/ebook/live-course rows)
  - search results
  All of these read `daysLeft` live from the subscription, so a refresh is enough —
  no client-side recompute needed.
- **Copy:** for an extend, prefer wording like *"Added to your existing validity"*
  rather than *"Valid for N days"*, since the total now includes remaining time.

---

## Edge cases / FAQ

- **Q: Is there a separate "extend" endpoint or an `isExtend` flag?**
  No. Same create-order + verify as a first purchase.
- **Q: Could the user end up with two subscriptions / two cards?**
  No. The active row is extended in place; for course/package the superseded
  pending row is retired (`status:false`) and never lists.
- **Q: Does extend reset the timer to the new plan length?**
  No — it **stacks**. 5 days left + a 30-day plan = 35 days.
- **Q: Lifetime subscriptions (no expiry)?**
  Stay lifetime — `daysLeft` remains `null`; extending does not add a finite date.
- **Q: Free plans?**
  Unchanged — zero-price plans still use the free-grant flow, not create-order.
- **Q: Days vs months.** Ebook & test-series plan durations are **days**; course,
  package & live-course are **months**. This is handled server-side — the client
  doesn't compute it.
