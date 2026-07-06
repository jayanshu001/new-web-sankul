# Catalog Purchase Flags — Books & Ebooks

The Books and Ebooks catalog endpoints now decorate each item with the authenticated user's purchase state, so the frontend can render "Read Now" vs "Buy Now" without a second round-trip.

**Auth:** `Authorization: Bearer <token>` required on all four endpoints.

---

## 1. Books

Books are **permanent** once delivered — any successful past order (`verified` / `shipped` / `delivered`) counts as purchased. Matches the rule used by `/purchase-history/books`.

### `GET /api/v1/client/books`

Adds `isPurchased` to each item in the existing `data.books[]` array.

```json
{
  "success": true,
  "data": {
    "cartId": "65f...",
    "books": [
      {
        "_id": "65f...",
        "name": "Vartaman Vishesh March 2026",
        "discountedPrice": 199,
        "qty": 0,
        "key": "individual",
        "isPurchased": true,
        "...": "all existing fields preserved"
      }
    ]
  }
}
```

### `GET /api/v1/client/books/:id`

Adds `isPurchased` to the existing detail payload.

```json
{
  "success": true,
  "data": {
    "_id": "65f...",
    "name": "Vartaman Vishesh March 2026",
    "pages": 120,
    "isPurchased": true,
    "...": "all existing fields preserved"
  }
}
```

---

## 2. Ebooks

Ebooks are **time-bound** — only currently-active subscriptions count (`status: true` AND `endAt > now`). The endpoint also returns the soonest expiry so the catalog card can show "X days left" without a second call.

If a user somehow has two overlapping subscriptions for the same ebook, the **latest `endAt`** wins (that's the access window they actually have).

### `GET /api/v1/client/ebooks`

Adds three fields to each item in `data.ebooks[]`.

```json
{
  "success": true,
  "data": {
    "ebooks": [
      {
        "_id": "65f...",
        "name": "Vartaman Vishesh March 2026",
        "plans": [ /* ... */ ],
        "details": [ /* ... */ ],
        "isPurchased": true,
        "subscriptionEndAt": "2026-09-11T08:00:00.000Z",
        "daysLeft": 123,
        "...": "all existing fields preserved"
      }
    ]
  }
}
```

### `GET /api/v1/client/ebooks/:id`

Same three fields, attached to `data.ebook`.

```json
{
  "success": true,
  "data": {
    "ebook": {
      "_id": "65f...",
      "name": "Vartaman Vishesh March 2026",
      "plans": [ /* ... */ ],
      "isPurchased": true,
      "subscriptionEndAt": "2026-09-11T08:00:00.000Z",
      "daysLeft": 123,
      "...": "all existing fields preserved"
    },
    "availablePromoCode": [ /* ... */ ]
  }
}
```

---

## Field Reference

| Field | Type | Applies to | Meaning |
|---|---|---|---|
| `isPurchased` | `boolean` | books, ebooks | `true` iff the authenticated user currently owns (book) or has active access to (ebook) this item. |
| `subscriptionEndAt` | `ISO date \| null` | ebooks only | Latest active-subscription end timestamp. `null` if not purchased. |
| `daysLeft` | `integer \| null` | ebooks only | Calendar days until `subscriptionEndAt`, ceiling-rounded (23h59m → `1`). `null` if not purchased. |

---

## Implementation Notes (for backend reviewers)

- **No call to Purchase History API.** Each catalog handler does **one extra DB query** keyed by the authenticated user, returning the membership set / active-subscription map. This is cheaper, simpler, and decouples the screens.
- **Books query:** `BookOrder.distinct("items.bookId", { customerId, status: in [VERIFIED, SHIPPED, DELIVERED] })` → set membership check per book.
- **Ebooks query:** `EbookSubscription.find({ customerId, ebookId: { $in: catalogIds }, status: true, endAt: { $gt: now } })` → map `ebookId → max(endAt)`.
- **Auth note:** Previously `/client/books` and `/client/books/:id` were unauthenticated. They now require Bearer token (per project policy). Existing decoration logic still tolerates no `customerId` defensively, but the route middleware will reject unauthenticated requests before the handler runs.

---

## Frontend Integration Notes

1. **Books** — toggle CTA on `isPurchased`. `true` → "View" / "Already Owned" / hide cart actions. `false` → "Add to Cart" / "Buy Now".
2. **Ebooks** — `isPurchased: true` → "Read Now" with `daysLeft` badge if `< 30`. `false` → show plan selector / "Buy Now".
3. **Expiry handling** — `subscriptionEndAt` is the source of truth. If you want to warn at < 7 days, compare against `daysLeft` directly.
4. **Caching** — these fields change with user state (purchase, expiry). Don't cache the catalog response across users. Per-user TTL of ~1 min is fine if you cache at all.
