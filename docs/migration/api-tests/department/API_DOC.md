# department — API reference

> Auto-generated from a passing `migration:api` run for **department**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 5

---

## GET /api/v1/admin/departments

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
      "_id": "1",
      "name": "HelpLine Numbers",
      "description": "For App Purchase",
      "order": 1,
      "active": true,
      "contacts": [
        {
          "mobile": "+917777991357",
          "order": 1,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 63 58 28 98 97",
          "order": 2,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 77 77 99 13 52",
          "order": 3,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 77 77 99 13 67",
          "order": 4,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 63 56 23 91 65",
          "order": 5,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 90 54 52 27 74",
          "order": 6,
          "active": false,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 90 54 52 27 75",
          "order": 7,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 90 54 52 27 79",
          "order": 8,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 90 54 52 27 76",
          "order": 9,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        }
      ]
    },
    {
      "_id": "2",
      "name": "Technical Helpline Number",
      "description": "For Technical Issue",
      "order": 1,
      "active": true,
      "contacts": [
        {
          "mobile": "+91 70 964 964 85",
          "order": 1,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        }
      ]
    },
    {
      "_id": "3",
      "name": "Publication Helpline Number",
      "description": "For Book or E-Book",
      "order": 1,
      "active": true,
      "contacts": [
        {
          "mobile": "+91 77 77 99 13 48",
          "order": 1,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        }
      ]
    },
    {
      "_id": "4",
      "name": "Offline Classes Helpline Number",
      "description": "For Offline Classes",
      "order": 1,
      "active": true,
      "contacts": [
        {
          "mobile": "+91 96 24 94 39 20",
          "order": 1,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        },
        {
          "mobile": "+91 90 54 52 27 79",
          "order": 2,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        }
      ]
    },
    {
      "_id": "5",
      "name": "migration-api-test-1780734666526",
      "description": "desc before",
      "order": 99,
      "active": true,
      "contacts": [
        {
          "mobile": "+910000000001",
          "order": 1,
          "active": true,
          "isCallAvailable": true,
          "isWhatsAppAvailable": true
        }
      ]
    }
  ]
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## POST /api/v1/admin/departments

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
  "name": "migration-api-test-1781511180609",
  "description": "desc before",
  "order": 99,
  "active": true,
  "contacts": [
    {
      "mobile": "+910000000001",
      "order": 1,
      "active": true,
      "isCallAvailable": true,
      "isWhatsAppAvailable": false
    }
  ]
}
```

### Response (`201`)
```json
{
  "success": true,
  "data": {
    "_id": "31",
    "name": "migration-api-test-1781511180609",
    "description": "desc before",
    "order": 99,
    "active": true,
    "contacts": [
      {
        "mobile": "+910000000001",
        "order": 1,
        "active": true,
        "isCallAvailable": true,
        "isWhatsAppAvailable": false
      }
    ]
  }
}
```

---

## PUT /api/v1/admin/departments/:id

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
  "description": "desc after",
  "contacts": [
    {
      "mobile": "+910000000002",
      "order": 1,
      "active": true,
      "isCallAvailable": false,
      "isWhatsAppAvailable": true
    },
    {
      "mobile": "+910000000003",
      "order": 2,
      "active": false,
      "isCallAvailable": true,
      "isWhatsAppAvailable": true
    }
  ]
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": {
    "_id": "31",
    "name": "migration-api-test-1781511180609",
    "description": "desc after",
    "order": 99,
    "active": true,
    "contacts": [
      {
        "mobile": "+910000000002",
        "order": 1,
        "active": true,
        "isCallAvailable": false,
        "isWhatsAppAvailable": true
      },
      {
        "mobile": "+910000000003",
        "order": 2,
        "active": false,
        "isCallAvailable": true,
        "isWhatsAppAvailable": true
      }
    ]
  }
}
```

---

## DELETE /api/v1/admin/departments/:id

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
  "message": "Department deleted."
}
```

---

## GET /api/v1/client/contactus

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
    "departments": [
      {
        "_id": "1",
        "name": "HelpLine Numbers",
        "description": "For App Purchase",
        "order": 1,
        "active": true,
        "contacts": [
          {
            "mobile": "+917777991357",
            "order": 1,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 63 58 28 98 97",
            "order": 2,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 77 77 99 13 52",
            "order": 3,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 77 77 99 13 67",
            "order": 4,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 63 56 23 91 65",
            "order": 5,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 90 54 52 27 75",
            "order": 7,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 90 54 52 27 79",
            "order": 8,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 90 54 52 27 76",
            "order": 9,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          }
        ]
      },
      {
        "_id": "2",
        "name": "Technical Helpline Number",
        "description": "For Technical Issue",
        "order": 1,
        "active": true,
        "contacts": [
          {
            "mobile": "+91 70 964 964 85",
            "order": 1,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          }
        ]
      },
      {
        "_id": "3",
        "name": "Publication Helpline Number",
        "description": "For Book or E-Book",
        "order": 1,
        "active": true,
        "contacts": [
          {
            "mobile": "+91 77 77 99 13 48",
            "order": 1,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          }
        ]
      },
      {
        "_id": "4",
        "name": "Offline Classes Helpline Number",
        "description": "For Offline Classes",
        "order": 1,
        "active": true,
        "contacts": [
          {
            "mobile": "+91 96 24 94 39 20",
            "order": 1,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          },
          {
            "mobile": "+91 90 54 52 27 79",
            "order": 2,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          }
        ]
      },
      {
        "_id": "5",
        "name": "migration-api-test-1780734666526",
        "description": "desc before",
        "order": 99,
        "active": true,
        "contacts": [
          {
            "mobile": "+910000000001",
            "order": 1,
            "active": true,
            "isCallAvailable": true,
            "isWhatsAppAvailable": true
          }
        ]
      }
    ]
  }
}
```

---
