# Free Materials — Client Integration

The Free Materials screen uses **two endpoints**: one for the grouped landing
view (sections + category cards), and one for the per-category material list
(detail page shown after tapping a card).

Both require a Bearer token.

---

## 1) `GET /api/v1/client/free-materials/grouped`

Returns the two-level tree for the Free Materials landing screen.

**Auth:** Bearer token (required)
**Query params:** none

### Response 200

```json
{
  "success": true,
  "data": [
    {
      "_id": "66f0a1b2c3d4e5f600000001",
      "name": "UPSC Preparations",
      "type": "course",
      "materialCategories": [
        {
          "_id": "66f0a1b2c3d4e5f600000010",
          "title": "Reasoning",
          "image": "https://websankul-staging.blr1.digitaloceanspaces.com/.../reasoning.jpg",
          "lessonCount": 67
        },
        {
          "_id": "66f0a1b2c3d4e5f600000011",
          "title": "Subject",
          "image": "https://websankul-staging.blr1.digitaloceanspaces.com/.../subject.jpg",
          "lessonCount": 67
        }
      ]
    },
    {
      "_id": "66f0a1b2c3d4e5f600000002",
      "name": "GPSC Free Pack",
      "type": "package",
      "materialCategories": [ /* ... */ ]
    }
  ]
}
```

### Field reference

| Field | Type | Notes |
|---|---|---|
| `data[]._id` | ObjectId | Course or package id. Use as section key — not needed for the detail-page call. |
| `data[].name` | string | Section header shown in the UI (e.g. "UPSC Preparations"). Replaces the old material-category title that was being shown as the header. |
| `data[].type` | `"course"` \| `"package"` | Tells the client which kind of parent this is. Useful if courses and packages need different styling/icons. |
| `data[].materialCategories[]._id` | ObjectId | **Pass this as `materialCategoryId` to endpoint #2 when the user taps the card.** |
| `data[].materialCategories[].title` | string | Card title (e.g. "Reasoning"). |
| `data[].materialCategories[].image` | string \| null | Card icon/image url. May be `null`. |
| `data[].materialCategories[].lessonCount` | number | Count of active materials in that category. Render as "67 Lessons". |

### Behavior notes

- A material category shared across multiple free courses/packages appears
  **under each parent** (duplicated by design).
- `lessonCount` counts only materials with `status: true`.
- Parents with no resolvable categories, and inactive categories, are omitted.
- No pagination — the tree is expected to be small (number of free
  courses/packages).

---

## 2) `GET /api/v1/client/free-materials`

Returns the flat, paginated list of materials. Call this when the user taps a
category card to render the detail page.

**Auth:** Bearer token (required)

### Query params

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `materialCategoryId` | ObjectId | **Required for the detail page** | — | The `_id` taken from `data[].materialCategories[]._id` of endpoint #1. If omitted, the endpoint returns materials across *all* free categories. If the id isn't part of any free course/package, an empty list is returned (paid categories cannot leak through). |
| `search` | string | optional | — | Case-insensitive substring match on material `title`. |
| `page` | number | optional | `1` | 1-indexed. |
| `limit` | number | optional | `20` | Page size. |

### Response 200

```json
{
  "success": true,
  "data": [
    {
      "_id": "69ef65c3debc01c16b45c08e",
      "title": "Material List One",
      "materialCategoryId": {
        "_id": "66f0a1b2c3d4e5f600000010",
        "title": "Reasoning",
        "image": "https://.../reasoning.jpg"
      },
      "file": "https://.../1778149369636-file.pdf",
      "directLink": "",
      "fileSize": 69173,
      "fileMime": "application/pdf",
      "language": "gu",
      "isPreview": false,
      "downloadCount": 0,
      "order": 2,
      "status": true,
      "createdAt": "2026-04-27T13:33:55.520Z",
      "updatedAt": "2026-05-07T10:22:50.052Z"
    }
  ],
  "pagination": {
    "total": 67,
    "page": 1,
    "limit": 20,
    "totalPages": 4
  }
}
```

Response shape is unchanged from the previous version of this endpoint — only
the `materialCategoryId` query param is new.

---

## Frontend integration flow

1. **Landing screen ("Free Materials"):** call
   `GET /free-materials/grouped`.
   - For each item in `data`, render a section with header = `name`.
   - Inside the section, render each `materialCategories[]` entry as a card
     showing `title`, `"{lessonCount} Lessons"`, and `image`.

2. **On tapping a category card:** navigate to the detail page, passing the
   category's `_id`. On that page, call:

   ```
   GET /api/v1/client/free-materials?materialCategoryId=<id>&page=1&limit=20
   ```

   Add `&search=<query>` when the search bar is used. Paginate via `page`.

### Why two endpoints instead of one bundled call

The detail page is paginated and searchable, so it belongs on the server. A
single bundled call would either drop pagination (breaks for large categories)
or invent a nested-pagination shape that is harder to consume on both sides.
The grouped endpoint stays cheap (no material rows shipped up front), and the
detail call only fires when the user actually opens a category.

---

## Error responses (both endpoints)

| Status | Body |
|---|---|
| 401 | `{ "success": false, "message": "Unauthorized." }` — missing/invalid Bearer token. |
| 500 | `{ "success": false, "message": "<error>" }` — server error. |
