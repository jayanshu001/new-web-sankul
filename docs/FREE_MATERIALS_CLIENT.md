# Free Materials — Client Integration

`/free-materials` returns **distinct material-category cards** — each category
that contains at least one free material appears exactly **once**, with its free
`lessonCount` and the free course/package it belongs to. (The old
`/free-materials/grouped` endpoint has been **removed**.)

Tapping a card lists that category's free materials via the existing
`/material-categories/:id/materials` endpoint with `?type=free`.

All endpoints require a Bearer token.

---

## 1) `GET /api/v1/client/free-materials`

Distinct, paginated list of material-category cards. A category appears once,
never duplicated, regardless of how many free materials it holds. "Free" is
decided per material by the row's own `isPaid:false` flag (mirrors `/free-videos`
using `priceType:"free"`); a category is included only if it has ≥1 such material.

### Query params (all optional)

| Param | Type | Default | Notes |
|---|---|---|---|
| `search` | string | — | Case-insensitive substring match on the **category title**. |
| `page` | number | `1` | 1-indexed (paginates over the distinct category set). |
| `limit` | number | `20` | Page size. |

### Response 200

```json
{
  "success": true,
  "data": [
    {
      "_id": "66f0a1b2c3d4e5f600000010",
      "title": "Reasoning",
      "image": "https://.../reasoning.jpg",
      "lessonCount": 2,
      "parent": {
        "_id": "66f0a1b2c3d4e5f600000001",
        "name": "UPSC Preparations",
        "type": "course"
      }
    }
  ],
  "pagination": { "total": 3, "page": 1, "limit": 20, "totalPages": 1 }
}
```

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Material category id. **Pass as `:id` to endpoint #2.** |
| `title` / `image` | string | Card label + icon. |
| `lessonCount` | number | Count of **free** (`isPaid:false`, active) materials in the category — matches what endpoint #2 returns with `type=free`. |
| `parent` | object \| null | The free course/package the category belongs to (`type`: `"course"` \| `"package"`). `null` for a category whose materials are free only via their own `isPaid:false` flag (no free parent). If attached to several free parents, the first match is returned. |

- A category appears **once** even if shared across multiple free courses/packages.
- Categories with zero free materials never appear (no empty cards).
- Orphan/uncategorised materials are excluded.

---

## 2) `GET /api/v1/client/material-categories/:id/materials`

Per-category material list (used after tapping a category). Now supports a price
filter via `type`, mirroring `/video-categories/:id/videos`.

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `type` | `"free"` \| `"paid"` | — | `free` → only `isPaid:false`; `paid` → only `isPaid:true`; omitted → all. Any other value is ignored. |
| `search` | string | — | Case-insensitive match on `title`. |
| `page` | number | `1` | 1-indexed. |
| `limit` | number | `20` | Page size. |

To list a category's free materials:
```
GET /api/v1/client/material-categories/<id>/materials?type=free&page=1&limit=20
```

### Response 200

```json
{
  "success": true,
  "data": {
    "category": { "_id": "...", "title": "Reasoning", "image": "..." },
    "list": [
      {
        "_id": "...",
        "title": "Material List One",
        "file": "https://.../file.pdf",
        "directLink": "",
        "isPaid": false,
        "isPurchased": true,
        "...": "..."
      }
    ]
  },
  "pagination": { "total": 2, "page": 1, "limit": 20, "totalPages": 1 }
}
```

- Each row carries `isPaid` and `isPurchased`. For **paid** materials the user
  hasn't purchased, `file`/`directLink` are returned empty (server-side gating).
  Free materials (`type=free`) are always accessible, so their URLs are present.

---

## Frontend integration flow

1. **Free Materials landing:** call `GET /free-materials` (paginate as needed).
   Each item is already a distinct category card — render `title`, `image`,
   `"{lessonCount} Lessons"`, and optionally the `parent` name.
2. **Tapping a category card:** call
   `GET /material-categories/<card._id>/materials?type=free`.
   - For a mixed/paid screen, omit `type` (all) or pass `type=paid`.

> `/free-materials` returns each category at most once and only when it has ≥1
> free material — no duplicates, no empty cards.

---

## Error responses

| Status | Body |
|---|---|
| 400 | `{ "success": false, "message": "Invalid category id." }` — bad `:id` (endpoint #2). |
| 401 | `{ "success": false, "message": "Unauthorized." }` — missing/invalid Bearer token. |
| 404 | `{ "success": false, "message": "Material category not found." }` — unknown `:id` (endpoint #2). |
| 500 | `{ "success": false, "message": "<error>" }` — server error. |
