# Course Exam & Material Categories — Admin

Mirrors the `examCategories` / `materialCategories` shape already used by Packages so the admin UI can attach exam categories (and material categories) directly to a Course.

The `Course` Mongoose schema already had embedded arrays for both. This change wires them through the admin controller (validation, request parsing, populate on read).

## Schema

`ws_courses` document — relevant fields:

```ts
{
  // ...existing course fields
  materialCategories: [
    { category: ObjectId<MaterialCategory>, order: Number }
  ],
  examCategories: [
    { category: ObjectId<ExamCategory>, order: Number }
  ]
}
```

- `category` — required, must be a valid `ExamCategory` / `MaterialCategory` `_id`.
- `order` — optional, defaults to `0`. Used for display ordering.
- No `status` flag (unlike Packages); presence in the array means active.

## Endpoints

All endpoints require `Authorization: Bearer <admin-token>` (admin or super_admin).

### `GET /api/v1/admin/courses`

Response now populates the new arrays.

Example response item:

```json
{
  "_id": "65f...",
  "name": "GPSC Class 1-2",
  "isPopular": true,
  "courseEducatorId": { "_id": "...", "name": "..." },
  "courseSubjectCategoryId": { "_id": "...", "title": "..." },
  "videoCategoryId": { "_id": "...", "title": "..." },
  "pcMaterialId": { "_id": "...", "title": "..." },
  "materialCategories": [
    {
      "category": { "_id": "66a...", "title": "Polity", "image": "https://..." },
      "order": 0
    }
  ],
  "examCategories": [
    {
      "category": { "_id": "66b...", "name": "GPSC", "image": "https://..." },
      "order": 0
    },
    {
      "category": { "_id": "66c...", "name": "UPSC", "image": "https://..." },
      "order": 1
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

> Note: `ExamCategory` uses `name`, while `MaterialCategory` uses `title`.

### `GET /api/v1/admin/courses/:id`

Same populate behaviour; response shape unchanged otherwise.

### `POST /api/v1/admin/courses`

Multipart/form-data (because of the `image` upload) **or** JSON.

When using `multipart/form-data`, send `examCategories` / `materialCategories` as JSON-encoded strings (the controller parses them). When using JSON, send them as regular arrays.

**JSON body example:**

```json
{
  "name": "GPSC Class 1-2",
  "description": "...",
  "image": "https://cdn.example.com/cover.png",
  "ordered": 1,
  "level": "advanced",
  "status": true,
  "isPaid": true,
  "isPopular": false,
  "courseEducatorId": "65f...",
  "courseSubjectCategoryId": "65f...",
  "videoCategoryId": "65f...",
  "pcMaterialId": "65f...",
  "materialCategories": [
    { "category": "66a000000000000000000001", "order": 0 }
  ],
  "examCategories": [
    { "category": "66b000000000000000000001", "order": 0 },
    { "category": "66b000000000000000000002", "order": 1 }
  ]
}
```

**Multipart form fields:**

| Field | Value |
| --- | --- |
| `name` | `GPSC Class 1-2` |
| `description` | `...` |
| `image` | (file) |
| `ordered` | `1` |
| `level` | `advanced` |
| `status` | `true` |
| `examCategories` | `[{"category":"66b...01","order":0},{"category":"66b...02","order":1}]` |
| `materialCategories` | `[{"category":"66a...01","order":0}]` |

**Response:** `201 Created`

```json
{
  "success": true,
  "message": "Course created successfully with default folder",
  "data": { "course": { "...": "...", "examCategories": [...] }, "folder": { "...": "..." } }
}
```

### `PUT /api/v1/admin/courses/:id`

Same body shape as create (all fields partial). Sending `examCategories` / `materialCategories` **replaces** the existing array entirely. Omit the field to leave it untouched. Send `[]` to clear it.

**Response:** `200 OK`

```json
{ "success": true, "data": { "...": "...", "examCategories": [...] } }
```

## Validation rules

- Each item must be `{ category: <ObjectId>, order?: <non-negative int> }`.
- Invalid ObjectIds are filtered out silently by the controller's parser; if the entire array is malformed JSON it is treated as omitted.
- `order` defaults to `0` if missing.

## Errors

| Status | When |
| --- | --- |
| 400 | Invalid course id, validation failure (Zod issues returned under `errors`) |
| 401 | Missing/invalid bearer token |
| 404 | Course not found (update) |
| 500 | Unexpected server error |

## Notes for the UI

- To list available exam categories for the picker, use the existing exam-category admin endpoint (`GET /api/v1/admin/exam-categories` — already in use by the Packages UI).
- The same applies to material categories.
- Re-ordering is done client-side by editing the `order` numbers and re-sending the full array on `PUT`.
