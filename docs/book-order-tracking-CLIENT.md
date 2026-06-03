# Book Order Tracking — Client (App) Integration Guide

How the React Native app should consume the book-order tracking backend.
Backend is **complete** — this doc covers only what the **frontend** must build.

Companion docs:
- `book-order-courier-tracking.md` — backend design (sequential id, threshold routing, live API).
- `book-order-tracking.md` — original FE spec (WebView approach).

---

## TL;DR for the frontend dev

1. Purchase-History "Books" items now carry `tracking.trackingId`. If it's present, show a **"Track Order"** button.
2. On tap, call `GET /client/books/orders/:id/tracking` → take `trackingUrl` → **open it in a WebView**. Done.
3. *(Optional, fancier)* call `GET /client/books/orders/:id/tracking/live` to render a **native timeline** from live courier data instead of the WebView.

The WebView path (1 + 2) is enough to ship. The live endpoint (3) is a bonus.

---

## Auth

Every endpoint below requires the customer **Bearer token** (same as all other client APIs). The customer must own the order or you get `404`.

```
Authorization: Bearer <accessToken>
```

---

## Endpoint 1 — Detect trackable orders (already in Purchase History)

```
GET /api/v1/client/purchase-history/books
```

Each item now includes a `tracking` object:

```json
{
  "_id": "67a1...",
  "title": "Vartaman Vishesh March 2026 +2 more",
  "thumbnail": "https://.../cover.jpg",
  "amount": 540,
  "purchasedAt": "2026-03-01T10:00:00.000Z",
  "status": "shipped",
  "receiptUrl": "/api/v1/client/purchase-history/books/67a1.../receipt",
  "tracking": {
    "trackingId": "119400228001",
    "courier": "tirupati"
  },
  "meta": { "receiptId": "WS-2026-001", "itemsCount": 3 }
}
```

**Rule:** show the **Track Order** button only when `item.tracking?.trackingId` is a non-empty string.
Until an order is payment-verified, `trackingId` is `null` → no button.

---

## Endpoint 2 — Tracking summary + URL (the main one)

```
GET /api/v1/client/books/orders/:id/tracking
```

### Success `200`

```json
{
  "success": true,
  "data": {
    "orderId": "67a1...",
    "receiptId": "WS-2026-001",
    "awb": "119400228001",
    "courier": "tirupati",
    "trackingUrl": "http://www.shreetirupaticourier.net/Frm_DocTrack.aspx?Tmp=1772000000&docno=119400228001",
    "from": { "city": "GANDHINAGAR-KUDASAN", "hub": "Sector 7, Gandhinagar" },
    "to": { "city": "JAMNAGAR", "hub": "123 Main Street", "pincode": "361001" },
    "consignee": "Ravi Sharma",
    "consigneePhone": "9876543210",
    "bookedAt": "2026-03-01T10:00:00.000Z",
    "currentStatus": "shipped",
    "orderStatus": "shipped",
    "shippedAt": "2026-03-02T09:00:00.000Z",
    "deliveredAt": null,
    "history": [
      { "status": "Order Placed", "location": null, "note": "Payment received", "at": "2026-03-01T10:00:00.000Z" },
      { "status": "shipped", "location": "GANDHINAGAR-KUDASAN", "note": "Handed over to tirupati", "at": "2026-03-02T09:00:00.000Z" }
    ]
  }
}
```

### Field notes
- **`trackingUrl`** — the courier's own tracking page. This is what you open in the WebView. May be `null` if no `trackingId` yet (shouldn't happen once a button is shown, but guard anyway).
- **`history[]`** — sorted **oldest-first** by the backend. **Reverse it** to show newest-first in a timeline UI.
- **`courier`** — `"tirupati"` or `"mahavir"`. Informational; the URL is already built for you. (Note: live tracking only exists for `tirupati`.)
- `from.*` is the dispatch origin (set by admin). `to.*` / `consignee` come from the customer's saved shipping address.

