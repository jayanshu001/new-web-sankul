# catalog-ebook — API reference

> Auto-generated from a passing `migration:api` run for **catalog-ebook**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 2

---

## GET /api/v1/client/ebooks

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
    "ebooks": [
      {
        "_id": "45",
        "name": "test",
        "thumbnail": "twitter-image.png",
        "image": "twitter-image.png",
        "description": "s",
        "termsAndConditions": "s",
        "author": "test",
        "publisher": "test",
        "language": "Gujarati",
        "order": 1,
        "demoUrl": "https://websankul.blr1.cdn.digitaloceanspaces.com/uploads/e-books/demo_book/EMr38Ghw9lKdRQ73BHSsFjoZF.pdf",
        "bookUrl": "https://websankul.blr1.cdn.digitaloceanspaces.com/uploads/e-books/full_book/AKJqkwjJZK5bH820hjEsuKLKN.pdf",
        "link": "http://websankul.com",
        "status": true,
        "isTrending": false,
        "createdAt": "2025-08-01T12:43:54.000Z",
        "updatedAt": "2025-08-01T12:43:54.000Z",
        "plans": [
          {
            "_id": "1438",
            "ebookId": "45",
            "name": "test",
            "duration": 30,
            "price": 3000,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "createdAt": "2025-08-01T12:43:49.000Z",
            "updatedAt": "2025-08-01T12:43:54.000Z"
          },
          {
            "_id": "855",
            "ebookId": "45",
            "name": "3 month",
            "duration": 90,
            "price": 70,
            "isDefault": true,
            "status": true,
            "isMostPopular": false,
            "createdAt": "2023-02-23T10:44:29.000Z",
            "updatedAt": "2023-02-23T10:44:50.000Z"
          },
          {
            "_id": "856",
            "ebookId": "45",
            "name": "6 month",
            "duration": 180,
            "price": 100,
            "isDefault": false,
            "status": true,
            "isMostPopular": true,
            "createdAt": "2023-02-23T10:44:41.000Z",
            "updatedAt": "2023-02-23T10:44:50.000Z"
          }
        ],
        "details": [
          {
            "id": 1,
            "mainText": "Language",
            "subText": "Gujarati"
          },
          {
            "id": 2,
            "mainText": "Author",
            "subText": "test"
          },
          {
            "id": 3,
            "mainText": "Publisher",
            "subText": "test"
          }
        ],
        "isPaid": true,
        "isPurchased": false,
        "isNew": false,
        "subscriptionEndAt": null,
        "daysLeft": null,
        "shareableLink": "http://localhost:4000/share/ebooks/45"
      },
      {
        "_id": "18",
        "name": "Super Six",
        "thumbnail": "supersix.jpeg",
        "image": "super_six_res.jpg",
        "description": "વિષયવાઇઝ ( કેટેગરીવાઈઝ ) તો ખરુજ અને સાથેને સાથે ટોપિકવાઇઝ કવર કરતુ ગુજરાતનું પ્રથમ પુસ્તક.\\nરેવન્યુ તલાટી, તલાટી કમ મંત્રી, જુનિયર ક્લાર્ક, કોન્સ્ટેબલ, જેલ સિપાહી, ફોરેસ્ટ ગાર્ડ તથા PSI સાથે કુલ 42 પ્રશ્નપત્રોનો સમાવેશ.\\n42 પ્રશ્નપત્રોના 4200+ પ્રશ્નોને 25 વિષયોની કેટેગરી અને 374 ટોપિકમાં વર્ગીકૃત.\\nટોપિકવાઇઝ હોવાથી કયા વિષયના ક્યા ટોપિક્માંથી કેટલા અને કેવાં પ્રશ્નો પૂછાયા છે તેનો સચોટ ખ્યાલ.\\nબદલાતી જતી એક્ઝામ પેટર્નનો બારીકાઈથી ખ્યાલ અને ક્યાં ટોપિક પર વધુ મેહનત કરવાની જરૂર છે તેનો સચોટ ખ્યાલ.\\nટોપિકવાઇઝ હોવાના કારણે સરળતાથી અને જલ્દીથી પ્રશ્નો યાદ રાખી શકાશે અને લાંબા સમય સુધી યાદ રહેશે.\\n 239 pages\\n book helpline number : +91 77779 91348",
        "termsAndConditions": "કૃપા કરીને તમે બુક ખરીદતા પહેલા ડેમો બુક તપાસો જેથી તમે જોઈ શકો કે PDF તમારા મોબાઇલમાં સપોર્ટેડ છે કે નહીં. \\nઆ બુકનો ઉપયોગ તમે GPSC Online એપ્લિકેશન પૂરતો જ કરી શકશો. \\nતમે બુકનો ScreenShot કે બુકની Xerox નીકાળી શકશો નહીં. \\nતમે Subscribe કરેલી બુક નું વાંચન subscription ની સમય મર્યાદા સુધી જ કરી શકશો. \\nઆ બુકનો ઉપયોગ તમે વ્યાવસાયિક ધોરણે કરી શકશો નહીં.",
        "author": "Akram Sherasiya",
        "publisher": "Abhijit Gadhavi",
        "language": "Gujarati",
        "order": 29,
        "demoUrl": "https://pdfobject.com/pdf/sample.pdf",
        "bookUrl": "https://pdfobject.com/pdf/sample.pdf",
        "link": "https://dynamic.link",
        "status": true,
        "isTrending": false,
        "createdAt": "2021-06-16T11:45:40.000Z",
        "updatedAt": "2023-02-27T17:00:19.000Z",
        "plans": [
          {
            "_id": "46",
            "ebookId": "18",
            "name": null,
            "duration": 90,
            "price": 70,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "createdAt": null,
            "updatedAt": null
          },
          {
            "_id": "33",
            "ebookId": "18",
            "name": null,
            "duration": 180,
            "price": 120,
            "isDefault": false,
            "status": true,
            "isMostPopular": false,
            "createdAt": null,
            "updatedAt": null
          }
        ],
        "details": [
          {
            "id": 1,
            "mainText": "Language",
            "subText": "Gujarati"
          },
          {
            "id": 2,
            "mainText": "Author",
            "subText": "Akram Sherasiya"
          },
          {
            "id": 3,
            "mainText": "Publisher",
            "subText": "Abhijit Gadhavi"
          }
        ],
        "isPaid": true,
        "isPurchased": false,
        "isNew": false,
        "subscriptionEndAt": null,
        "daysLeft": null,
        "shareableLink": "http://localhost:4000/share/ebooks/18"
      }
    ]
  }
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/ebooks?language=English

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
    "ebooks": []
  }
}
```

---
