# exam-category-pivot — API reference

> Auto-generated from a passing `migration:api` run for **exam-category-pivot**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 5

---

## GET /api/v1/client/quizzes/categories/:id/exams

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
    "subjects": [],
    "exams": [
      {
        "_id": "300001",
        "title": "test",
        "type": "subject",
        "isPaid": false,
        "durationMinutes": 1,
        "questionCount": 1,
        "positiveMarks": 1,
        "negativeMarks": -1,
        "startAt": "2026-07-10T12:37:51.000Z",
        "endAt": "2026-08-09T13:37:51.000Z",
        "orderBy": 2,
        "createdAt": "2025-07-31T14:45:26.000Z",
        "isCompleted": false,
        "lastResult": null
      }
    ],
    "completedTests": []
  },
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/exam-categories/:id/exams

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
    "category": {
      "_id": "6",
      "name": "Indian Polity(Beginner)",
      "image": "indian_polity_beginner.png",
      "orderBy": 1
    },
    "list": [
      {
        "_id": "300001",
        "title": "test",
        "type": "subject",
        "isPaid": false,
        "durationMinutes": 1,
        "questionCount": 1,
        "positiveMarks": 1,
        "negativeMarks": -1,
        "startAt": "2026-07-10T12:37:51.000Z",
        "endAt": "2026-08-09T13:37:51.000Z",
        "orderBy": 2,
        "createdAt": "2025-07-31T14:45:26.000Z",
        "isCompleted": false,
        "lastResult": null
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

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/quizzes

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Query parameters
```json
{
  "categoryId": "6",
  "limit": 50
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": [
    {
      "_id": "300001",
      "title": "test",
      "description": null,
      "type": "subject",
      "isPaid": false,
      "categoryId": "1637",
      "durationMinutes": 1,
      "questionCount": 1,
      "positiveMarks": 1,
      "negativeMarks": -1,
      "solutionPdfUrl": "sample-local-pdf.pdf",
      "solutionPdfName": null,
      "startAt": "2026-07-10T12:37:51.000Z",
      "endAt": "2026-08-09T13:37:51.000Z",
      "status": true,
      "orderBy": 2,
      "createdAt": "2025-07-31T14:45:26.000Z",
      "updatedAt": "2026-07-10T13:36:22.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/exam-categories/:id/children

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
      "_id": "6",
      "title": "Indian Polity(Beginner)",
      "name": "Indian Polity(Beginner)",
      "image": "indian_polity_beginner.png",
      "parent": 0,
      "order": 1,
      "status": true,
      "createdAt": "2020-08-28T06:37:39.000Z",
      "updatedAt": "2020-08-28T06:37:39.000Z"
    },
    "list": []
  },
  "pagination": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "totalPages": 0
  }
}
```

---

## PUT /api/v1/admin/quizzes/:id

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
  "categoryId": "6",
  "title": "test"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "300001",
    "title": "test",
    "description": null,
    "type": "subject",
    "isPaid": false,
    "categoryId": "6",
    "durationMinutes": 1,
    "questionCount": 1,
    "positiveMarks": 1,
    "negativeMarks": -1,
    "solutionPdfUrl": "sample-local-pdf.pdf",
    "solutionPdfName": null,
    "startAt": "2026-07-10T12:37:51.000Z",
    "endAt": "2026-08-09T13:37:51.000Z",
    "status": true,
    "orderBy": 2,
    "createdAt": "2025-07-31T14:45:26.000Z",
    "updatedAt": "2026-07-10T13:37:51.000Z"
  }
}
```

---
