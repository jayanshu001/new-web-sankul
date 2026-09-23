# package — API reference

> Auto-generated from a passing `migration:api` run for **package**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 4

---

## GET /api/v1/admin/packages

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
      "_id": "990093",
      "name": "Package 3",
      "subtitle": "",
      "description": "",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1784033048631-image.jpeg",
      "shareableLink": "",
      "withMaterialText": "",
      "withoutMaterialText": "",
      "order": 0,
      "active": true,
      "isPaid": true,
      "isPopular": true,
      "packageTypeId": {
        "_id": "3",
        "name": "Planner Course"
      },
      "goalId": "21",
      "goalLabelId": "Dy",
      "isIndividual": false,
      "examCountdownCategoryIds": [],
      "examCountdownIds": [],
      "packageCategoryId": null,
      "educatorId": null,
      "pcMaterialId": null,
      "notificationTopic": "",
      "createdAt": "2026-07-14T18:13:42.000+05:30",
      "updatedAt": "2026-07-16T14:13:22.000+05:30",
      "plans": {
        "withMaterial": [
          {
            "_id": "1446",
            "packageId": "990093",
            "name": null,
            "duration": 30,
            "price": 299,
            "withMaterial": true,
            "materialPrice": 150,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "mostPopularPinned": false,
            "createdAt": "2026-07-14T18:13:43.000+05:30",
            "updatedAt": "2026-07-21T17:30:02.000+05:30"
          }
        ],
        "withoutMaterial": [
          {
            "_id": "1447",
            "packageId": "990093",
            "name": null,
            "duration": 30,
            "price": 69,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "mostPopularPinned": false,
            "createdAt": "2026-07-14T18:13:43.000+05:30",
            "updatedAt": "2026-07-16T12:30:38.000+05:30"
          }
        ]
      }
    },
    {
      "_id": "990092",
      "name": "Package 2",
      "subtitle": "",
      "description": "",
      "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1783950651721-image.webp",
      "shareableLink": "",
      "withMaterialText": "",
      "withoutMaterialText": "",
      "order": 0,
      "active": true,
      "isPaid": true,
      "isPopular": true,
      "packageTypeId": {
        "_id": "4",
        "name": "Smart Course"
      },
      "goalId": "20",
      "goalLabelId": null,
      "isIndividual": true,
      "examCountdownCategoryIds": [],
      "examCountdownIds": [],
      "packageCategoryId": null,
      "educatorId": null,
      "pcMaterialId": null,
      "notificationTopic": "",
      "createdAt": "2026-07-13T19:20:26.000+05:30",
      "updatedAt": "2026-07-16T14:11:34.000+05:30",
      "plans": {
        "withMaterial": [],
        "withoutMaterial": [
          {
            "_id": "1445",
            "packageId": "990092",
            "name": null,
            "duration": 30,
            "price": 250,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "mostPopularPinned": false,
            "createdAt": "2026-07-13T19:20:27.000+05:30",
            "updatedAt": "2026-07-21T17:30:02.000+05:30"
          }
        ]
      }
    }
  ],
  "pagination": {
    "total": 7,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  },
  "_note": "array truncated for docs — 7 items total; first 2 shown"
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/packages/types

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
      "createdAt": "2023-02-27T14:14:56.000+05:30",
      "updatedAt": "2026-07-11T11:59:15.000+05:30"
    },
    {
      "_id": "1",
      "name": "Single Course",
      "createdAt": "2023-02-27T14:14:10.000+05:30",
      "updatedAt": "2026-07-11T11:54:04.000+05:30"
    },
    {
      "_id": "4",
      "name": "Smart Course",
      "createdAt": "2023-02-27T14:14:56.000+05:30",
      "updatedAt": "2026-07-11T11:59:20.000+05:30"
    },
    {
      "_id": "2",
      "name": "Subject wise Course",
      "createdAt": "2023-02-27T14:14:10.000+05:30",
      "updatedAt": "2023-02-27T14:14:10.000+05:30"
    }
  ]
}
```

---

## GET /api/v1/admin/packages/:id

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
    "_id": "990093",
    "name": "Package 3",
    "subtitle": "",
    "description": "",
    "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1784033048631-image.jpeg",
    "shareableLink": "",
    "withMaterialText": "",
    "withoutMaterialText": "",
    "order": 0,
    "active": true,
    "isPaid": true,
    "isPopular": true,
    "packageTypeId": {
      "_id": "3",
      "name": "Planner Course"
    },
    "goalId": "21",
    "goalLabelId": "Dy",
    "isIndividual": false,
    "examCountdownCategoryIds": [],
    "examCountdownIds": [],
    "packageCategoryId": null,
    "educatorId": null,
    "pcMaterialId": null,
    "notificationTopic": "",
    "specificSubjects": [
      {
        "category": {
          "_id": "107",
          "title": "English Grammar - Saunak Patel",
          "image": "English_Grammar_saunaksir.png"
        },
        "order": 0,
        "status": true
      },
      {
        "category": {
          "_id": "166",
          "title": "English Vocabs - Saunak Patel",
          "image": "Vocab_Saunaksir.png"
        },
        "order": 1,
        "status": true
      },
      {
        "category": {
          "_id": "295",
          "title": "Old courses",
          "image": "old_course.png"
        },
        "order": 2,
        "status": true
      },
      {
        "category": {
          "_id": "3163",
          "title": "New One",
          "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1784116678717-image.jpeg"
        },
        "order": 3,
        "status": true
      },
      {
        "category": {
          "_id": "278",
          "title": "GSSSB Paper Solutions",
          "image": "GSSSB_Paper_Solutions.png"
        },
        "order": 4,
        "status": true
      }
    ],
    "materialCategories": [
      {
        "category": {
          "_id": "270",
          "title": "Current Affairs - Manish Sindhi Lectures PDF",
          "image": "MAINS@0.3x.png"
        },
        "order": 0,
        "status": true
      },
      {
        "category": {
          "_id": "949",
          "title": "GSRTC Conductor Lectures PDF",
          "image": "gsssb.png"
        },
        "order": 1,
        "status": true
      }
    ],
    "examCategories": [
      {
        "category": {
          "_id": "124",
          "title": "Lecture Test for GPSC Batch",
          "image": "1665552699_5 MEGA TEST@0.3x.png"
        },
        "order": 0,
        "status": true
      },
      {
        "category": {
          "_id": "108",
          "title": "Smart Study Plan Test ",
          "image": "1665552762_4GPOCA MONTH@0.3x.png"
        },
        "order": 1,
        "status": true
      }
    ],
    "createdAt": "2026-07-14T18:13:42.000+05:30",
    "updatedAt": "2026-07-16T14:13:22.000+05:30"
  },
  "message": "",
  "messages": {}
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## PATCH /api/v1/admin/packages/:id/status

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
    "active": false
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---
