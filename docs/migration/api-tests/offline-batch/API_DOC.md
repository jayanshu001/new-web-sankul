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
      "name": "Bhavnagar",
      "images": [
        "https://planetgujarat.com/wp-content/uploads/Banner-Bhavnagar-1.jpg"
      ],
      "address": "311, Shalin Galleria, sangeet circle, G1, Bhavnagar",
      "latitude": 6.6666666,
      "longitude": 6.6666666,
      "phone": "9099665555",
      "cityId": "2",
      "status": true,
      "createdAt": "2023-03-06T11:06:58.000Z",
      "updatedAt": "2023-03-06T11:06:58.000Z",
      "city": {
        "_id": "2",
        "name": "Ahmedabad"
      }
    },
    {
      "_id": "2",
      "name": "Sangeet Circle",
      "images": [
        "https://gpsconline.com/uploads/banner_images/books_banner.webp"
      ],
      "address": "311, Shalin Galleria, sangeet circle, G1, Gandhinagar",
      "latitude": 6.6666666,
      "longitude": 6.6666666,
      "phone": "1234567890",
      "cityId": "1",
      "status": true,
      "createdAt": "2023-03-06T11:06:58.000Z",
      "updatedAt": "2023-03-06T11:06:58.000Z",
      "city": {
        "_id": "1",
        "name": "Gandhinagar"
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
      "createdAt": "2023-03-06T11:04:29.000Z",
      "updatedAt": "2023-03-06T11:04:29.000Z",
      "city": {
        "_id": "1",
        "name": "Gandhinagar"
      }
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

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
      "_id": "2",
      "name": "GPSC Crash Course Batch",
      "image": "https://gpsconline.com/uploads/banner_images/books_banner.webp",
      "description": "For GPSC Mains 23 Exam",
      "startAt": "1899-12-31T00:00:00.000Z",
      "duration": "1 Year",
      "centerId": "2",
      "status": true,
      "createdAt": "2023-03-06T11:31:01.000Z",
      "updatedAt": "2023-03-06T11:31:01.000Z",
      "center": {
        "_id": "2",
        "name": "Sangeet Circle",
        "images": [
          "https://gpsconline.com/uploads/banner_images/books_banner.webp"
        ],
        "address": "311, Shalin Galleria, sangeet circle, G1, Gandhinagar",
        "latitude": 6.6666666,
        "longitude": 6.6666666,
        "phone": "1234567890",
        "cityId": "1",
        "status": true,
        "createdAt": "2023-03-06T11:06:58.000Z",
        "updatedAt": "2023-03-06T11:06:58.000Z",
        "city": {
          "_id": "1",
          "name": "Gandhinagar"
        }
      }
    },
    {
      "_id": "1",
      "name": "GPSC Crash Course Batch",
      "image": "https://gpsconline.com/uploads/banner_images/books_banner.webp",
      "description": "For GPSC Mains 23 Exam",
      "startAt": "2023-04-15T00:00:00.000Z",
      "duration": "1 Year",
      "centerId": "1",
      "status": true,
      "createdAt": "2023-03-06T11:31:01.000Z",
      "updatedAt": "2023-03-06T11:31:01.000Z",
      "center": {
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
        "createdAt": "2023-03-06T11:04:29.000Z",
        "updatedAt": "2023-03-06T11:04:29.000Z",
        "city": {
          "_id": "1",
          "name": "Gandhinagar"
        }
      }
    },
    {
      "_id": "3",
      "name": "PSI",
      "image": "https://gpsconline.com/uploads/banner_images/books_banner.webp",
      "description": "For Police Sub Inspector 23 Exam",
      "startAt": "2023-05-01T00:00:00.000Z",
      "duration": "1 Year",
      "centerId": "3",
      "status": true,
      "createdAt": "2023-03-06T11:31:01.000Z",
      "updatedAt": "2023-03-06T11:31:01.000Z",
      "center": {
        "_id": "3",
        "name": "Bhavnagar",
        "images": [
          "https://planetgujarat.com/wp-content/uploads/Banner-Bhavnagar-1.jpg"
        ],
        "address": "311, Shalin Galleria, sangeet circle, G1, Bhavnagar",
        "latitude": 6.6666666,
        "longitude": 6.6666666,
        "phone": "9099665555",
        "cityId": "2",
        "status": true,
        "createdAt": "2023-03-06T11:06:58.000Z",
        "updatedAt": "2023-03-06T11:06:58.000Z",
        "city": {
          "_id": "2",
          "name": "Ahmedabad"
        }
      }
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---
