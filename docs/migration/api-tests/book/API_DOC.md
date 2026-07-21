# book — API reference

> Auto-generated from a passing `migration:api` run for **book**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 3

---

## GET /api/v1/admin/books

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
      "_id": "195",
      "name": "Gk ઇવેન્ટ્સ",
      "examCountdownCategoryId": null,
      "examCountdownCategoryIds": [],
      "examCountdownIds": [],
      "packageIds": [],
      "thumbnail": null,
      "author": null,
      "image": null,
      "description": null,
      "termsAndConditions": null,
      "demoUrl": "blr1.digitaloceanspaces.com/websankul-staging/admin/profiles/1783947679040-demoUrl.pdf",
      "bookUrl": null,
      "demoFileName": "high-court-of.pdf",
      "bookFileName": null,
      "weight": 0,
      "pages": 0,
      "dynamicLink": "",
      "listPrice": 1201,
      "discountedPrice": 800,
      "shippingPrice": 0,
      "orderBy": 0,
      "language": "Gujarati",
      "isMagazine": false,
      "isCombo": false,
      "publication": "WebSankul Publication",
      "deliveryEta": "5-7 days",
      "isTrending": false,
      "status": true,
      "createdAt": "2026-07-13T18:31:09.000+05:30",
      "updatedAt": "2026-07-21T17:10:09.000+05:30"
    },
    {
      "_id": "194",
      "name": "Gk Two",
      "examCountdownCategoryId": null,
      "examCountdownCategoryIds": [],
      "examCountdownIds": [],
      "packageIds": [],
      "thumbnail": null,
      "author": null,
      "image": null,
      "description": null,
      "termsAndConditions": null,
      "demoUrl": "blr1.digitaloceanspaces.com/websankul-staging/admin/profiles/1783946732462-demoUrl.pdf",
      "bookUrl": null,
      "demoFileName": "high-court-of.pdf",
      "bookFileName": null,
      "weight": 0,
      "pages": 0,
      "dynamicLink": "",
      "listPrice": 2699,
      "discountedPrice": 500,
      "shippingPrice": 0,
      "orderBy": 0,
      "language": "Gujarati",
      "isMagazine": false,
      "isCombo": false,
      "publication": "WebSankul Publication",
      "deliveryEta": "5-7 days",
      "isTrending": false,
      "status": true,
      "createdAt": "2026-07-13T18:15:34.000+05:30",
      "updatedAt": "2026-07-13T18:15:34.000+05:30"
    }
  ],
  "pagination": {
    "total": 14,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  },
  "_note": "array truncated for docs — 14 items total; first 2 shown"
}
```

_(4 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/books/:id

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
  "data": {
    "_id": "195",
    "name": "Gk ઇવેન્ટ્સ",
    "examCountdownCategoryId": null,
    "examCountdownCategoryIds": [],
    "examCountdownIds": [],
    "packageIds": [],
    "thumbnail": null,
    "author": null,
    "image": null,
    "description": null,
    "termsAndConditions": null,
    "demoUrl": "blr1.digitaloceanspaces.com/websankul-staging/admin/profiles/1783947679040-demoUrl.pdf",
    "bookUrl": null,
    "demoFileName": "high-court-of.pdf",
    "bookFileName": null,
    "weight": 0,
    "pages": 0,
    "dynamicLink": "",
    "listPrice": 1201,
    "discountedPrice": 800,
    "shippingPrice": 0,
    "orderBy": 0,
    "language": "Gujarati",
    "isMagazine": false,
    "isCombo": false,
    "publication": "WebSankul Publication",
    "deliveryEta": "5-7 days",
    "isTrending": false,
    "status": true,
    "createdAt": "2026-07-13T18:31:09.000+05:30",
    "updatedAt": "2026-07-21T17:10:09.000+05:30"
  }
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## PATCH /api/v1/admin/books/:id/trending

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
  "data": {
    "isTrending": true
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---
