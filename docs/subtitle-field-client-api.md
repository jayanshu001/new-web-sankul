# Client API — `subtitle` field reference

All three resources (Course, Package, Live Course) now expose an optional `subtitle` string. Empty string when not set; never `null`.

---

## 1. Course

**`GET /api/v1/client/courses`** *(also `/categories/:categoryId/courses`)*

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f1a2b3c4d5e6f7a8b9c0d1",
      "name": "GPSC Class 1 & 2 Complete Course",
      "subtitle": "Mains + Prelims | English Medium",
      "description": "Comprehensive preparation for GPSC Class 1 & 2 exams.",
      "image": "https://websankul-staging.blr1.cdn.digitaloceanspaces.com/admin/profiles/1716112233-image.jpg",
      "ordered": 1,
      "shareableLink": "https://websankul.com/courses/gpsc-class-1-2",
      "withMaterial": "Includes printed material",
      "withoutMaterial": "Digital access only",
      "level": "Advanced",
      "status": true,
      "isPaid": true,
      "isPopular": true,
      "courseEducatorId": { "_id": "65f0aaa111bbb222ccc333dd", "name": "Prof. Rakesh Patel" },
      "courseSubjectCategoryId": { "_id": "65f0bbb111ccc222ddd333ee", "title": "GPSC" },
      "videoCategoryId": { "_id": "65f0ccc111ddd222eee333ff", "title": "Recorded Lectures" },
      "examCountdownCategoryId": "65f0ddd111eee222fff33400",
      "materialCategories": [],
      "examCategories": [],
      "createdAt": "2026-04-12T08:21:44.512Z",
      "updatedAt": "2026-05-20T11:03:18.927Z",
      "isPurchased": true,
      "daysLeft": 142,
      "plans": {
        "withMaterial":   [{ "_id": "...", "duration": 6, "actualPrice": 12000, "discountedPrice": 8999, "withMaterial": true,  "status": true }],
        "withoutMaterial":[{ "_id": "...", "duration": 6, "actualPrice":  8000, "discountedPrice": 5999, "withMaterial": false, "status": true }]
      }
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
}
```

**`GET /api/v1/client/courses/:id`** — same course shape inside `data.course` plus `videos`, `materials`, `tests`, `plans`, `availablePromoCode`. `subtitle` is present on `data.course`.

---

## 2. Package

**`GET /api/v1/client/packages`** *(also `/type/:typeId`, `/goal`)*

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f2b3c4d5e6f7a8b9c0d1e2",
      "title": "UPSC + GPSC Combined Pack",
      "subtitle": "All-in-one preparation | 2 educators",
      "description": "Combined access to UPSC Foundation and GPSC Class 1 & 2 courses.",
      "image": "https://websankul-staging.blr1.cdn.digitaloceanspaces.com/admin/profiles/1716112299-image.jpg",
      "isPopular": true,
      "status": true,
      "packageTypeId": { "_id": "65f0eee111fff222000333aa", "title": "Combo Packs" },
      "educatorId":    { "_id": "65f0aaa111bbb222ccc333dd", "name": "Prof. Rakesh Patel" },
      "courses": [
        { "_id": "65f1a2b3c4d5e6f7a8b9c0d1", "name": "GPSC Class 1 & 2", "image": "...", "subtitle": "Mains + Prelims | English Medium" }
      ],
      "createdAt": "2026-04-18T10:11:00.000Z",
      "updatedAt": "2026-05-22T08:55:00.000Z",
      "isPurchased": false,
      "daysLeft": null,
      "plans": {
        "withMaterial":    [{ "_id": "...", "duration": 12, "actualPrice": 30000, "discountedPrice": 22999, "withMaterial": true,  "status": true }],
        "withoutMaterial": [{ "_id": "...", "duration": 12, "actualPrice": 22000, "discountedPrice": 16999, "withMaterial": false, "status": true }]
      }
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
}
```

**`GET /api/v1/client/packages/:id`** — same package shape with full nested courses (each course also carries its own `subtitle`).

---

## 3. Live Course

**`GET /api/v1/client/live-courses`**

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f3c4d5e6f7a8b9c0d1e2f3",
      "name": "GPSC Live Batch — May 2026",
      "subtitle": "Daily 2-hour live sessions | Bilingual",
      "description": "Live interactive sessions with doubt-solving and weekly tests.",
      "image": "https://websankul-staging.blr1.cdn.digitaloceanspaces.com/admin/profiles/1716200044-image.jpg",
      "ordered": 1,
      "shareableLink": "",
      "withMaterial": "",
      "withoutMaterial": "",
      "level": "Intermediate",
      "classType": "live_offline",
      "status": true,
      "isPaid": true,
      "isPopular": true,
      "startTime": "2026-06-01T03:30:00.000Z",
      "courseEducatorId":   { "_id": "65f0aaa111bbb222ccc333dd", "name": "Prof. Rakesh Patel" },
      "packageCategoryId":  { "_id": "65f0bbb111ccc222ddd333ee", "title": "GPSC" },
      "videoCategoryId":    { "_id": "65f0ccc111ddd222eee333ff", "title": "Live Recordings" },
      "materialCategories": [],
      "examCategories": [],
      "scheduleFolders": [],
      "createdAt": "2026-05-01T05:00:00.000Z",
      "updatedAt": "2026-05-25T09:00:00.000Z",
      "isPurchased": false,
      "daysLeft": null,
      "plans": {
        "withMaterial":    [{ "_id": "...", "duration": 3, "actualPrice": 9000, "discountedPrice": 6999, "withMaterial": true,  "status": true }],
        "withoutMaterial": [{ "_id": "...", "duration": 3, "actualPrice": 6000, "discountedPrice": 4499, "withMaterial": false, "status": true }]
      }
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
}
```

**`GET /api/v1/client/live-courses/:id`** — same live course shape, with `subtitle` on the root object.

---

## Contract notes for frontend

- **Field name:** `subtitle` (lowercase) — identical across all three resources.
- **Type:** `string`. Empty string `""` when unset (not `null`, not missing).
- **Optional on input:** if the frontend omits the key on create/update, the field stays `""`.
- **No migration:** old records return `subtitle: ""` until edited.
- **Where it appears:**
  - Course: list items, detail's `data.course`.
  - Package: list items, detail's package object, **and** on each nested course inside `package.courses[]`.
  - Live Course: list items, detail object.
