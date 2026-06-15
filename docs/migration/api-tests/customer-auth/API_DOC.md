# customer-auth — API reference

> Auto-generated from a passing `migration:api` run for **customer-auth**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 5

---

## POST /api/v1/client/auth/otp/generate

### Request headers
```json
{
  "Accept": "application/json",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "phoneNumber": "9664796376"
}
```

### Response (`200`)
```json
{
  "success": true,
  "code": 200,
  "data": {
    "isNewUser": false
  },
  "message": "OTP sent successfully.",
  "messages": {}
}
```

_(5 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/client/auth/otp/validate

### Request headers
```json
{
  "Accept": "application/json",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "phoneNumber": "9664796376",
  "otp": "5786",
  "os_type": "android"
}
```

### Response (`200`)
```json
{
  "success": true,
  "code": 200,
  "data": {
    "user": {
      "id": 472335,
      "firstName": "Piyush",
      "middleName": "",
      "lastName": "",
      "phoneNumber": "9664796376",
      "emailAddress": "piysu@gmail.com",
      "profilePicture": "twitter-image.png",
      "phone2": "0",
      "dob": "1970-01-01T00:00:00.000Z",
      "gender": "male",
      "stateId": "13",
      "districtId": "1",
      "city": "Gandhinagar",
      "educationId": "1",
      "language": "gujarati",
      "goals": [
        1,
        2
      ],
      "referralCode": "",
      "rewardPoints": 0,
      "osType": "android",
      "isNewUser": false,
      "isProfileCompleted": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTUxMTE4MCwiZXhwIjoxNzgyMTE1OTgwfQ.HaEA_VzFNGw7vp--q-42-2P4d4MGMaD9WDxrE7YRiD8",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTUxMTE4MCwiZXhwIjoxNzg2Njk1MTgwfQ.mj-yUgtKZwhd4EOTfOcTRX8oiu4gDNlZC_zAjY1_xq0",
    "isNewUser": false
  },
  "message": "Login successful.",
  "messages": {}
}
```

_(4 calls captured for this endpoint; first shown.)_

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

## POST /api/v1/client/auth/token/refresh

### Request headers
```json
{
  "Accept": "application/json",
  "Content-Type": "application/json"
}
```

### Request body
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTUxMTE4MCwiZXhwIjoxNzg2Njk1MTgwfQ.mj-yUgtKZwhd4EOTfOcTRX8oiu4gDNlZC_zAjY1_xq0"
}
```

### Response (`200`)
```json
{
  "success": true,
  "code": 200,
  "data": {
    "user": {
      "id": 472335,
      "firstName": "Piyush",
      "middleName": "",
      "lastName": "",
      "phoneNumber": "9664796376",
      "emailAddress": "piysu@gmail.com",
      "profilePicture": "twitter-image.png",
      "phone2": "0",
      "dob": "1970-01-01T00:00:00.000Z",
      "gender": "male",
      "stateId": "13",
      "districtId": "1",
      "city": "Gandhinagar",
      "educationId": "1",
      "language": "gujarati",
      "goals": [
        1,
        2
      ],
      "referralCode": "",
      "rewardPoints": 0,
      "osType": "android",
      "isNewUser": false,
      "isProfileCompleted": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTUxMTE4MCwiZXhwIjoxNzgyMTE1OTgwfQ.HaEA_VzFNGw7vp--q-42-2P4d4MGMaD9WDxrE7YRiD8",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MTUxMTE4MCwiZXhwIjoxNzg2Njk1MTgwfQ.mj-yUgtKZwhd4EOTfOcTRX8oiu4gDNlZC_zAjY1_xq0",
    "isNewUser": false
  },
  "message": "Token refreshed successfully.",
  "messages": {}
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## DELETE /api/v1/client/auth/logout

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
  "data": {},
  "message": "Logged out successfully.",
  "messages": {}
}
```

---
