# customer-lookups — API reference

> Auto-generated from a passing `migration:api` run for **customer-lookups**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 3

---

## GET /api/v1/client/address/states

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
      "name": "Andhra Pradesh",
      "stateCode": "AP"
    },
    {
      "_id": "3",
      "name": "Arunachal Pradesh",
      "stateCode": "AR"
    },
    {
      "_id": "4",
      "name": "Assam",
      "stateCode": "AS"
    },
    {
      "_id": "5",
      "name": "Bihar",
      "stateCode": "BR"
    },
    {
      "_id": "6",
      "name": "Chandigarh",
      "stateCode": "CH"
    },
    {
      "_id": "7",
      "name": "Chhattisgarh",
      "stateCode": "CT"
    },
    {
      "_id": "8",
      "name": "Dadra and Nagar Haveli and Daman and Diu",
      "stateCode": "DH"
    },
    {
      "_id": "9",
      "name": "Delhi",
      "stateCode": "DL"
    },
    {
      "_id": "10",
      "name": "Goa",
      "stateCode": "GA"
    },
    {
      "_id": "13",
      "name": "Gujarat",
      "stateCode": "GJ"
    },
    {
      "_id": "11",
      "name": "Haryana",
      "stateCode": "HR"
    },
    {
      "_id": "12",
      "name": "Himachal Pradesh",
      "stateCode": "HP"
    }
  ]
}
```

_(3 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/address/educations

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
      "name": "10+2 or Equivalent"
    },
    {
      "_id": "1",
      "name": "10th Standard or Equivalent"
    },
    {
      "_id": "3",
      "name": "Diploma in any Discipline"
    },
    {
      "_id": "10",
      "name": "Doctorate in any Discipline"
    },
    {
      "_id": "5",
      "name": "Graduate in any Medical Sciences"
    },
    {
      "_id": "4",
      "name": "Graduate in Non Medical Sciences"
    },
    {
      "_id": "9",
      "name": "M.Phill. in any Discipline"
    },
    {
      "_id": "6",
      "name": "Post Graduate Diploma in Any Discipline"
    },
    {
      "_id": "8",
      "name": "Post Graduate in any Medical Sciences"
    },
    {
      "_id": "7",
      "name": "Post Graduate in Non Medical Sciences"
    }
  ]
}
```

---

## GET /api/v1/client/address/characteristic

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
    "educations": [
      {
        "_id": "2",
        "name": "10+2 or Equivalent"
      },
      {
        "_id": "1",
        "name": "10th Standard or Equivalent"
      },
      {
        "_id": "3",
        "name": "Diploma in any Discipline"
      },
      {
        "_id": "10",
        "name": "Doctorate in any Discipline"
      },
      {
        "_id": "5",
        "name": "Graduate in any Medical Sciences"
      },
      {
        "_id": "4",
        "name": "Graduate in Non Medical Sciences"
      },
      {
        "_id": "9",
        "name": "M.Phill. in any Discipline"
      },
      {
        "_id": "6",
        "name": "Post Graduate Diploma in Any Discipline"
      },
      {
        "_id": "8",
        "name": "Post Graduate in any Medical Sciences"
      },
      {
        "_id": "7",
        "name": "Post Graduate in Non Medical Sciences"
      }
    ],
    "goals": []
  }
}
```

---
