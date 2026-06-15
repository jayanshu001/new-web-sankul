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
    "goals": [
      {
        "_id": "69cd4e7609a4b50b9ee0af43",
        "title": "Civil Services Exams (Updated)",
        "labels": [
          {
            "name": "UPSC Civil Service",
            "_id": "69cd4e7609a4b50b9ee0af44"
          },
          {
            "name": "Brand New Label",
            "_id": "69ce1cbfa7699d81bb7b9a62"
          }
        ],
        "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1775062646551-image.png"
      },
      {
        "_id": "69cf8e1ee046cfd81a5341b5",
        "title": "New Civil Services Exams",
        "labels": [
          {
            "name": "UPSC",
            "_id": "69cf8e1ee046cfd81a5341b6"
          },
          {
            "name": "UPSC CAPF AC",
            "_id": "69cf8e1ee046cfd81a5341b7"
          },
          {
            "name": "UPPCS",
            "_id": "69cf8e1ee046cfd81a5341b8"
          }
        ],
        "image": null
      },
      {
        "_id": "69d4a0d1da1d4fe36fe9146c",
        "title": "UPSC",
        "labels": [
          {
            "name": "Exams",
            "_id": "69d4a491da1d4fe36fe9149b"
          }
        ],
        "image": null
      },
      {
        "_id": "69d755850ef42dd2158bb41c",
        "title": "Career Growth Updated",
        "labels": [
          {
            "name": "Interview Prep",
            "_id": "6a183b7b0020f03b3cf75c23"
          },
          {
            "name": "Communications",
            "_id": "6a183b7b0020f03b3cf75c24"
          }
        ],
        "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1779972986825-image.png"
      },
      {
        "_id": "6a183bc90020f03b3cf75c26",
        "title": "Defenses",
        "labels": [
          {
            "name": "Border",
            "_id": "6a183bc90020f03b3cf75c27"
          }
        ],
        "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1779973065559-image.webp"
      }
    ]
  }
}
```

---
