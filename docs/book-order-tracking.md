# Book Order — Shipment Tracking (Frontend Integration)

This document describes the API surface the frontend uses to render the **post-payment shipment tracking screen** for book orders.

---

## 1. Flow Overview

1. User completes Razorpay checkout for a book order.
2. Frontend calls the existing **verify payment** endpoint.
3. On success, navigate to the **Shipment Tracking** screen and call the new **tracking endpoint**.
4. The screen polls / refetches this endpoint to reflect status changes pushed by ops/admin.

All endpoints require `Authorization: Bearer <token>`.

---

## 2. Verify Payment (existing)

`POST /api/v1/client/payment/verify-payment`

Request body:

```json
{
  "razorpay_order_id": "order_NxxxxxxxxxxxxX",
  "razorpay_payment_id": "pay_NxxxxxxxxxxxxX",
  "razorpay_signature": "..."
}
```

Successful response for a book order:

```json
{
  "success": true,
  "data": {
    "kind": "book",
    "order": { "_id": "...", "receiptId": "...", "status": "verified", "...": "..." }
  }
}
```

> On verification, the backend automatically seeds the first tracking event (`"Order Placed"`), so the tracking screen is never empty.

Use `data.order._id` as the `orderId` for the tracking call below.

---

## 3. Get Order Tracking (NEW)

`GET /api/v1/client/book/orders/:id/tracking`

**Path params**
| Name | Type   | Description                  |
|------|--------|------------------------------|
| `id` | string | Book order `_id` (Mongo OID) |

**Response — 200**

```json
{
  "success": true,
  "data": {
    "orderId": "65f0c1a2e4b0f3a1b2c3d4e5",
    "receiptId": "SNKL-2026-000123",
    "awb": "118400642979",
    "courier": "mahavir",
    "trackingUrl": "https://.../track?awb=118400642979",
    "from": {
      "city": "GANDHINAGAR",
      "hub":  "KUDASAN"
    },
    "to": {
      "city":    "JAMNAGAR",
      "hub":     "TINBATTI, Plot 42",
      "pincode": "361001"
    },
    "consignee":      "RAVI KORIYA",
    "consigneePhone": "+91XXXXXXXXXX",
    "bookedAt":       "2025-12-12T14:11:00.000Z",
    "currentStatus":  "Delivered",
    "orderStatus":    "delivered",
    "shippedAt":      "2026-01-02T04:50:00.000Z",
    "deliveredAt":    "2026-01-05T04:50:00.000Z",
    "history": [
      { "status": "Order Placed", "location": null,                  "note": "Payment received", "at": "2025-12-12T14:11:00.000Z" },
      { "status": "Pick up",      "location": "Kudasan, Gandhinagar","note": null,               "at": "2026-01-01T04:50:00.000Z" },
      { "status": "Dispatched",   "location": "Kudasan, Gandhinagar","note": null,               "at": "2026-01-02T04:50:00.000Z" },
      { "status": "Arrived at",   "location": "Ahmedabad depo",      "note": null,               "at": "2026-01-03T04:50:00.000Z" },
      { "status": "Arrived at",   "location": "Jamnagar depo",       "note": null,               "at": "2026-01-04T04:50:00.000Z" },
      { "status": "Delivered",    "location": "TINBATTI",            "note": null,               "at": "2026-01-05T04:50:00.000Z" }
    ]
  }
}
```

**Error responses**

| Code | Body                                                       | Meaning                       |
|------|------------------------------------------------------------|-------------------------------|
| 400  | `{ success: false, message: "Invalid order id." }`         | `id` is not a Mongo ObjectId  |
| 401  | `{ success: false, message: "Unauthorized." }`             | Missing/invalid bearer token  |
| 404  | `{ success: false, message: "Order not found." }`          | Order not owned by this user  |
| 500  | `{ success: false, message: "..." }`                       | Unexpected server error       |

---

## 4. Field-by-Field UI Mapping

Refer to the design mock — three cards: **Shipment Summary**, **AWB**, **Tracking History**.

### Card 1 — Shipment Summary
| UI label    | JSON path                                        |
|-------------|--------------------------------------------------|
| From        | `from.city` + `from.hub` → `"GANDHINAGAR-KUDASAN"` |
| To          | `to.city` + `to.hub`     → `"JAMNAGAR- TINBATTI"`  |
| Consignee   | `consignee`                                      |
| Booked On   | `bookedAt` (format `DD/MM/YYYY at hh:mm A`)      |

