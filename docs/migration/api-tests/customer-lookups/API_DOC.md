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
      "name": "Gujarat ઇવેન્ટ્સ",
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
        "_id": "18",
        "title": "ACF|RFO",
        "image": "",
        "labels": []
      },
      {
        "_id": "11",
        "title": "BinSachivalay",
        "image": "",
        "labels": []
      },
      {
        "_id": "6",
        "title": "Constable",
        "image": "",
        "labels": []
      },
      {
        "_id": "19",
        "title": "Defence",
        "image": "",
        "labels": [
          {
            "_id": "1",
            "name": "Teaching"
          },
          {
            "_id": "2",
            "name": "Teaching 2"
          }
        ]
      },
      {
        "_id": "2",
        "title": "Dy.So",
        "image": "https://www.gpsconline.com/uploads/qcategory/history.png",
        "labels": []
      },
      {
        "_id": "10",
        "title": "FHW|MPHW",
        "image": "",
        "labels": []
      },
      {
        "_id": "16",
        "title": "Forest Guard",
        "image": "",
        "labels": []
      },
      {
        "_id": "17",
        "title": "Forester",
        "image": "",
        "labels": []
      },
      {
        "_id": "20",
        "title": "Government",
        "image": "",
        "labels": []
      },
      {
        "_id": "1",
        "title": "GPSC Class 1/2",
        "image": "https://www.gpsconline.com/uploads/qcategory/history.png",
        "labels": []
      },
      {
        "_id": "7",
        "title": "GSSSB",
        "image": "",
        "labels": []
      },
      {
        "_id": "14",
        "title": "Hd.Clerk",
        "image": "",
        "labels": []
      },
      {
        "_id": "13",
        "title": "Jr.Clerk",
        "image": "",
        "labels": []
      },
      {
        "_id": "4",
        "title": "PI",
        "image": "https://www.gpsconline.com/uploads/qcategory/history.png",
        "labels": []
      },
      {
        "_id": "5",
        "title": "PSI",
        "image": "",
        "labels": []
      },
      {
        "_id": "12",
        "title": "Sr.Clerk",
        "image": "",
        "labels": []
      },
      {
        "_id": "3",
        "title": "STI",
        "image": "https://www.gpsconline.com/uploads/qcategory/history.png",
        "labels": []
      },
      {
        "_id": "15",
        "title": "STO",
        "image": "",
        "labels": []
      },
      {
        "_id": "8",
        "title": "Talati",
        "image": "",
        "labels": []
      },
      {
        "_id": "9",
        "title": "TET and TAT",
        "image": "",
        "labels": []
      },
      {
        "_id": "21",
        "title": "UPSCS",
        "image": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/profiles/1782893335006-image.jpg",
        "labels": [
          {
            "_id": "2",
            "name": "Dy"
          },
          {
            "_id": "1",
            "name": "Dy.so"
          }
        ]
      }
    ]
  }
}
```

---
