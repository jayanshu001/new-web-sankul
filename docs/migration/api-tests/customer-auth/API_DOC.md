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
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MjgzNTUzMywiZXhwIjoxNzgzNDQwMzMzfQ.60Wgl8vyup2EdzVpbbV72_y593KMA5qw46h_3RysvMw",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MjgzNTUzMywiZXhwIjoxNzg4MDE5NTMzfQ.W0_3bXRQ3SfZQiszv6LlZAf7AYtqf5Xu7zUhTqmKqeE",
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
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MjgzNTUzMywiZXhwIjoxNzg4MDE5NTMzfQ.W0_3bXRQ3SfZQiszv6LlZAf7AYtqf5Xu7zUhTqmKqeE"
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
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MjgzNTUzMywiZXhwIjoxNzgzNDQwMzMzfQ.60Wgl8vyup2EdzVpbbV72_y593KMA5qw46h_3RysvMw",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ3MjMzNSIsInBob25lIjoiOTY2NDc5NjM3NiIsInJvbGUiOiJjdXN0b21lciIsInR5cGUiOiJjdXN0b21lciIsImlhdCI6MTc4MjgzNTUzMywiZXhwIjoxNzg4MDE5NTMzfQ.W0_3bXRQ3SfZQiszv6LlZAf7AYtqf5Xu7zUhTqmKqeE",
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
