# Package Categories — Client API (Frontend Doc)

Covers the two client-facing package-category endpoints:

1. `GET /api/v1/client/package-categories` — list categories (**now paginated**)
2. `GET /api/v1/client/package-categories/:id/packages` — packages + live courses in a category

Both require a Bearer token.

```
Authorization: Bearer <token>
```

---

## 1. `GET /api/v1/client/package-categories`

Lists package categories. **This endpoint was previously un-paginated and returned every category in a flat array. It now returns a paginated slice plus a `pagination` object.**

> **Action required:** if you currently read the whole list from `response.data`, you must now page through it (or pass a large `limit`).

### Query params (all optional)

| Param    | Type    | Default | Notes |
|----------|---------|---------|-------|
| `page`   | number  | `1`     | 1-based. Values < 1 are clamped to 1. |
| `limit`  | number  | `20`    | Items per page. Values < 1 are clamped to 1. |
| `search` | string  | `""`    | Case-insensitive match on category `title`. |
| `live`   | boolean | `false` | `live=true` → only categories that have ≥1 active live course. |

Example:
```
GET /api/v1/client/package-categories?page=2&limit=20&search=neet&live=true
```

### Response `200`

```json
{
  "success": true,
  "data": [
    {
      "_id": "665f...",
      "title": "NEET 2026",
      "order": 1,
      "status": true,
      "image": "...",
      "packageCount": 12,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": {
    "total": 47,
    "page": 2,
    "limit": 20,
    "totalPages": 3
  }
}
```

- `data` — array of `PackageCategory`, each augmented with `packageCount`. Envelope also carries `pagination`.
- `packageCount` — number of **active recorded packages** in that category (same membership as endpoint #2's `recorded` list — live courses are not counted). `0` if none.
- `total` — total categories matching the filter (respects `search` and `live`).
- `totalPages` — `Math.ceil(total / limit)`.
- When `live=true`, `total` / `totalPages` reflect the **filtered** count (categories with active live courses), not the raw count.

### Migration notes
- **Need the full list at once** (e.g. a dropdown)? Pass a large limit: `?limit=1000`. The default now caps at 20.
- **Search is server-side now** — drop any client-side `.filter()` on `title`; pass `search` instead so it works across pages.
- The `live=true` behavior is unchanged in meaning, just paginated.

### Fetch helper

```ts
async function fetchPackageCategories({
  page = 1,
  limit = 20,
  search = "",
  live = false,
} = {}) {
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(search ? { search } : {}),
    ...(live ? { live: "true" } : {}),
  });

  const res = await api.get(`/client/package-categories?${qs}`);
  return {
    items: res.data.data,            // PackageCategory[]
    pagination: res.data.pagination, // { total, page, limit, totalPages }
  };
}
```

### Pagination / infinite scroll

```ts
const { items, pagination } = await fetchPackageCategories({ page });
const hasMore = pagination.page < pagination.totalPages;

if (hasMore) fetchPackageCategories({ page: pagination.page + 1 });
```

---

## 2. `GET /api/v1/client/package-categories/:id/packages`

Returns the recorded **packages** and **live courses** belonging to a single package category. Tap a category card from endpoint #1, then call this with that category's `_id`.

> **Note:** this endpoint is **not paginated** — it returns the full set for the category (these lists are small per category). Plans for each recorded package are embedded inline.

### Path params

| Param | Type | Notes |
|-------|------|-------|
| `id`  | ObjectId | Package category id. Returns `400` if not a valid ObjectId. |

### Response `200`

```json
{
  "success": true,
  "data": {
    "recorded": [
      {
        "_id": "665a...",
        "name": "Complete Physics",
        "description": "...",
        "image": "...",
        "shareableLink": "...",
        "order": 1,
        "isPaid": true,
        "isSmartCourse": false,
        "isPlannerCourse": false,
        "withMaterialText": "...",
        "withoutMaterialText": "...",
        "packageTypeId": "...",
        "goalId": "...",
        "educatorId": "...",

        "plans": [
          {
            "_id": "70a1...",
            "packageId": "665a...",
            "name": "1 Year",
            "duration": 365,
            "price": 4999,
            "withMaterial": true,
            "materialPrice": 500,
            "isDefault": true
          }
        ],
        "defaultPlan": { "_id": "70a1...", "price": 4999, "isDefault": true },
        "startingPrice": 4999
      }
    ],
    "live": [
      {
        "_id": "665b...",
        "name": "Live NEET Crash",
        "description": "...",
        "image": "...",
        "shareableLink": "...",
        "ordered": 1,
        "isPaid": true,
        "isPopular": true,
        "level": "...",
        "classType": "...",
        "withMaterial": true,
        "withoutMaterial": false,
        "courseEducatorId": "..."
      }
    ]
  }
}
```

### Field notes

**`recorded[]`** — recorded packages (active only), sorted by `order`.
- `plans[]` — pricing plans for the package (active only). Sorted with the **default plan first**, then ascending `duration`.
  - ⚠️ `duration` is in **DAYS**, not months (e.g. `365` = 1 year). Render accordingly.
- `defaultPlan` — the plan flagged `isDefault`, else the first plan, else `null`.
- `startingPrice` — convenience: `defaultPlan.price`, or `null` if the package has no plans.

**`live[]`** — active live courses in the category, sorted by `ordered`.
- Live courses do **not** carry the embedded `plans` array here; fetch live-course pricing/detail via the live-course endpoints.
- Note the field-name differences vs recorded packages: `ordered` (not `order`), `withMaterial` / `withoutMaterial` booleans (not the `*Text` fields), `courseEducatorId` (not `educatorId`).

### Error responses (both endpoints)

| Status | When | Body |
|--------|------|------|
| `400`  | Invalid category id (endpoint #2) | `{ "success": false, "message": "Invalid package category id" }` |
| `401`  | Missing / invalid Bearer token | — |
| `500`  | Server error | `{ "success": false, "message": "<error>" }` |

### Fetch helper

```ts
async function fetchPackagesByCategory(categoryId: string) {
  const res = await api.get(`/client/package-categories/${categoryId}/packages`);
  return res.data.data; // { recorded: Package[], live: LiveCourse[] }
}
```

---

## Typical flow

1. `GET /client/package-categories?page=1&limit=20` → render category grid (page through with `pagination`).
2. User taps a category → `GET /client/package-categories/:id/packages` → render the `recorded` + `live` lists.
3. For a recorded package, show `startingPrice` / `defaultPlan` on the card and the full `plans[]` on the detail screen (remember `duration` is in days).
