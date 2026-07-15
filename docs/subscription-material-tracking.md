# Subscription Material — Shipment Tracking (Frontend Integration)

**Track Order for the Purchase History → Subscriptions tab.** When a user buys a
**package / recorded course** or a **live course** on a **with-material** plan, a
physical study-material kit ships. Those orders now expose the *same* tracking surface
the **Books** tab already uses — this is the subscription-side mirror of
`docs/book-order-tracking.md`, so the app can reuse the existing `BookOrderTrackScreen`.

**Base URL:** `/api/v1/client` · **Auth:** `Authorization: Bearer <token>` on every call.

> **No FE change blocks the backend.** The payloads below already exist. This doc is the
> FE wiring guide.

---

## TL;DR — what the FE does

1. In `PurchaseHistory.tsx`, the Subscriptions list rows now carry `withMaterial`,
   `status`, and `tracking`. Map `trackingId` for **all** tabs (you likely already do):
   ```ts
   trackingId: item.tracking?.trackingId ?? null
   ```
2. **Extend the Track Order button** from Books-only to also cover Subscriptions:
   ```ts
   // before — Books only
   selectedTab === 'Books' && !!item.trackingId
   // after — Books OR Subscriptions with an allocated AWB
   (selectedTab === 'Books' || selectedTab === 'Subscriptions') && !!item.trackingId
   ```
   `tracking` is `null` (so `trackingId` is null) for without-material purchases → the
   button stays hidden automatically. No `withMaterial` check needed for the button.
3. Optionally show `Status: {item.status}` on Subscriptions material rows (same as Books).
4. On tap, open `BookOrderTrackScreen` (add a `source` flag) and call the **subscriptions**
   tracking endpoints with the row's `_id` (pass it verbatim — it may be `lc_`-prefixed).

---

## 1. List — `GET client/purchase-history/subscriptions`

Each subscription row gained three fields:

| Field | Type | Meaning |
|---|---|---|
| `withMaterial` | boolean | Purchase includes a physical kit. Package/course = the plan was with-material (detected via the payment split, not `pc_material_id`); live = `withMaterial` sent at checkout. Test series always `false`. |
| `status` | string \| null | Shipment status for material orders (currently `"pending"`); `null` for without-material. Render as `Status: …` like Books. |
| `tracking` | object \| null | `null` until an AWB is allocated. When present: `{ "trackingId": "842", "courier": "tirupati" \| "mahavir" }`. |

**Gate the button on `tracking?.trackingId`** — identical rule to Books.

> **Each purchase is its own row — including validity extensions.** Buying a
> course/package/test-series again to extend validity now returns a **separate** history
> row with its own `amount` + `purchasedAt` (previously an extension folded into the
> existing row and just increased its price). Entitlement/access is unchanged — only the
> history list now shows every transaction. A **with-material extension ships a new kit**,
> so its row gets its **own fresh `tracking.trackingId`** (a distinct shipment from the
> original purchase).

Example row (live course, with material, dispatched):

```json
{
  "_id": "lc_842",
  "kind": "live-course",
  "title": "GPSC Class 1-2 Full Package",
  "badge": "Live",
  "amount": 14999,
  "purchasedAt": "2026-07-10T10:00:00.000Z",
  "withMaterial": true,
  "status": "pending",
  "tracking": { "trackingId": "842", "courier": "mahavir" }
}
```

Without-material row → `"withMaterial": false, "status": null, "tracking": null`.

**`_id` prefixes** — pass `_id` **verbatim** into the receipt/tracking calls; the backend
routes by prefix, so the FE just forwards it (the same `_id` already drives the receipt
endpoint):

| `_id` shape | Source | Trackable? |
|---|---|---|
| `842` (plain number) | package/course **purchase order** | yes (if material) |
| `lc_842` | live-course subscription | yes (if material) |
| `ts_842` | test-series **purchase order** | no |
| `pcs_842` | legacy package/course sub (pre-migration, no order) | yes (if material) |
| `tss_842` | legacy test-series sub (pre-migration, no order) | no |

---

## 2. Detail — `GET client/purchase-history/subscriptions/:id/tracking`

`:id` = the row `_id` from §1 (with its prefix). **Identical shape to the Books tracking
endpoint** → reuse `BookOrderTrackScreen`, just point the fetch at this URL when
`source === 'subscription'`.

