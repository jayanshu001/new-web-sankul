# popup — API reference

> Auto-generated from a passing `migration:api` run for **popup**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 6

---

## GET /api/v1/admin/cms/popups

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
      "_id": "54",
      "title": "PADAPADI",
      "description": "No Descriptn",
      "image": "twitter-image.png",
      "discount": "80",
      "promocode": "PADAPADI",
      "promoExpireAt": "2023-03-20T00:00:00.000Z",
      "status": false,
      "createdAt": "2023-02-21T16:56:58.000Z",
      "updatedAt": "2025-08-01T13:47:34.000Z"
    },
    {
      "_id": "1",
      "title": "Hurry up! 2 days left",
      "description": "Use promocode \"WEBSANKUL\" to get 50% off.",
      "image": "2_days_left.jpeg",
      "discount": "50%",
      "promocode": "WEBSANKUL",
      "promoExpireAt": "2024-11-01T00:00:00.000Z",
      "status": false,
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-02-21T17:01:14.000Z"
    }
  ],
  "_note": "array truncated for docs — 36 items total; first 2 shown"
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/cms/popups/:id

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
    "_id": "54",
    "title": "PADAPADI",
    "description": "No Descriptn",
    "image": "twitter-image.png",
    "discount": "80",
    "promocode": "PADAPADI",
    "promoExpireAt": "2023-03-20T00:00:00.000Z",
    "status": false,
    "createdAt": "2023-02-21T16:56:58.000Z",
    "updatedAt": "2025-08-01T13:47:34.000Z"
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/admin/cms/popups

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "title": "migration-api-test-1781877213901",
  "description": "desc",
  "image": "test-popup.jpg",
  "discount": "10%",
  "promocode": "TESTCODE",
  "promoExpireAt": "2026-07-19",
  "status": true
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "135",
    "title": "migration-api-test-1781877213901",
    "description": "desc",
    "image": "test-popup.jpg",
    "discount": "10%",
    "promocode": "TESTCODE",
    "promoExpireAt": "2026-07-19T00:00:00.000Z",
    "status": true,
    "createdAt": "2026-06-19T13:53:34.000Z",
    "updatedAt": "2026-06-19T13:53:34.000Z"
  }
}
```

_(4 calls captured for this endpoint; first shown.)_

---

## PUT /api/v1/admin/cms/popups/:id

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "discount": "25%",
  "status": false,
  "promoExpireAt": "2026-08-18"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "135",
    "title": "migration-api-test-1781877213901",
    "description": "desc",
    "image": "test-popup.jpg",
    "discount": "25%",
    "promocode": "TESTCODE",
    "promoExpireAt": "2026-08-18T00:00:00.000Z",
    "status": false,
    "createdAt": "2026-06-19T13:53:34.000Z",
    "updatedAt": "2026-06-19T13:53:34.000Z"
  }
}
```

---

## DELETE /api/v1/admin/cms/popups/:id

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
  "message": "Deleted."
}
```

_(4 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/popup

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
  "data": null
}
```

_(2 calls captured for this endpoint; first shown.)_

---
