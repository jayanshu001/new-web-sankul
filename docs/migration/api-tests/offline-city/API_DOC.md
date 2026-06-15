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
      "_id": "2",
      "name": "Ahmedabad",
      "image": "https://planetgujarat.com/wp-content/uploads/Banner-Bhavnagar-1.jpg",
      "status": true,
      "order": 0,
      "createdAt": "2023-03-06T11:02:26.000Z",
      "updatedAt": "2023-03-06T11:02:26.000Z"
    },
    {
      "_id": "1",
      "name": "Gandhinagar",
      "image": "https://gpsconline.com/uploads/popup_notification/E5sw4bUUcAYYLve.jpeg",
      "status": true,
      "order": 0,
      "createdAt": "2023-03-06T11:02:26.000Z",
      "updatedAt": "2023-03-06T11:02:26.000Z"
    }
  ]
}
```

_(3 calls captured for this endpoint; first shown.)_

---
