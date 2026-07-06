# Ebook Detail — Client API

Returns full ebook metadata plus tiered subscription plans and any active public promocodes that apply to it. This is the response that powers the multi-tier pricing card (1 / 3 / 6 / 12 months, "Best Value" highlight, "Save ₹X" copy).

**Auth:** Bearer token, role `customer`.
**Endpoint:** `GET /api/v1/client/ebooks/:id`

## Response 200
```json
{
  "success": true,
  "data": {
    "ebook": {
      "_id": "...",
      "name": "...",
      "author": "...",
      "publisher": "...",
      "language": "Gujarati",
      "description": "...",
      "thumbnail": "...",
      "image": "...",
      "demoUrl": "...",
      "ebookUrl": "...",
      "isTrending": false,
      "status": true,
      "createdAt": "...",
      "updatedAt": "...",
      "plans": [
        {
          "_id": "...",
          "ebookId": "...",
          "name": "1 Month",
          "duration": 1,
          "price": 999,
          "withMaterial": false,
          "materialPrice": 0,
          "isDefault": false,
          "status": true
        },
        {
          "_id": "...",
          "name": "3 Months",
          "duration": 3,
          "price": 2697,
          "isDefault": false,
          "status": true
        },
        {
          "_id": "...",
          "name": "6 Months",
          "duration": 6,
          "price": 4794,
          "isDefault": true,
          "status": true
        },
        {
          "_id": "...",
          "name": "12 Months",
          "duration": 12,
          "price": 8388,
          "isDefault": false,
          "status": true
        }
      ]
    },
    "availablePromoCode": [
      { "title": "Welcome", "promocode": "WELCOME10", "description": "10% off" }
    ]
  }
}
```

## Pricing UI mapping (per the tier card)

For each entry in `ebook.plans`:

| UI element | How to derive |
|---|---|
| Tier label (e.g. "1 Month", "6 Months") | `plan.name` if present, else `${plan.duration} Month${plan.duration > 1 ? "s" : ""}` |
| Per-month price (e.g. `₹999 /month`) | `plan.price / plan.duration` (round to nearest rupee) |
| Total (right side, e.g. `₹4794 Total`) | `plan.price` — this **is** the total for the tier, not a monthly value |
| `Save ₹X` | `oneMonth.price * plan.duration - plan.price`, where `oneMonth` = the plan with `duration: 1`. Hide for the 1-month plan or when result is `<= 0` |
| "Best Value" badge / pre-selected radio | `plan.isDefault === true` |

Plans are returned sorted by `duration` ascending, so the array order already matches the card stack top-to-bottom.

## Available promocodes
`data.availablePromoCode` lists active, public promocodes that the customer can try at checkout for this ebook. Apply them via `POST /api/v1/client/promocodes/apply` to preview the discounted plan prices (see [PROMOCODE_DISCOUNT_CLIENT.md](PROMOCODE_DISCOUNT_CLIENT.md)).

## Errors
- `400` invalid id.
- `404` ebook not found or `status: false`.
