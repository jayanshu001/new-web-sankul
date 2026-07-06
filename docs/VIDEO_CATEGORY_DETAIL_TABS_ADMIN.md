# Video Category Detail — Course & Video Tabs (Admin)

Endpoints powering the Video Category details page tabs (Sub-Categories, Course,
Video, Educator). All routes require a Bearer token and `admin` / `super_admin`
role.

Base path: `/api/v1/admin/video-categories`

---

## 1. Sub-Categories tab — `order` added to detail response

`GET /api/v1/admin/video-categories/{id}` (existing endpoint, modified)

Each entry in `child_categories` now includes `order` (the child category's own
`order_by`), alongside `id`, `name`, `slug`, and `status`. This drives the
"Order By" column in the Sub-Categories tab.

```jsonc
{
  "success": true,
  "data": {
    "id": "665f...",
    "name": "Physics",
    "slug": "physics",
    "order": 3,
    "image": "https://...",
    "child_categories": [
      { "id": "665a...", "name": "Mechanics", "slug": "mechanics", "status": true, "order": 0 },
      { "id": "665b...", "name": "Optics",    "slug": "optics",    "status": true, "order": 1 }
    ],
    "educator": { "id": "664c...", "name": "Dr. Rao" },
    "status": true,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

---

## 2. Course tab — `GET /{id}/courses`

Paginated, searchable list of courses linked to this video category (via the
course's `videoCategoryId`).

**Query params**

| Param      | Type   | Default | Notes                                  |
| ---------- | ------ | ------- | -------------------------------------- |
| `search`   | string | —       | Case-insensitive match on course name. |
| `status`   | enum   | —       | `"true"` / `"false"`.                  |
| `page`     | int    | 1       | Min 1.                                 |
| `per_page` | int    | 20      | Min 1, max 200.                        |

**Response** — ordered by the course's `ordered` field, ascending.

```jsonc
{
  "success": true,
  "data": {
    "items": [
      { "id": "667a...", "name": "Complete Physics", "status": true, "orderBy": 0 }
    ],
    "meta": { "page": 1, "per_page": 20, "total": 1, "totalPages": 1 }
  }
}
```

> Note: the `Course` model has no `slug` field, so `slug` is omitted from course items.

---

## 3. Video tab — `GET /{id}/videos`

Paginated, searchable list of videos belonging to this video category (via the
video's `videoCategoryId`).

**Query params**

| Param      | Type   | Default | Notes                                              |
| ---------- | ------ | ------- | -------------------------------------------------- |
| `search`   | string | —       | Case-insensitive match on title / slug / topic.    |
| `status`   | enum   | —       | `"true"` / `"false"`.                              |
| `platform` | enum   | —       | `"youtube"` / `"vimeo"` / `"aws"`.                 |
| `page`     | int    | 1       | Min 1.                                             |
| `per_page` | int    | 20      | Min 1, max 200.                                    |

**Response** — ordered by the video's `order` field, ascending.

```jsonc
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "668a...",
        "name": "Newton's Laws",
        "slug": "newtons-laws",
        "status": true,
        "orderBy": 0,
        "platform": "youtube"
      }
    ],
    "meta": { "page": 1, "per_page": 20, "total": 1, "totalPages": 1 }
  }
}
```

---

## Behaviour notes

- **Envelope:** the two new list endpoints use `{ data: { items, meta: { page, per_page, total, totalPages } } }`.
  (The existing `GET /` list endpoint keeps its older `pagination: { page, per_page, total }` shape, unchanged.)
- **Empty category:** returns `200` with `items: []` and `total: 0` — not an error.
- **Unknown / invalid id:** `400` for a malformed ObjectId, `404` if the category does not exist.
