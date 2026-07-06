# PromoCode Discount — Admin API

Adds two fields to a PromoCode that define the discount it grants:

- `discountType` — enum: `"flat"` | `"percentage"` (default `"percentage"`)
- `discountValue` — number, `>= 0`. When `discountType === "percentage"` it must also be `<= 100`.

When `discountValue > 0`, this promo-level discount is what gets applied to a customer's plan price (it overrides the per-plan `customerPercentage` link). When `discountValue === 0`, the existing per-plan `customerPercentage` continues to drive the discount.

**Auth:** Bearer token, role `admin` or `super_admin`.
**Base path:** `/api/v1/admin/promocodes`

## 1. Create
`POST /api/v1/admin/promocodes`

```json
{
  "promocode": "WELCOME10",
  "type": "public",
  "title": "Welcome offer",
  "description": "10% off your first plan",
  "promo_start_at": "2026-05-01T00:00:00.000Z",
  "promo_expire_at": "2026-06-01T00:00:00.000Z",
  "discountType": "percentage",
  "discountValue": 10,
  "status": true,
  "plans": [
    { "planId": "<planId>", "customerPercentage": 0, "promoterPercentage": 0 }
  ]
}
```

For a flat ₹100 off:
```json
{ "discountType": "flat", "discountValue": 100 }
```

**Validation errors (400):**
- `discountValue` missing or negative.
- `discountValue > 100` when `discountType` is `"percentage"`.

## 2. Update
`PUT /api/v1/admin/promocodes/:id`

Same body as create but every field is optional. Sending `discountType` / `discountValue` updates them; omitting leaves them unchanged.

```json
{ "discountType": "flat", "discountValue": 250 }
```

## 3. List
`GET /api/v1/admin/promocodes`

Existing query params unchanged: `search`, `status`, `type`, `fromDate`, `toDate`, `page`, `limit`. Every item in `data` now includes `discountType` and `discountValue`.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "promocode": "WELCOME10",
      "type": "public",
      "title": "Welcome offer",
      "description": "10% off your first plan",
      "promo_start_at": "2026-05-01T00:00:00.000Z",
      "promo_expire_at": "2026-06-01T00:00:00.000Z",
      "discountType": "percentage",
      "discountValue": 10,
      "status": true,
      "promoterId": null,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

## 4. Get by id
`GET /api/v1/admin/promocodes/:id`

Returns `{ promocode, plans }` where `promocode` is a single record with the same shape as a list item (including `discountType` and `discountValue`), and `plans` is the linked `PromotedPackageCourseEbook` rows.

## Migration note
Existing promocodes get `discountType = "percentage"` and `discountValue = 0` by default — i.e. no change in behavior until an admin sets a real value (the per-plan `customerPercentage` keeps working).
