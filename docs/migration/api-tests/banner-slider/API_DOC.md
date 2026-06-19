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
      "image": "fhw_mphw_si_new_banner.jpg",
      "key": "Packages",
      "keyRef": "Package",
      "keyId": null,
      "orderBy": 2,
      "createdAt": "2023-03-06T17:59:18.000Z",
      "updatedAt": "2026-01-01T13:59:04.000Z"
    },
    {
      "_id": "55",
      "image": "gcert_smart_course_new_banner.jpeg",
      "key": "Courses",
      "keyRef": "Course",
      "keyId": null,
      "orderBy": 3,
      "createdAt": "2025-07-30T18:53:32.000Z",
      "updatedAt": "2026-01-01T14:00:00.000Z"
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
    "image": "fhw_mphw_si_new_banner.jpg",
    "key": "Packages",
    "keyRef": "Package",
    "keyId": null,
    "orderBy": 2,
    "createdAt": "2023-03-06T17:59:18.000Z",
    "updatedAt": "2026-01-01T13:59:04.000Z"
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
  "image": "migration-api-test-1781876236947.jpg",
  "key": "Packages",
  "orderBy": 99
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "86",
    "image": "migration-api-test-1781876236947.jpg",
    "key": "Packages",
    "keyRef": "Package",
    "keyId": null,
    "orderBy": 99,
    "createdAt": "2026-06-19T13:37:17.000Z",
    "updatedAt": "2026-06-19T13:37:17.000Z"
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
    "_id": "86",
    "image": "migration-api-test-1781876236947.jpg",
    "key": "Courses",
    "keyRef": "Course",
    "keyId": null,
    "orderBy": 98,
    "createdAt": "2026-06-19T13:37:17.000Z",
    "updatedAt": "2026-06-19T13:37:17.000Z"
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
      "id": "86",
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
      "image": "fhw_mphw_si_new_banner.jpg",
      "key": "Packages",
      "keyRef": "Package",
      "keyId": null,
      "orderBy": 2,
      "createdAt": "2023-03-06T17:59:18.000Z",
      "updatedAt": "2026-01-01T13:59:04.000Z"
    },
    {
      "_id": "55",
      "image": "gcert_smart_course_new_banner.jpeg",
      "key": "Courses",
      "keyRef": "Course",
      "keyId": null,
      "orderBy": 3,
      "createdAt": "2025-07-30T18:53:32.000Z",
      "updatedAt": "2026-01-01T14:00:00.000Z"
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---
