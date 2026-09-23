# app-update — API reference

> Auto-generated from a passing `migration:api` run for **app-update**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 3

---

## GET /api/v1/admin/cms/app-update

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
    "latestVersion": 4235200,
    "updateType": "flexible",
    "isUpdateAvailable": false
  }
}
```

_(4 calls captured for this endpoint; first shown.)_

---

## PUT /api/v1/admin/cms/app-update

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
  "latestVersion": 4235201,
  "updateType": "flexible",
  "isUpdateAvailable": false
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "1",
    "latestVersion": 4235201,
    "updateType": "flexible",
    "isUpdateAvailable": false
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/upgrade

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
  "clientVersion": 40000
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "clientVersion": 40000,
    "latestVersion": 4235200,
    "lastSupportedVersion": 40976,
    "updateType": "flexible",
    "isUpdateAvailable": false,
    "isForceUpdate": true
  }
}
```

---
