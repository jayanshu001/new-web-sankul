# Book Detail — Client API

Returns metadata for a single physical book/magazine. Books use **flat one-shot pricing** — there are no duration-based subscription tiers here (those are an ebook-only concept). The multi-tier "1 / 3 / 6 / 12 Months" pricing card does **not** apply to books.

**Auth:** Bearer token, role `customer`.
**Endpoint:** `GET /api/v1/client/books/:id`

## Response 200
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "name": "...",
    "author": "...",
    "publication": "WebSankul Publication",
    "language": "Gujarati",
    "description": "...",
    "thumbnail": "...",
    "image": "...",
    "demoUrl": "...",
    "bookUrl": "...",
    "weight": 350,
    "pages": 240,
    "dynamicLink": "...",
    "deliveryEta": "5-7 days",
    "listPrice": 599,
    "discountedPrice": 499,
    "shippingPrice": 40,
    "isMagazine": false,
    "isCombo": false,
    "isTrending": false,
    "examCountdownCategoryId": null,
    "orderBy": 0,
    "status": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Pricing UI mapping

| UI element | Field |
|---|---|
| MRP / strikethrough price | `listPrice` |
| Selling price | `discountedPrice` |
| Discount amount | `listPrice - discountedPrice` |
| Discount % | `round((listPrice - discountedPrice) / listPrice * 100)` |
| Shipping fee | `shippingPrice` (waived in cart once the order subtotal crosses the free-shipping threshold; the cart endpoint applies that, not detail) |
| Delivery window | `deliveryEta` |

Quantity / cart actions are handled separately under `/api/v1/client/books/cart` — the detail response itself is read-only metadata.

## Errors
- `400` invalid id.
- `404` book not found or `status: false`.

## Why this is separate from the ebook tier doc
The screenshot's tiered pricing card (per-month price, total, "Save ₹X", "Best Value") is driven by `EbookPrice.duration` and only exists for ebooks. Books are bought once and shipped, so they expose `listPrice` / `discountedPrice` / `shippingPrice` instead. Use [EBOOK_DETAIL_CLIENT.md](EBOOK_DETAIL_CLIENT.md) for the tiered case.