### Card 2 — AWB
| UI label  | JSON path     | Notes                            |
|-----------|---------------|----------------------------------|
| AWB       | `awb`         | May be `null` until admin assigns courier — render placeholder like "Awaiting dispatch" |
| From city | `from.city`   |                                  |
| To city   | `to.city`     |                                  |

The copy-icon next to AWB should copy `awb`. If `trackingUrl` is non-null, link the AWB to it.

### Card 3 — Tracking History
Iterate `history` in the order returned (already sorted ascending by `at`).

Per row:
| UI element        | JSON path                |
|-------------------|--------------------------|
| Date (left col)   | `at` (format `DD MMM YY`) |
| Time (left col)   | `at` (format `hh:mm A`)   |
| Status (right)    | `status`                  |
| Sub-location text | `location` (hide row's location line if `null`) |

The last entry is the "current" event — render its dot filled / bold.

### Status pill (top of screen, optional)
Use `currentStatus` for the human-readable label and `orderStatus` for color logic:

| `orderStatus` | Color suggestion |
|---------------|------------------|
| `pending`     | gray             |
| `verified`    | blue             |
| `shipped`     | amber            |
| `delivered`   | green            |
| `cancelled`   | red              |
| `failed`      | red              |

---

## 5. Refresh Behavior

The backend does not push updates over websockets for tracking. Recommended frontend strategy:

- Refetch on screen focus.
- Optional pull-to-refresh.
- Optional polling every 60s while the screen is open **only if** `orderStatus` is not in `{"delivered","cancelled","failed"}`.

---

## 6. Related Order Endpoints (already exist)

| Method | Path                                            | Purpose                              |
|--------|-------------------------------------------------|--------------------------------------|
| GET    | `/api/v1/client/book/orders`                    | List my book orders                  |
| GET    | `/api/v1/client/book/orders/:id`                | Full order detail (items, totals)    |
| GET    | `/api/v1/client/book/orders/:id/invoice`        | Download invoice PDF                 |
| GET    | `/api/v1/client/book/orders/:id/tracking`       | **NEW** — shipment tracking view     |

---

## 7. Admin-Side Reference (for QA / ops awareness)

Frontend doesn't call these, but they drive the data shown on the tracking screen.

| Method | Path                                                    | What it does                                                |
|--------|---------------------------------------------------------|-------------------------------------------------------------|
| PATCH  | `/api/v1/admin/book/orders/:id/status`                  | Change order status + push a history entry                  |
| PATCH  | `/api/v1/admin/book/orders/:id/tracking`                | Assign AWB + courier, marks order as shipped                |
| POST   | `/api/v1/admin/book/orders/:id/tracking/events`         | Append an intermediate history event (e.g. "Arrived at...") |
| PUT    | `/api/v1/admin/book/settings`                           | Configure warehouse origin (`originCity`, `originHub`)      |

Body for **append event**:

```json
{
  "status":   "Arrived at",
  "location": "Ahmedabad depo",
  "note":     "optional",
  "at":       "2026-01-03T10:20:00+05:30"
}
```

---

## 8. Open Items / Not Yet Wired

- No courier-aggregator integration yet (Shiprocket/Delhivery/etc.). Until that's chosen, AWB and intermediate events are entered manually by admin/ops via the endpoints in §7.
- `trackingUrl` is computed from courier + AWB. If `awb` or `courier` is missing, it will be `null`.
- No websocket push for live status; use polling per §5.

### 8.1 Phase 2 — Courier Automation (once an aggregator is picked)

**Scenario:** Client picks an aggregator (e.g. Shiprocket). What happens next?

1. **Client provides credentials** — API key, secret, pickup address, webhook signing secret.
2. **Backend (1–2 days work):**
   - Add `src/libs/courier/<provider>.ts` wrapping the aggregator's REST API (`createShipment`, `getStatus`, `cancel`).
   - On payment verify, auto-call `createShipment(order)` and save `awb` + `courier` to the order. AWB now appears on the tracking screen instantly — no admin action needed.
   - Expose `POST /api/v1/webhooks/courier/:provider` — the aggregator POSTs every scan (pickup → in-transit → delivered); handler appends to `tracking.history` with real `location` strings and stamps `shippedAt` / `deliveredAt`.
   - Add a 30-min fallback cron to pull status for any in-flight order in case a webhook is dropped.
   - Add `COURIER_PROVIDER`, `COURIER_API_KEY`, `COURIER_WEBHOOK_SECRET` env vars.
3. **Frontend: no changes required.** The response shape in §3 stays identical — `history[]` just starts filling itself instead of being filled by admins.
4. **Admin endpoints in §7 remain** as a manual override for edge cases (lost parcels, courier API down, etc.).
