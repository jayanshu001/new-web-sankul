# Quiz Category Detail — Package & Course Tabs (Admin)

Endpoints powering the Quiz Category details page (`admin/quizzes/categories/{id}`)
tabs: Package, Course, Quizs.

> Implementation note: "Quiz categories" are the **ExamCategory** model and quizzes
> are **Exam** documents. The module lives at `src/admin/exam/` and is mounted at
> `/api/v1/admin/quizzes`. All routes require a Bearer token and `admin` /
> `super_admin` role.

Base path: `/api/v1/admin/quizzes`

---

## 1. Package tab — `GET /categories/{id}/packages` (new)

Paginated, searchable list of packages linked to this quiz category (a package is
linked when its embedded `examCategories[].category` contains this category id).

**Query params**

| Param      | Type   | Default | Notes                                  |
| ---------- | ------ | ------- | -------------------------------------- |
| `search`   | string | —       | Case-insensitive match on package name.|
| `status`   | enum   | —       | `"true"` / `"false"` (maps to `active`).|
| `page`     | int    | 1       | Min 1.                                 |
| `per_page` | int    | 20      | Min 1, max 200.                        |

**Response** — ordered by package `order` ascending.

```jsonc
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "66a1...",
        "name": "SSC Complete Package",
        "price": 1499,
        "shareableLink": "https://...",
        "status": true
      }
    ],
    "meta": { "page": 1, "per_page": 20, "total": 1, "totalPages": 1 }
  }
}
```

> **About `price`:** the `Package` model has no price field — pricing lives in the
> separate `ws_package_course_ebook_prices` collection (multiple plan rows per
> package, by duration). The `price` returned here is a single representative value:
> the **default plan's** price if one is marked `isDefault`, otherwise the **lowest
> active** price. It is `null` if the package has no active price rows.

---

## 2. Course tab — `GET /categories/{id}/courses` (new)

Paginated, searchable list of courses linked to this quiz category (a course is
linked when its embedded `examCategories[].category` contains this category id).

**Query params**

| Param      | Type   | Default | Notes                                  |
| ---------- | ------ | ------- | -------------------------------------- |
| `search`   | string | —       | Case-insensitive match on course name. |
| `status`   | enum   | —       | `"true"` / `"false"`.                  |
| `page`     | int    | 1       | Min 1.                                 |
| `per_page` | int    | 20      | Min 1, max 200.                        |

**Response** — ordered by course `ordered` ascending.

```jsonc
{
  "success": true,
  "data": {
    "items": [
      { "id": "66b2...", "name": "Reasoning Crash Course", "status": true, "orderBy": 0 }
    ],
    "meta": { "page": 1, "per_page": 20, "total": 1, "totalPages": 1 }
  }
}
```

---

## 3. Quizs tab — quizzes filter by category (confirmed ✅)

**Confirmed.** `GET /api/v1/admin/quizzes?categoryId={id}` works and filters
quizzes directly under that category.

- The param name is **`categoryId`** (exactly as you're calling it).
- It matches `Exam.categoryId` directly (a single ObjectId ref on each quiz), so
  it returns quizzes **directly under** that category — not descendants.
- Additional supported params on that endpoint: `search` (matches quiz `title`),
  `type`, `status`, `isPaid`, `page`, `limit`.

> ⚠️ Envelope difference: the existing `GET /quizzes` list endpoint returns the
> **older** shape — `{ success, data: [...], pagination: { total, page, limit, totalPages } }`
> (top-level `data` array, `limit` not `per_page`, no `meta`/`items`). The two new
> package/course endpoints use the requested `{ data: { items, meta } }` shape.
> If you want `GET /quizzes` migrated to the new envelope too, that's a separate
> change — flag it and we'll do it.

---

## Detail response — `parent` added (nice-to-have ✅)

`GET /api/v1/admin/quizzes/categories/{id}` now includes a resolved
`parent: { id, name }` (or `null` for a root category), so the page can show the
parent name without a second request. The raw `parentId` field is still present.

```jsonc
{
  "success": true,
  "data": {
    "_id": "66c3...",
    "name": "Quantitative Aptitude",
    "parentId": "66c0...",
    "parent": { "id": "66c0...", "name": "SSC" },
    "ancestors": ["66c0..."],
    "childCategoryIds": ["66c4..."],
    "orderBy": 2,
    "status": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## Behaviour notes

- **Envelope:** the two new list endpoints use `{ data: { items, meta: { page, per_page, total, totalPages } } }`.
- **Empty category:** returns `200` with `items: []` and `total: 0` — not an error.
- **Invalid / unknown id:** `400` for a malformed ObjectId, `404` if the category does not exist.
