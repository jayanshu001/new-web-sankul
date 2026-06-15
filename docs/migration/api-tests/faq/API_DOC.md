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
  ],
  "_note": "array truncated for docs — 18 items total; first 2 shown"
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
  "question": "migration-api-test-1781511180478",
  "answer": "test answer",
  "isExpand": false
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "83",
    "type": "general",
    "typeId": {
      "_id": "general",
      "title": "General"
    },
    "question": "migration-api-test-1781511180478",
    "answer": "test answer",
    "isExpand": false,
    "createdAt": "2026-06-15T08:13:00.000Z",
    "updatedAt": "2026-06-15T08:13:00.000Z"
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
    "_id": "84",
    "type": "referral",
    "typeId": {
      "_id": "referral",
      "title": "Referral"
    },
    "question": "migration-put-1781511180490",
    "answer": "after",
    "isExpand": false,
    "createdAt": "2026-06-15T08:13:00.000Z",
    "updatedAt": "2026-06-15T08:13:00.000Z"
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
    },
    {
      "_id": "38",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "કોર્સ ખરીદ્યા પછી તેની વેલિડિટી કેટલા સમય સુધી રહેશે?",
      "answer": "દરેક કોર્સની વેલિડિટી તેના પ્લાન મુજબ અલગ-અલગ હોય છે. કોર્સ ખરીદતી વખતે પ્લાનની વિગતમાં વેલિડિટી (દિવસોમાં) દર્શાવેલ હોય છે. વેલિડિટી પૂરી થયા પછી કોર્સ ફરી ખરીદવો પડશે.",
      "isExpand": false,
      "createdAt": "2026-06-06T10:40:31.000Z",
      "updatedAt": "2026-06-06T10:40:31.000Z"
    },
    {
      "_id": "39",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "શું હું એક જ એકાઉન્ટ બે ડિવાઇસમાં વાપરી શકું?",
      "answer": "સુરક્ષાના કારણોસર એક એકાઉન્ટ એક સમયે એક જ ડિવાઇસમાં લોગિન રહી શકે છે. નવા ડિવાઇસમાં લોગિન કરતાં જૂના ડિવાઇસમાંથી આપોઆપ લોગઆઉટ થઈ જશે.",
      "isExpand": false,
      "createdAt": "2026-06-06T10:40:31.000Z",
      "updatedAt": "2026-06-06T10:40:31.000Z"
    },
    {
      "_id": "40",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "વિડિયો લેક્ચર ડાઉનલોડ કરીને ઓફલાઇન જોઈ શકાય?",
      "answer": "હા, એપ્લિકેશનમાં ઉપલબ્ધ વિડિયો લેક્ચર ડાઉનલોડ કરીને ઓફલાઇન જોઈ શકાય છે. ડાઉનલોડ કરેલા વિડિયો ફક્ત એપ્લિકેશનની અંદર જ ચાલશે.",
      "isExpand": false,
      "createdAt": "2026-06-06T10:40:31.000Z",
      "updatedAt": "2026-06-06T10:40:31.000Z"
    },
    {
      "_id": "41",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "પેમેન્ટ થઈ ગયું પણ કોર્સ એક્ટિવ ન થયો તો શું કરવું?",
      "answer": "જો પેમેન્ટ કપાઈ ગયું હોય અને કોર્સ એક્ટિવ ન થયો હોય તો થોડી વાર રાહ જુઓ. 24 કલાકમાં રકમ આપમેળે પાછી ન આવે અથવા કોર્સ એક્ટિવ ન થાય તો અમારી સપોર્ટ ટીમનો સંપર્ક કરો.",
      "isExpand": false,
      "createdAt": "2026-06-06T10:40:31.000Z",
      "updatedAt": "2026-06-06T10:40:31.000Z"
    },
    {
      "_id": "42",
      "type": "general",
      "typeId": {
        "_id": "general",
        "title": "General"
      },
      "question": "સ્ટડી મટિરિયલ અને નોટ્સ ક્યાંથી મળશે?",
      "answer": "ખરીદેલા કોર્સ સાથે જોડાયેલ સ્ટડી મટિરિયલ અને નોટ્સ કોર્સની અંદર 'મટિરિયલ' વિભાગમાં ઉપલબ્ધ રહેશે, જે તમે જોઈ અને ડાઉનલોડ કરી શકશો.",
      "isExpand": false,
      "createdAt": "2026-06-06T10:40:31.000Z",
      "updatedAt": "2026-06-06T10:40:31.000Z"
    }
  ]
}
```

_(2 calls captured for this endpoint; first shown.)_

---
