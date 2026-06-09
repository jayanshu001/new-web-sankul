# Client API — Exam Countdown arrays integration guide

Backend changes are live for the multi-select Exam Countdown feature. This doc shows what the **client (customer)** APIs now return and where the new fields land in each payload, so the frontend can wire them in.

---

## Field reference (canonical)

| Field | Type | Where | Replaces |
|---|---|---|---|
| `examCountdownCategoryIds` | `string[]` (ObjectIds) | Package, LiveCourse, **Book, Ebook** | the old singular `examCountdownCategoryId` |
| `examCountdownIds` | `string[]` (ObjectIds) | Package, LiveCourse, **Book, Ebook** | (new) |
| ~~`examCountdownCategoryId`~~ | — | **Removed from Course**; **deprecated (auto-synced) on Book/Ebook** | — |

- Both array fields default to `[]` (not `null`, not missing) when nothing is set.
- The detail endpoints for Package, Book, and Ebook may return them as **populated objects** instead of raw ids (see shapes below). The frontend parser should handle both.
- **Legacy `examCountdownCategoryId` on Book/Ebook:** still present in payloads for back-compat, but the backend now keeps it auto-synced to `examCountdownCategoryIds[0]` and ignores any value you send for it. **Stop sending it; read the array instead.** It will be dropped in a later cleanup.
- The `subtitle` field added in the prior change also still applies — included here for completeness in the response examples.

---

## 1. Package

### `GET /api/v1/client/packages` *(also `/type/:typeId`, `/goal`)*

List endpoints return the Package document essentially unmodified (no `.select()`), so `examCountdownCategoryIds` and `examCountdownIds` arrive as **raw id arrays**.

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f2b3c4d5e6f7a8b9c0d1e2",
      "name": "UPSC + GPSC Combined Pack",
      "subtitle": "All-in-one preparation | 2 educators",
      "description": "Combined access to UPSC Foundation and GPSC Class 1 & 2 courses.",
      "image": "https://websankul-staging.blr1.cdn.digitaloceanspaces.com/admin/profiles/1716112299-image.jpg",
      "active": true,
      "isPaid": true,
      "isPopular": true,
      "packageTypeId":     { "_id": "65f0eee111fff222000333aa", "name": "Combo Packs" },
      "goalId":            { "_id": "65f0aaa111bbb222ccc333dd", "title": "Civil Services" },
      "packageCategoryId": { "_id": "65f0bbb111ccc222ddd333ee", "title": "UPSC" },
      "educatorId":        { "_id": "65f0aaa111bbb222ccc333dd", "name": "Prof. Rakesh Patel" },

      "examCountdownCategoryIds": [
        "65f0ddd111eee222fff333aa",
        "65f0ddd111eee222fff333bb"
      ],
      "examCountdownIds": [
        "65f0fff111000222111333aa"
      ],

      "specificSubjects":   [],
      "materialCategories": [],
      "examCategories":     [],

      "createdAt": "2026-04-18T10:11:00.000Z",
      "updatedAt": "2026-05-29T08:55:00.000Z",

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

### `GET /api/v1/client/packages/:id`

Detail endpoint **populates** both arrays so the frontend can render names + colors without a follow-up call.

```json
{
  "success": true,
  "data": {
    "package": {
      "_id": "65f2b3c4d5e6f7a8b9c0d1e2",
      "name": "UPSC + GPSC Combined Pack",
      "subtitle": "All-in-one preparation | 2 educators",
      "description": "Combined access to UPSC Foundation and GPSC Class 1 & 2 courses.",
      "image": "https://websankul-staging.blr1.cdn.digitaloceanspaces.com/admin/profiles/1716112299-image.jpg",
      "shareableLink": "https://websankul.com/packages/65f2b3c4d5e6f7a8b9c0d1e2",
      "withMaterialText": "Includes printed material",
      "withoutMaterialText": "Digital access only",
      "packageType": { "_id": "65f0eee111fff222000333aa", "name": "Combo Packs" },
      "goal":        { "_id": "65f0aaa111bbb222ccc333dd", "title": "Civil Services" },
      "isPaid": true,
      "isPurchased": false,
      "daysLeft": null,

      "examCountdownCategoryIds": [
        { "_id": "65f0ddd111eee222fff333aa", "name": "UPSC Prelims 2026", "colorHex": "#E53935" },
        { "_id": "65f0ddd111eee222fff333bb", "name": "GPSC Class 1 & 2",  "colorHex": "#1E88E5" }
      ],
      "examCountdownIds": [
        { "_id": "65f0fff111000222111333aa", "title": "UPSC Prelims",     "examDate": "2026-06-02T00:00:00.000Z" }
      ]
    },
    "videos":   [],
    "materials":[],
    "tests":    [],
    "plans": {
      "withMaterial":    [],
      "withoutMaterial": []
    },
    "availablePromoCode": []
  }
}
```

