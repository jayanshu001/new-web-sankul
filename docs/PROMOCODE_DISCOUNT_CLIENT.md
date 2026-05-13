# PromoCode Discount — Client API

**Auth:** Bearer token, role `customer`.
**Base path:** `/api/v1/client/promocodes`

Two endpoints:
- `GET  /api/v1/client/promocodes` — list active public promocodes (for a "available offers" screen).
- `POST /api/v1/client/promocodes/apply` — preview the discounted plan prices for a specific package/course/ebook before checkout. No state is changed; this is a price-preview call.

## 1. List active promocodes
`GET /api/v1/client/promocodes`

Returns currently active, public promocodes (status `true`, within `promo_start_at` / `promo_expire_at`). Private promocodes are excluded — they are intended to be shared directly with a customer.

**Query params:** `page` (default `1`), `limit` (default `20`).

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "promocode": "WELCOME10",
      "title": "Welcome offer",
      "description": "10% off your first plan",
      "discountType": "percentage",
      "discountValue": 10,
      "promo_start_at": "2026-05-01T00:00:00.000Z",
      "promo_expire_at": "2026-06-01T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

The list does not tell the client which plans a promocode is valid for — call `apply` with the entity in cart to find out.

## 2. Apply (preview) a promocode
`POST /api/v1/client/promocodes/apply`

Honours `discountType` / `discountValue` on the PromoCode and returns the recomputed plan prices for the given entity. Pure read-only — the cart/checkout is responsible for sending the same code through the order API to actually redeem it.

## How the discount is computed

For every pricing plan the promo covers:

1. If the PromoCode has `discountValue > 0`, the **promo-level** discount is applied:
   - `discountType: "percentage"` → `price = price - round(price * discountValue / 100)`
   - `discountType: "flat"` → `price = max(0, price - discountValue)`
2. Otherwise, the legacy per-plan `customerPercentage` is applied (unchanged behaviour).

Referral codes are unaffected — they continue to use `ReferralProgram.referralDiscount`.

## Request
```json
{
  "promocode": "WELCOME10",
  "package": "<packageId>"   // or "course": "<courseId>"  or "ebook": "<ebookId>"
}
```

## Response 200 (promo-level discount applied)
```json
{
  "success": true,
  "data": {
    "promocode": "WELCOME10",
    "discountType": "percentage",
    "discountValue": 10,
    "id": "<entityId>",
    "key": "package",
    "plans": {
      "withMaterial": [
        {
          "_id": "...",
          "duration": 6,
          "orginalPrice": 1000,
          "price": 900,
          "offerAvailable": true,
          "offerPercentage": 10,
          "discountType": "percentage",
          "discountValue": 10
        }
      ],
      "withoutMaterial": [ /* same shape */ ]
    }
  }
}
```

For a flat discount the plan object includes:
```json
{
  "orginalPrice": 1000,
  "price": 750,
  "offerAvailable": true,
  "discountType": "flat",
  "discountValue": 250
}
```

## Notes
- `orginalPrice` is the pre-discount price; `price` is the post-discount price the client should charge.
- `offerPercentage` is only set on percentage promos (kept for backwards compatibility with existing UI). For flat promos, read `discountType` / `discountValue` instead.
- Plans not covered by the promocode keep `offerAvailable: false` and an unchanged `price`.
- Errors are unchanged: `400` invalid promocode/selection, `404` no plans / not valid for this entity.
