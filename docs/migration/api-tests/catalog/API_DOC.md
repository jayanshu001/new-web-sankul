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
      "_id": "3",
      "name": "Planner Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T14:14:56.000+05:30",
      "updatedAt": "2026-07-11T11:59:15.000+05:30"
    },
    {
      "_id": "1",
      "name": "Single Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T14:14:10.000+05:30",
      "updatedAt": "2026-07-11T11:54:04.000+05:30"
    },
    {
      "_id": "4",
      "name": "Smart Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T14:14:56.000+05:30",
      "updatedAt": "2026-07-11T11:59:20.000+05:30"
    },
    {
      "_id": "2",
      "name": "Subject wise Course",
      "order": 0,
      "active": true,
      "createdAt": "2023-02-27T14:14:10.000+05:30",
      "updatedAt": "2023-02-27T14:14:10.000+05:30"
    }
  ],
  "pagination": {
    "total": 4,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

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
      "createdAt": "2025-08-01T17:19:16.000+05:30",
      "updatedAt": "2026-07-16T14:12:48.000+05:30",
      "courseCount": 1
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
      "_id": "114",
      "name": "Course 1",
      "description": "<p>Description</p>",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1782896413235-image.jpeg",
      "shareableLink": "",
      "withMaterial": "0",
      "withoutMaterial": "0",
      "level": "2",
      "order": 0,
      "status": true,
      "isPopular": false,
      "isPaid": true,
      "courseSubjectCategoryId": {
        "_id": "774",
        "title": "test"
      },
      "courseEducatorId": {
        "_id": "77",
        "name": "Darshit Goswami"
      },
      "videoCategoryId": {
        "_id": "283",
        "title": "Computer"
      },
      "pcMaterialId": null,
      "createdAt": "2026-07-01T14:30:14.000+05:30",
      "updatedAt": "2026-07-16T14:15:28.000+05:30",
      "plans": {
        "withMaterial": [],
        "withoutMaterial": [
          {
            "_id": "1440",
            "packageId": null,
            "courseId": "114",
            "ebookId": null,
            "name": null,
            "duration": 60,
            "price": 699,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "createdAt": "2026-07-01T14:30:14.000+05:30",
            "updatedAt": "2026-07-21T15:14:32.000+05:30"
          }
        ]
      },
      "isPurchased": true,
      "daysLeft": 82
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

---
