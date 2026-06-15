# version — API reference

> Auto-generated from a passing `migration:api` run for **version**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 4

---

## GET /api/v1/admin/cms/version

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
    "latestVersionCode": 40976,
    "lastSupportedVersionCode": 40976
  }
}
```

_(4 calls captured for this endpoint; first shown.)_

---

## PUT /api/v1/admin/cms/version

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
  "latestVersionCode": 40977,
  "lastSupportedVersionCode": 40976
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "1",
    "latestVersionCode": 40977,
    "lastSupportedVersionCode": 40976
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/version

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
    "latestVersionCode": 40976,
    "lastSupportedVersionCode": 40976
  }
}
```

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
