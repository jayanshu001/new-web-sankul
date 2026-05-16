# Package Categories — Client (App / Student Web)

Backend reference: `src/client/categories/categories.controller.ts` → `listPackageCategories`, `listCategoriesByPackage`. Routes mounted under `/api/v1/client`.

Read-only endpoints. Only rows with `status: true` are returned. Sorted by `order` asc.

---

## 1. Auth

Both endpoints require a customer Bearer token:

```
Authorization: Bearer <customer token>
```

---

## 2. Endpoints

### 2.1 List Package Categories (optionally filtered by package)

```
GET /api/v1/client/package-categories
GET /api/v1/client/package-categories?packageId=<packageId>
```

| Query | Type | Required | Notes |
|---|---|---|---|
| `packageId` | ObjectId string | – | If provided, returns only categories under that Package |

**200 OK**
```json
{
  "success": true,
  "data": [
    {
      "_id": "67f3...",
      "title": "UPSC Prelims Pack",
      "slug": "upsc-prelims-pack",
      "image": "https://cdn.../pkg-cat.png",
      "packageId": {
        "_id": "664a...",
        "name": "UPSC 2026 Foundation",
        "image": "https://cdn.../pkg.png"
      },
      "order": 0,
      "status": true,
      "createdAt": "2026-05-16T10:00:00.000Z",
      "updatedAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

### 2.2 Categories under one Package (path style)

```
GET /api/v1/client/packages/:id/categories
```

`:id` is the Package `_id`.

**200 OK** — same shape as above, but `packageId` is the raw ObjectId string (not populated), since the client already knows the package.

```json
{
  "success": true,
  "data": [
    {
      "_id": "67f3...",
      "title": "UPSC Prelims Pack",
      "slug": "upsc-prelims-pack",
      "image": "https://cdn.../pkg-cat.png",
      "packageId": "664a...",
      "order": 0,
      "status": true,
      "createdAt": "2026-05-16T10:00:00.000Z",
      "updatedAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

---

## 3. Error Responses

| Status | When | Body |
|---|---|---|
| 400 | Invalid `packageId` or `:id` | `{ success: false, message: "Invalid packageId" }` / `"Invalid package id"` |
| 401 | Missing / invalid Bearer | standard auth error |
| 500 | Other | `{ success: false, message: "<reason>" }` |

---

## 4. Typical Usage

- **Package detail screen**: call `/api/v1/client/packages/:id/categories` to render the category tiles under the selected package.
- **Browse / discovery**: call `/api/v1/client/package-categories` once and group client-side by `packageId.name`.
- Images are absolute URLs — render directly.
- Order is authoritative — render in the array order returned by the server (already sorted by `order` asc).
