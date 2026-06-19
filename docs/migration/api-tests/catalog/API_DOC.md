# catalog — API reference

> Auto-generated from a passing `migration:api` run for **catalog**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 3

---

## GET /api/v1/client/packages/types

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
      "_id": "5",
      "name": "Classroom Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T08:45:55.000Z",
      "updatedAt": "2023-02-27T08:45:55.000Z"
    },
    {
      "_id": "3",
      "name": "Educator wise Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T08:44:56.000Z",
      "updatedAt": "2023-02-27T08:44:56.000Z"
    },
    {
      "_id": "6",
      "name": "Live Classes",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T08:45:55.000Z",
      "updatedAt": "2023-02-27T08:45:55.000Z"
    },
    {
      "_id": "4",
      "name": "Planner Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T08:44:56.000Z",
      "updatedAt": "2023-02-27T08:44:56.000Z"
    },
    {
      "_id": "1",
      "name": "Recorded Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T08:44:10.000Z",
      "updatedAt": "2023-02-27T08:44:10.000Z"
    },
    {
      "_id": "2",
      "name": "Subject wise Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T08:44:10.000Z",
      "updatedAt": "2023-02-27T08:44:10.000Z"
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/courses/categories

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
      "_id": "774",
      "title": "test",
      "slug": "test",
      "image": "twitter-image.png",
      "parent": 0,
      "order": 2,
      "status": true,
      "createdAt": "2025-08-01T11:49:16.000Z",
      "updatedAt": "2025-08-01T11:49:16.000Z",
      "courseCount": 1
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/courses?limit=10

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
      "_id": "75",
      "name": "test",
      "description": "<div><br></div>",
      "image": "twitter-image.png",
      "shareableLink": "http://",
      "withMaterial": "1",
      "withoutMaterial": "1",
      "level": "1",
      "order": 1,
      "status": true,
      "isPopular": true,
      "isPaid": false,
      "courseSubjectCategoryId": {
        "_id": "774",
        "title": "test"
      },
      "courseEducatorId": {
        "_id": "20",
        "name": "Priyanka Sonis"
      },
      "videoCategoryId": {
        "_id": "15",
        "title": "History"
      },
      "pcMaterialId": null,
      "createdAt": "2025-08-01T12:05:27.000Z",
      "updatedAt": "2025-08-01T12:05:27.000Z",
      "plans": {
        "withMaterial": [],
        "withoutMaterial": [
          {
            "_id": "885",
            "packageId": null,
            "courseId": "75",
            "ebookId": null,
            "name": "1 Month",
            "duration": 30,
            "price": 898,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": true,
            "status": true,
            "createdAt": "2023-03-06T15:29:57.000Z",
            "updatedAt": "2023-10-12T14:19:24.000Z"
          },
          {
            "_id": "1435",
            "packageId": null,
            "courseId": "75",
            "ebookId": null,
            "name": "30day",
            "duration": 40,
            "price": 2000,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "createdAt": "2025-08-01T12:04:44.000Z",
            "updatedAt": "2025-08-01T12:05:27.000Z"
          },
          {
            "_id": "887",
            "packageId": null,
            "courseId": "75",
            "ebookId": null,
            "name": "3 month",
            "duration": 90,
            "price": 1398,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "createdAt": "2023-03-06T15:30:21.000Z",
            "updatedAt": "2023-10-12T14:19:30.000Z"
          },
          {
            "_id": "888",
            "packageId": null,
            "courseId": "75",
            "ebookId": null,
            "name": "6 month",
            "duration": 180,
            "price": 1998,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "createdAt": "2023-03-06T15:30:28.000Z",
            "updatedAt": "2023-10-12T14:19:35.000Z"
          },
          {
            "_id": "889",
            "packageId": null,
            "courseId": "75",
            "ebookId": null,
            "name": "12 Month",
            "duration": 365,
            "price": 2598,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "createdAt": "2023-03-06T15:30:40.000Z",
            "updatedAt": "2023-10-12T14:19:40.000Z"
          }
        ]
      },
      "isPurchased": false,
      "daysLeft": null
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---
