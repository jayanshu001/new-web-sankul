# ebook — API reference

> Auto-generated from a passing `migration:api` run for **ebook**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 3

---

## GET /api/v1/admin/ebooks

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
      "_id": "49",
      "name": "EBook Two",
      "examCountdownCategoryId": null,
      "examCountdownCategoryIds": [],
      "examCountdownIds": [],
      "thumbnail": "",
      "image": "",
      "description": "<p>Descripiton</p>",
      "termsAndConditions": "",
      "author": "Author One",
      "publisher": "Author 2",
      "language": "English",
      "order": 0,
      "demoUrl": "",
      "bookUrl": "",
      "demoFileName": null,
      "bookFileName": null,
      "link": "https://www.jod.me",
      "isTrending": false,
      "status": true,
      "createdAt": "2026-07-21T14:03:19.000+05:30",
      "updatedAt": "2026-07-21T16:17:09.000+05:30"
    },
    {
      "_id": "48",
      "name": "EBook One",
      "examCountdownCategoryId": null,
      "examCountdownCategoryIds": [],
      "examCountdownIds": [],
      "thumbnail": "",
      "image": "",
      "description": "<p>Description</p>",
      "termsAndConditions": "",
      "author": "Cooper Conolly",
      "publisher": "Jayanshu",
      "language": "English",
      "order": 0,
      "demoUrl": "",
      "bookUrl": "",
      "demoFileName": null,
      "bookFileName": null,
      "link": "https://archive.org/details/anneofgreengable0000unse_p0z0/mode/2up?ref=ol",
      "isTrending": false,
      "status": true,
      "createdAt": "2026-07-21T13:59:58.000+05:30",
      "updatedAt": "2026-07-21T13:59:58.000+05:30"
    }
  ],
  "pagination": {
    "total": 506,
    "page": 1,
    "limit": 20,
    "totalPages": 26
  },
  "_note": "array truncated for docs — 20 items total; first 2 shown"
}
```

_(5 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/ebooks/:id

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
  "code": 200,
  "data": {
    "_id": "49",
    "name": "EBook Two",
    "examCountdownCategoryId": null,
    "examCountdownCategoryIds": [],
    "examCountdownIds": [],
    "thumbnail": "",
    "image": "",
    "description": "<p>Descripiton</p>",
    "termsAndConditions": "",
    "author": "Author One",
    "publisher": "Author 2",
    "language": "English",
    "order": 0,
    "demoUrl": "",
    "bookUrl": "",
    "demoFileName": null,
    "bookFileName": null,
    "link": "https://www.jod.me",
    "isTrending": false,
    "status": true,
    "createdAt": "2026-07-21T14:03:19.000+05:30",
    "updatedAt": "2026-07-21T16:17:09.000+05:30",
    "plans": [
      {
        "_id": "901",
        "ebookId": "49",
        "name": "3 month",
        "duration": 90,
        "price": 50,
        "isDefault": true,
        "status": true,
        "isMostPopular": false,
        "mostPopularPinned": false,
        "createdAt": "2023-03-10T23:27:20.000+05:30",
        "updatedAt": "2026-07-21T14:18:50.000+05:30"
      },
      {
        "_id": "902",
        "ebookId": "49",
        "name": "6 month",
        "duration": 180,
        "price": 100,
        "isDefault": false,
        "status": true,
        "isMostPopular": false,
        "mostPopularPinned": false,
        "createdAt": "2023-03-10T23:27:29.000+05:30",
        "updatedAt": "2026-07-21T14:18:50.000+05:30"
      },
      {
        "_id": "1450",
        "ebookId": "49",
        "name": null,
        "duration": 30,
        "price": 399,
        "isDefault": false,
        "status": true,
        "isMostPopular": false,
        "mostPopularPinned": false,
        "createdAt": "2026-07-21T14:03:19.000+05:30",
        "updatedAt": "2026-07-21T14:18:50.000+05:30"
      }
    ]
  },
  "message": "",
  "messages": {}
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## PATCH /api/v1/admin/ebooks/:id/trending

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
    "isTrending": true
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---
