# banner-slider — API reference

> Auto-generated from a passing `migration:api` run for **banner-slider**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 7

---

## GET /api/v1/admin/cms/banners

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
      "_id": "50",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1783409561976-image.jpeg",
      "key": "Book",
      "keyRef": "Book",
      "keyId": null,
      "orderBy": 2,
      "createdAt": "2023-03-06T23:29:18.000+05:30",
      "updatedAt": "2026-07-07T13:27:07.000+05:30"
    },
    {
      "_id": "55",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1783411044684-image.jpg",
      "key": "Explore",
      "keyId": null,
      "orderBy": 3,
      "createdAt": "2025-07-31T00:23:32.000+05:30",
      "updatedAt": "2026-07-07T13:27:26.000+05:30"
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/cms/banners/:id

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
    "_id": "50",
    "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1783409561976-image.jpeg",
    "key": "Book",
    "keyRef": "Book",
    "keyId": null,
    "orderBy": 2,
    "createdAt": "2023-03-06T23:29:18.000+05:30",
    "updatedAt": "2026-07-07T13:27:07.000+05:30"
  }
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/admin/cms/banners

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
  "image": "migration-api-test-1784629945034.jpg",
  "key": "Packages",
  "orderBy": 99
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "58",
    "image": "migration-api-test-1784629945034.jpg",
    "key": "Packages",
    "keyRef": "Package",
    "keyId": null,
    "orderBy": 99,
    "createdAt": "2026-07-21T16:02:25.000+05:30",
    "updatedAt": "2026-07-21T16:02:25.000+05:30"
  }
}
```

---

## PUT /api/v1/admin/cms/banners/:id

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
  "key": "Courses",
  "orderBy": 98
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "58",
    "image": "migration-api-test-1784629945034.jpg",
    "key": "Courses",
    "keyRef": "Course",
    "keyId": null,
    "orderBy": 98,
    "createdAt": "2026-07-21T16:02:25.000+05:30",
    "updatedAt": "2026-07-21T16:02:25.000+05:30"
  }
}
```

---

## POST /api/v1/admin/cms/banners/reorder

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
  "orders": [
    {
      "id": "58",
      "orderBy": 50
    }
  ]
}
```

### Response (`200`)
```json
{
  "success": true,
  "message": "Banner order updated."
}
```

---

## DELETE /api/v1/admin/cms/banners/:id

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

---

## GET /api/v1/client/banners

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
      "_id": "50",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1783409561976-image.jpeg",
      "key": "Book",
      "keyRef": "Book",
      "keyId": null,
      "orderBy": 2,
      "createdAt": "2023-03-06T17:59:18.000Z",
      "updatedAt": "2026-07-07T07:57:07.000Z"
    },
    {
      "_id": "55",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1783411044684-image.jpg",
      "key": "Explore",
      "keyId": null,
      "orderBy": 3,
      "createdAt": "2025-07-30T18:53:32.000Z",
      "updatedAt": "2026-07-07T07:57:26.000Z"
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

_(2 calls captured for this endpoint; first shown.)_

---
