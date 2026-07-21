# faq — API reference

> Auto-generated from a passing `migration:api` run for **faq**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 2

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
  ],
  "pagination": {
    "total": 2,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
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
    }
  ],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---