### Existing endpoint that now uses the array filter

`GET /api/v1/client/exam-countdown-categories/:id/packages` continues to work — it now matches Packages whose `examCountdownCategoryIds` array **contains** `:id`. Response shape unchanged.

---

## 2. Live Course

### `GET /api/v1/client/live-courses`

List returns the LiveCourse document with both arrays as **raw id arrays** (no populate on list).

```json
{
  "success": true,
  "data": {
    "liveCourses": [
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
        "courseEducatorId":  { "_id": "65f0aaa111bbb222ccc333dd", "name": "Prof. Rakesh Patel", "image": "..." },
        "packageCategoryId": { "_id": "65f0bbb111ccc222ddd333ee", "title": "GPSC" },
        "videoCategoryId":   "65f0ccc111ddd222eee333ff",

        "examCountdownCategoryIds": [
          "65f0ddd111eee222fff333aa"
        ],
        "examCountdownIds": [
          "65f0fff111000222111333aa",
          "65f0fff111000222111333bb"
        ],

        "materialCategories": [],
        "examCategories":     [],
        "scheduleFolders":    [],

        "createdAt": "2026-05-01T05:00:00.000Z",
        "updatedAt": "2026-05-29T09:00:00.000Z",

        "isPurchased": false,
        "daysLeft": null,
        "purchaseCount": 12,
        "cardVariant": "featured"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### `GET /api/v1/client/live-courses/:id`

Detail returns the same shape as list, again with both arrays as **raw id arrays** (no populate on the detail endpoint either). If you need the category/countdown names client-side, store a lookup map from the global exam-countdown endpoints (`/api/v1/client/exam-countdown-categories`).

```json
{
  "success": true,
  "data": {
    "liveCourse": {
      "_id": "65f3c4d5e6f7a8b9c0d1e2f3",
      "name": "GPSC Live Batch — May 2026",
      "subtitle": "Daily 2-hour live sessions | Bilingual",
      "description": "...",
      "image": "...",
      "examCountdownCategoryIds": ["65f0ddd111eee222fff333aa"],
      "examCountdownIds": ["65f0fff111000222111333aa", "65f0fff111000222111333bb"],
      "...": "<all other LiveCourse fields>"
    },
    "plans": [],
    "isPurchased": false,
    "daysLeft": null
  }
}
```

---

## 3. Course — field removed

The `examCountdownCategoryId` field has been **fully removed** from Course:

- `GET /api/v1/client/courses` — no longer returns the field.
- `GET /api/v1/client/courses/:id` (`data.course`) — no longer returns the field.
- `GET /api/v1/client/courses/categories/:categoryId/courses` — no longer returns the field.

The frontend must stop reading or sending `examCountdownCategoryId` on Course payloads. Existing rows in MongoDB may still have a stale value — the client controller strips it before responding, so it will never appear in JSON output.

If the frontend Course form still ships this key by mistake, the backend silently drops it (server-side `delete req.body.examCountdownCategoryId` in the admin coercion step).

---

## 4. Book & Ebook

Both `Book` and `Ebook` now carry `examCountdownCategoryIds` and `examCountdownIds` (same semantics as Package). The legacy single `examCountdownCategoryId` is still in the payload but is **deprecated and auto-synced** to `examCountdownCategoryIds[0]` — read the arrays, not the single field.

### Where the arrays arrive populated vs. raw

- **Admin detail** — `GET /admin/books/:id` and `GET /admin/ebooks/:id` **populate** both arrays (so the edit form can render names + colors without a follow-up call):

  ```json
  {
    "examCountdownCategoryId": "65f0ddd111eee222fff333aa",
    "examCountdownCategoryIds": [
      { "_id": "65f0ddd111eee222fff333aa", "name": "UPSC Prelims 2026", "colorHex": "#E53935" }
    ],
    "examCountdownIds": [
      { "_id": "65f0fff111000222111333aa", "title": "UPSC Prelims", "examDate": "2026-06-02T00:00:00.000Z" }
    ]
  }
  ```

- **Client detail** (`GET /api/v1/client/books/:id`, `GET /api/v1/client/ebooks/:id`) and **all list endpoints** spread the full document with no populate, so there both arrays arrive as **raw id strings** (`["65f0ddd..."]`). Use the `toIds()` normalizer from the checklist below — it handles both shapes.

### Two client endpoints for "books/ebooks tied to a countdown"

| Endpoint | `:id` is | Matches on |
|---|---|---|
| `GET /api/v1/client/exam-countdown/:id/books-ebooks` | an **ExamCountdown** (one exam event) | `examCountdownIds` array contains `:id` |
| `GET /api/v1/client/exam-countdown-categories/:id/books-ebooks` | an **ExamCountdownCategory** | `examCountdownCategoryIds` array contains `:id` *(switched from the legacy single field)* |

Both return `data: { examCountdown | category, list }`, paginated (`page`/`limit`/`search`). Each `list` row is tagged `type: "book"` or `type: "ebook"`; ebook rows carry joined `plans` + `isPaid`/`isPurchased`/`subscriptionEndAt`/`daysLeft`. See `API_EXAM_COUNTDOWN_BOOKS_EBOOKS.md` for the full ExamCountdown-keyed response.

> ⚠️ The category endpoint now reads the **array**, so a backend backfill of legacy rows was required (and has been run). No frontend action needed for that.

---

## Frontend integration checklist

1. **Read-side (everywhere):**
   - Treat `examCountdownCategoryIds` and `examCountdownIds` as `string[]` *or* `Array<{ _id, ... }>`. Normalize at the parser:
     ```ts
     const toIds = (v: unknown): string[] =>
       Array.isArray(v) ? v.map((x: any) => (typeof x === "string" ? x : String(x?._id ?? ""))).filter(Boolean) : [];
     ```
   - Default missing/null to `[]`.

2. **Write-side (admin forms — Package + LiveCourse):**
   - Send the new field names exactly: `examCountdownCategoryIds`, `examCountdownIds`.
   - **Package** admin write — two encodings supported:
     - JSON body (no image): `{ "examCountdownCategoryIds": ["...","..."] }`
     - Multipart (with image): repeated indexed keys `examCountdownCategoryIds[0]=...&examCountdownCategoryIds[1]=...`. To clear, send `examCountdownCategoryIds[]=""`.
   - **LiveCourse** admin write — two encodings supported:
     - JSON body (no image): `{ "examCountdownCategoryIds": ["...","..."] }`. Send `[]` to clear (now accepted).
     - Multipart (with image): JSON-stringified field — `examCountdownCategoryIds='["...","..."]'`.
   - **Book / Ebook** admin write — two encodings supported:
     - JSON body (no file): `{ "examCountdownCategoryIds": ["...","..."], "examCountdownIds": ["..."] }` as real JSON arrays.
     - Multipart (with image/PDF): repeated keys `examCountdownCategoryIds[]=...&examCountdownIds[]=...` (bracketed form; the backend reassembles them). Send an empty array to clear.
     - **Drop the single `examCountdownCategoryId`** from Book/Ebook forms — the backend ignores it and derives it from `examCountdownCategoryIds[0]`.

3. **Course form:** remove the Exam Countdown picker; do not send `examCountdownCategoryId` anymore.

4. **Filter screens:** the existing "Packages / Books-Ebooks by Exam Countdown Category" screens continue to work — no frontend change needed there.

---

## Validation errors to handle

| HTTP | Body `message` | When |
|---|---|---|
| 400 | `Invalid examCountdownCategoryIds entry.` / `Invalid examCountdownIds entry.` | An id in the array isn't a valid ObjectId |
| 400 | `One or more examCountdownCategoryIds do not exist.` | Array references a category that's been deleted |
| 400 | `One or more examCountdownIds do not exist.` | Array references a countdown that's been deleted |
| 422 (LiveCourse) | `Validation failed.` with detailed `errors[]` | Zod schema rejected the field shape |

---

## Notes

- **Migration status:**
  - **Package / LiveCourse** — no migration needed. Existing rows with the old singular value return `examCountdownCategoryIds: []` until edited (these endpoints already filtered on the array).
  - **Book / Ebook** — a backfill **was required and has been run** (`scripts/backfill-book-ebook-exam-countdown-arrays.ts`), because the category books-ebooks endpoint now reads the array. Legacy rows had their single `examCountdownCategoryId` copied into `examCountdownCategoryIds[]`, so they keep showing on the category screen. No frontend action.
- **Indexes** were added on both arrays for query performance (`examCountdownCategoryIds`, `examCountdownIds`) on Package, LiveCourse, Book, and Ebook. Filtering by either field stays efficient at scale.
- **Empty arrays are `[]`**, never `null`. The frontend can `Array.isArray(...)` safely.
