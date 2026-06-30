# faq — API reference

> Auto-generated from a passing `migration:api` run for **faq**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 9

---

## GET /api/v1/admin/cms/faq-types

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
      "_id": "general",
      "title": "General"
    },
    {
      "_id": "referral",
      "title": "Referral"
    }
  ]
}
```

---

## DELETE /api/v1/admin/cms/faq-types/general

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
  "message": "FAQ categories are fixed (general, referral) on the legacy MySQL schema and cannot be deleted."
}
```

---

## GET /api/v1/admin/cms/faqs

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
      "_id": "15",
      "type": "referral",
      "typeId": {
        "_id": "referral",
        "title": "Referral"
      },
      "question": "Can I use rewards money in app?",
      "answer": "Yes, you can use rewards to purchase package and course. But you can not use reward to buy e-books, books and pendrive course",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    },
    {
      "_id": "14",
      "type": "referral",
      "typeId": {
        "_id": "referral",
        "title": "Referral"
      },
      "question": "What If I entered the wrong bank details?",
      "answer": "You will not get any rewards in your bank and Websankul will be not responsible for any issue.",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    }
  ],
  "_note": "array truncated for docs — 13 items total; first 2 shown"
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/admin/cms/faqs/:id

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
    "_id": "15",
    "type": "referral",
    "typeId": {
      "_id": "referral",
      "title": "Referral"
    },
    "question": "Can I use rewards money in app?",
    "answer": "Yes, you can use rewards to purchase package and course. But you can not use reward to buy e-books, books and pendrive course",
    "isExpand": false,
    "createdAt": "2023-02-10T17:35:43.000Z",
    "updatedAt": "2023-02-10T17:35:43.000Z"
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/admin/cms/faqs

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
  "type": "general",
  "question": "migration-api-test-1782835532168",
  "answer": "test answer",
  "isExpand": false
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "24",
    "type": "general",
    "typeId": {
      "_id": "general",
      "title": "General"
    },
    "question": "migration-api-test-1782835532168",
    "answer": "test answer",
    "isExpand": false,
    "createdAt": "2026-06-30T16:05:32.000Z",
    "updatedAt": "2026-06-30T16:05:32.000Z"
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## DELETE /api/v1/admin/cms/faqs/:id

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

_(2 calls captured for this endpoint; first shown.)_

---

## PUT /api/v1/admin/cms/faqs/:id

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
  "answer": "after",
  "isExpand": false
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "25",
    "type": "referral",
    "typeId": {
      "_id": "referral",
      "title": "Referral"
    },
    "question": "migration-put-1782835532199",
    "answer": "after",
    "isExpand": false,
    "createdAt": "2026-06-30T16:05:32.000Z",
    "updatedAt": "2026-06-30T16:05:32.000Z"
  }
}
```

---

## GET /api/v1/client/faq-types

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
      "_id": "general",
      "title": "General"
    },
    {
      "_id": "referral",
      "title": "Referral"
    }
  ]
}
```

---

## GET /api/v1/client/faqs

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
  "type": "general"
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": [
    {
      "_id": "1",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "એપ્લિકેશનમાં કોર્સ કઈ રીતે ખરીદી શકાય?\n",
      "answer": "તમે એપ્લિકેશન માંથી જે કોર્સે ખરીદવો હોય એ ઓપન કરી અને ત્યાંથી પેમેન્ટ કરી ને કોર્સ ખરીદી કરી શકો .",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    },
    {
      "_id": "2",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "શું તમે Login Details Change કરી શકશો ?",
      "answer": "જેટલા સમય માટે તમે App Buy કરો છો તેટલા સમય સુધી તમે Login Details Change કરી શકશો નહિ.",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    },
    {
      "_id": "6",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "શું તમે Login Details Change કરી શકશો ?",
      "answer": "જેટલા સમય માટે તમે App Buy કરો છો તેટલા સમય સુધી તમે Login Details Change કરી શકશો નહિ.",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    },
    {
      "_id": "7",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "એપ્લિકેશનમાં કઈ રીતે ખરીદી શકાય?\n",
      "answer": "તમે એપ્લિકેશન માંથી જે કોર્સે ખરીદવો હોય એ ઓપન કરી અને ત્યાંથી પેમેન્ટ કરી ને કોર્સ ખરીદી કરી શકો .",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    },
    {
      "_id": "8",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "શું તમે Login Details Change કરી શકશો ?",
      "answer": "જેટલા સમય માટે તમે App Buy કરો છો તેટલા સમય સુધી તમે Login Details Change કરી શકશો નહિ.",
      "isExpand": false,
      "createdAt": "2023-02-10T17:35:43.000Z",
      "updatedAt": "2023-02-10T17:35:43.000Z"
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---
