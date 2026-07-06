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
      "createdAt": "2023-03-22T15:27:57.000Z",
      "updatedAt": "2023-03-22T15:27:57.000Z"
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
          "createdAt": "2025-07-31T16:55:34.000Z",
          "updatedAt": "2025-07-31T17:46:55.000Z",
          "count": 0,
          "havingChildDirectory": false
        }
      }
    ]
  }
}
```

---
