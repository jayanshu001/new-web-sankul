# Package Categories — Client (App / Student Web)

Backend reference: `src/client/categories/categories.controller.ts` → `listPackageCategories`, `listPackagesByCategory`. Mounted under `/api/v1/client`.

Read-only. Only rows with `status: true` (categories) / `active: true` (packages) are returned. Auth: `Bearer <customer token>`.

---

## 1. Endpoints

### 1.1 List all package categories

```
GET /api/v1/client/package-categories
```

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "67f3...",
      "title": "NEET",
      "slug": "neet",
      "image": "https://cdn.../neet.png",
      "order": 0,
      "status": true,
      "createdAt": "2026-05-16T10:00:00.000Z",
      "updatedAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

Sorted by `order` asc.

### 1.2 Packages under a category

```
GET /api/v1/client/package-categories/:id/packages
```

`:id` is the PackageCategory `_id`. Returns all active packages whose `packageCategoryId` matches.

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "664a...",
      "name": "NEET 2026 Full Course",
      "image": "https://cdn.../pkg.png",
      "order": 0,
      "isPaid": true
    }
  ]
}
```

---

## 2. Error Responses

| Status | When | Body |
|---|---|---|
| 400 | Invalid `:id` | `{ success: false, message: "Invalid package category id" }` |
| 401 | Missing / invalid Bearer | standard auth error |
| 500 | Other | `{ success: false, message: "<reason>" }` |

---

## 3. Typical Usage

- **Browse / discovery screen**: call `/api/v1/client/package-categories` once, render tiles (image + title).
- **Tap a category tile** → call `/api/v1/client/package-categories/:id/packages` to render the packages under that category.
- For full package details, use the existing `/api/v1/client/packages/:id` endpoint (unchanged).
