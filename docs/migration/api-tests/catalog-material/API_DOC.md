# catalog-material — API reference

> Auto-generated from a passing `migration:api` run for **catalog-material**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 2

---

## GET /api/v1/client/material-categories/not-an-id/children

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`400`)
```json
{
  "success": false,
  "message": "Invalid category id."
}
```

---

## GET /api/v1/client/material-categories/:id/children

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
    "parent": {
      "_id": "270",
      "title": "Current Affairs - Manish Sindhi Lectures PDF",
      "slug": "current-affairs---manish-sindhi-lectures-pdf",
      "image": "MAINS@0.3x.png",
      "parent": 0,
      "order": 192,
      "status": true,
      "createdAt": "2023-03-22T20:57:57.000+05:30",
      "updatedAt": "2023-03-22T20:57:57.000+05:30"
    },
    "list": [
      {
        "category": {
          "_id": "1867",
          "title": "test",
          "slug": "test",
          "image": "gcert_smart_course_new_banner.jpeg",
          "parent": 270,
          "order": 11,
          "status": true,
          "createdAt": "2025-07-31T22:25:34.000+05:30",
          "updatedAt": "2026-07-16T19:56:19.000+05:30",
          "count": 2,
          "havingChildDirectory": false
        }
      }
    ]
  },
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---