```json
{
  "success": true,
  "data": {
    "orderId": "842",
    "receiptId": "842",
    "awb": 842,
    "courier": "mahavir",
    "trackingUrl": "http://shreemahavircourier.com/Frm_DocTrack.aspx?Tmp=...&docno=842",
    "from": { "city": null, "hub": null },
    "to": { "city": "Ahmedabad", "hub": "12 MG Road", "pincode": "380001" },
    "consignee": "Asha Patel",
    "consigneePhone": "9876543210",
    "bookedAt": "2026-07-10T10:00:00.000Z",
    "currentStatus": "pending",
    "orderStatus": "verified",
    "shippedAt": null,
    "deliveredAt": null,
    "history": [
      { "status": "pending", "location": null, "note": null, "at": "2026-07-10T10:00:00.000Z" }
    ]
  }
}
```

Field mapping is exactly `docs/book-order-tracking.md` §4 (Shipment Summary / AWB /
Tracking History cards). Notes:
- `from` is always `null` (no stored warehouse origin — same as Books). Render your usual
  origin placeholder.
- `to` / `consignee` / `consigneePhone` come from the delivery address chosen at checkout.
  **May be `null` for legacy orders** placed before with-material address collection —
  render placeholders, don't assume non-null.
- `history` is a single synthesized entry from the current shipment status (same as Books
  on this backend). The last entry is the "current" event.

**Errors**

| Code | Body `message` | Meaning |
|------|----------------|---------|
| 401  | `Unauthorized.` | Missing/invalid token |
| 404  | `Tracking not available for this order.` | Not the customer's order, or a without-material subscription → keep the button hidden |
| 500  | `…` | Unexpected server error |

## 3. Live courier scrape — `GET .../subscriptions/:id/tracking/live`

Mirrors the Books live path. Only Tirupati-range AWBs have a live API. The AWBs allocated
today are below that threshold, so this returns **`422`** with the static `trackingUrl` —
**fall back to the stored `history`** from §2 (same behavior your Books screen already has):

```json
{
  "success": false,
  "message": "Live tracking is not available for this carrier. Use trackingUrl instead.",
  "data": { "trackingUrl": "http://.../Frm_DocTrack.aspx?..." }
}
```

| Code | Meaning |
|------|---------|
| 200  | Live AWB scan data in `data` (Tirupati only) |
| 422  | Carrier has no live API → use `data.trackingUrl`, render stored `history` |
| 404  | Not owned / no AWB yet |
| 409  | (Books only) order not yet verified — N/A here (list returns verified subs only) |

**Refresh strategy** (same as Books, `docs/book-order-tracking.md` §5): refetch on focus;
optional pull-to-refresh; optional 60s polling while `orderStatus` ∉
`{delivered, cancelled, failed}`.

---

## 4. Suggested FE wiring (concrete)

`src/screens/app/profile/PurchaseHistory.tsx`:

```ts
// row → track button (Books + Subscriptions)
const canTrack =
  (selectedTab === 'Books' || selectedTab === 'Subscriptions') && !!item.trackingId;

// on tap
navigation.navigate('BookOrderTrack', {
  orderId: item._id,                 // pass verbatim (may be "lc_…")
  source: selectedTab === 'Books' ? 'book' : 'subscription',
});
```

`BookOrderTrackScreen` — choose the endpoint by `source`:

```ts
const base =
  source === 'subscription'
    ? `client/purchase-history/subscriptions/${orderId}`
    : `client/book/orders/${orderId}`;

GET `${base}/tracking`        // summary + history (same response shape)
GET `${base}/tracking/live`   // live scrape; on 422 use data.trackingUrl + stored history
```

Everything downstream (card rendering, AWB copy, `trackingUrl` link, history timeline)
is unchanged — the response contract is byte-for-byte the Books shape.

---

## 5. Lifecycle (why `status` stays `pending` for now)

1. Checkout with a with-material plan collects a delivery address (`customerShippingId`,
   see `docs/FE_WITH_MATERIALS_DELIVERY_ADDRESS.md`).
2. Payment verify → the shipment AWB + `status: "pending"` are allocated automatically
   (mirrors how SQL book orders auto-assign at verify). `tracking.trackingId` appears
   right after purchase.
3. Advancing status (packed / shipped / delivered) and real courier AWBs need an admin
   dispatch flow that doesn't exist on the SQL backend yet — the Books admin
   bind/status/event endpoints are likewise stubbed (501) on MySQL. Until that lands,
   `status`/`currentStatus` stay `pending` and `list.status` === detail `currentStatus`.

## References
- `docs/book-order-tracking.md` — the Books tracking contract this mirrors 1:1.
- `docs/FE_WITH_MATERIALS_DELIVERY_ADDRESS.md` — with-material checkout + address.
- `docs/MY_SUBSCRIPTIONS_CLIENT.md` — the base subscriptions list contract.
