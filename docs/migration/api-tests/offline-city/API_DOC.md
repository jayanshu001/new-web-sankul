# offline-city — API reference

> Auto-generated from a passing `migration:api` run for **offline-city**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 1

---

## GET /api/v1/client/address/cities

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": [
    {
      "_id": "36",
      "name": "Ahmedabad ઇવેન્ટ્સ",
      "image": "",
      "status": true,
      "order": 0,
      "stateId": {
        "_id": "10",
        "name": "Goa",
        "stateCode": "GA"
      },
      "createdAt": null,
      "updatedAt": null
    },
    {
      "_id": "3",
      "name": "Amreli",
      "image": "",
      "status": true,
      "order": 0,
      "stateId": {
        "_id": "13",
        "name": "Gujarat ઇવેન્ટ્સ",
        "stateCode": "GJ"
      },
      "createdAt": null,
      "updatedAt": null
    }
  ],
  "_note": "array truncated for docs — 33 items total; first 2 shown"
}
```

_(3 calls captured for this endpoint; first shown.)_

---
