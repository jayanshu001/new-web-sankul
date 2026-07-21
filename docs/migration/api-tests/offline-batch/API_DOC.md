# offline-batch — API reference

> Auto-generated from a passing `migration:api` run for **offline-batch**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 2

---

## GET /api/v1/client/offline/centers

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
      "_id": "3",
      "name": "Bhavnagars",
      "images": [
        "https://planetgujarat.com/wp-content/uploads/Banner-Bhavnagar-1.jpg"
      ],
      "address": "311, Shalin Galleria, sangeet circle, G1, Bhavnagar",
      "latitude": 6.6666666,
      "longitude": 6.6666666,
      "phone": "9099665555",
      "cityId": "2",
      "status": true,
      "createdAt": "2023-03-06T16:36:58.000+05:30",
      "updatedAt": "2026-07-17T14:15:29.000+05:30",
      "city": {
        "_id": "2",
        "name": "Ahmedabad"
      }
    },
    {
      "_id": "1",
      "name": "Sargasan Cross Road",
      "images": [
        "https://planetgujarat.com/wp-content/uploads/Banner-Bhavnagar-1.jpg"
      ],
      "address": "Sargasan cross road",
      "latitude": 6.6666666,
      "longitude": 6.6666666,
      "phone": "987654321",
      "cityId": "1",
      "status": true,
      "createdAt": "2023-03-06T16:34:29.000+05:30",
      "updatedAt": "2023-03-06T16:34:29.000+05:30",
      "city": {
        "_id": "1",
        "name": "Gandhinagar"
      }
    }
  ],
  "pagination": {
    "total": 2,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## GET /api/v1/client/offline/batches

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
      "_id": "4",
      "name": "GPSC Batchs",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1784015362633-image.jpeg",
      "description": "Nothing Nothing",
      "startAt": "2026-10-21T05:30:00.000+05:30",
      "duration": "6 months",
      "centerId": "3",
      "status": true,
      "createdAt": "2026-07-14T13:19:23.000+05:30",
      "updatedAt": "2026-07-17T14:15:21.000+05:30",
      "center": {
        "_id": "3",
        "name": "Bhavnagars",
        "images": [
          "https://planetgujarat.com/wp-content/uploads/Banner-Bhavnagar-1.jpg"
        ],
        "address": "311, Shalin Galleria, sangeet circle, G1, Bhavnagar",
        "latitude": 6.6666666,
        "longitude": 6.6666666,
        "phone": "9099665555",
        "cityId": "2",
        "status": true,
        "createdAt": "2023-03-06T16:36:58.000+05:30",
        "updatedAt": "2026-07-17T14:15:29.000+05:30",
        "city": {
          "_id": "2",
          "name": "Ahmedabad"
        }
      }
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---
