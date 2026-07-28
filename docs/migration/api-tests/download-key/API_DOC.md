# download-key — API reference

> Auto-generated from a passing `migration:api` run for **download-key**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 3

---

## GET /api/v1/client/downloads/encryption-key

### Request headers
```json
{
  "Accept": "application/json"
}
```

### Response (`401`)
```json
{
  "success": false,
  "code": 401,
  "data": {},
  "message": "Authentication token is required.",
  "messages": {}
}
```

_(10 calls captured for this endpoint; first shown.)_

---

## PUT /api/v1/client/downloads/encryption-key

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
  "key": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"
}
```

### Response (`401`)
```json
{
  "success": false,
  "code": 401,
  "data": {},
  "message": "Authentication token is required.",
  "messages": {}
}
```

_(17 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/profile

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
    "id": "472335",
    "firstName": "Piyush",
    "middleName": "",
    "lastName": "",
    "phoneNumber": "9664796376",
    "emailAddress": "piysu@gmail.com",
    "profilePicture": "twitter-image.png"
  },
  "message": "Profile fetched successfully.",
  "messages": {}
}
```

---