### Errors
| Code | Meaning | FE action |
|---|---|---|
| `401` | No/expired token | re-auth |
| `404` | Order not found / not owned | show "not available" |
| `400` | Bad order id | show "not available" |

---

## Endpoint 3 — Live courier status *(optional, Tirupati only)*

```
GET /api/v1/client/books/orders/:id/tracking/live
```

Use this **only** if you want to render a native timeline from live courier data
instead of opening the WebView. Returns whatever the Tirupati API returns.

### Success `200`
```json
{ "success": true, "data": { /* raw Tirupati AWB payload */ } }
```

### Errors — handle these explicitly
| Code | Meaning | FE action |
|---|---|---|
| `409` | Order not yet verified (no trackingId) | hide live tab / show "processing" |
| `404` | No tracking allocated yet | same as above |
| `422` | Mahavir order — no live API | **fall back to `trackingUrl` WebView** (response includes `data.trackingUrl`) |
| `502` | Courier API call failed | fall back to WebView; offer retry |

> Because of the `422`/`502` cases, the **WebView (Endpoint 2) is the reliable fallback** even if you build the native timeline. Always keep it as the safety net.

---

## Recommended FE flow

```
PurchaseHistory (Books tab)
  └─ GET /client/purchase-history/books
       └─ item.tracking?.trackingId present → render "Track Order" button
            └─ navigate('BookOrderTrack', { orderId: item._id, orderTitle: item.title })

BookOrderTrackScreen
  ├─ GET /client/books/orders/:id/tracking
  │     └─ has trackingUrl → <WebView source={{ uri: trackingUrl }} startInLoadingState />
  │     └─ null / error    → EmptyState "Tracking not available yet."
  │
  └─ (optional) GET /client/books/orders/:id/tracking/live
        └─ 200 → render native timeline from data
        └─ 422/502 → fall back to the WebView above
```

`react-native-webview` is already in the app (used in VideoScreen / notes).

---

## Files to create / modify in the app (per the original FE spec)

| Action | File |
|--------|------|
| Add nav route type `BookOrderTrack: { orderId, orderTitle? }` | `src/helpers/arrayConstants/types.ts` |
| Add URL entry `bookOrderTracking` (+ `bookOrderTrackingLive` if using Endpoint 3) | `src/api/urls.ts` |
| Add API fn `getBookOrderTrackingAPI(orderId)` | `src/api/services/subscriptionApi.ts` |
| Read `item.tracking?.trackingId`, render Track button | `src/screens/app/profile/PurchaseHistory.tsx` |
| Register screen | `src/navigation/AppStack.tsx` |
| **Create** `BookOrderTrackScreen` (WebView) | `src/screens/app/profile/BookOrderTrackScreen.tsx` |

### Example API service fn
```ts
export const getBookOrderTrackingAPI = async (orderId: string) => {
  const config = buildAuthConfig();
  const resp = await apiClient.get(
    urls.books.bookOrderTracking.path(orderId), // client/books/orders/${orderId}/tracking
    config,
  );
  return resp;
};
```

### Example screen logic (WebView path)
```ts
const { orderId } = route.params;
const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [hasError, setHasError] = useState(false);

useEffect(() => {
  (async () => {
    try {
      const res: any = await getBookOrderTrackingAPI(orderId);
      setTrackingUrl(res?.data?.data?.trackingUrl ?? null);
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  })();
}, [orderId]);

// render:
// isLoading            -> <Loading />
// trackingUrl present  -> <WebView source={{ uri: trackingUrl }} startInLoadingState />
// null / hasError      -> <EmptyState text="Tracking information not available yet." />
```

---

## Quick test checklist (FE)
- [ ] Order with `tracking.trackingId` → button shows; tapping opens courier page.
- [ ] Order without `trackingId` (pending) → no button.
- [ ] `tracking` endpoint `404` → EmptyState, no crash.
- [ ] *(if using live)* `422`/`502` from `/tracking/live` → falls back to WebView.
- [ ] `history[]` reversed → newest event on top.
