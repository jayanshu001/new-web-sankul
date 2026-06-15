# testimonial — API reference

> Auto-generated from a passing `migration:api` run for **testimonial**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 6

---

## GET /api/v1/admin/cms/testimonials

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
      "_id": "1",
      "name": "Sanjay",
      "title": "Test",
      "description": "Helpful Application for GPSC 1-2",
      "rating": 5
    },
    {
      "_id": "2",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2",
      "rating": 4
    },
    {
      "_id": "3",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2",
      "rating": 4
    },
    {
      "_id": "4",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2,Application for GPSC 1-2",
      "rating": 4
    },
    {
      "_id": "5",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2,Application for GPSC 1-2",
      "rating": 4
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/cms/testimonials/:id

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
    "_id": "1",
    "name": "Sanjay",
    "title": "Test",
    "description": "Helpful Application for GPSC 1-2",
    "rating": 5
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/admin/cms/testimonials

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
  "name": "migration-api-test-1781511180577",
  "title": "before",
  "description": "desc before",
  "rating": 3
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "34",
    "name": "migration-api-test-1781511180577",
    "title": "before",
    "description": "desc before",
    "rating": 3
  }
}
```

---

## PUT /api/v1/admin/cms/testimonials/:id

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
  "title": "after",
  "description": "desc after",
  "rating": 5
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "34",
    "name": "migration-api-test-1781511180577",
    "title": "after",
    "description": "desc after",
    "rating": 5
  }
}
```

---

## DELETE /api/v1/admin/cms/testimonials/:id

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

## GET /api/v1/client/testimonials

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
      "_id": "1",
      "name": "Sanjay",
      "title": "Test",
      "description": "Helpful Application for GPSC 1-2",
      "rating": 5
    },
    {
      "_id": "2",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2",
      "rating": 4
    },
    {
      "_id": "3",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2",
      "rating": 4
    },
    {
      "_id": "4",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2,Application for GPSC 1-2",
      "rating": 4
    },
    {
      "_id": "5",
      "name": "Sanjay Chaudhary",
      "title": "Amazing",
      "description": "Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2.Helpful Application for GPSC 1-2,Application for GPSC 1-2",
      "rating": 4
    }
  ]
}
```

---
