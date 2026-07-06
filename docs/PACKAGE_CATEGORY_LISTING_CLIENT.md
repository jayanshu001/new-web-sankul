# Package Categories & Packages Listing (Client)

Endpoints powering the "Categories" → "View All" → "Categories Inner" flow on the client app for package categories (UPSC, NEET, SSC, Banking, etc.).

All endpoints require a Bearer token.

```
Authorization: Bearer <token>
```

---

## 1. List Package Categories

Used by both the **Categories** section on the home screen and the full **Categories** (View All) screen.

### Endpoint

```
GET /api/v1/client/package-categories
```

### Behavior

- Returns `PackageCategory` documents where `status = true`.
- Sorted ascending by `order`.
- No pagination — returns the full active list.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "_id": "66f0a1b2c3d4e5f600000010",
      "title": "UPSC",
      "slug": "upsc",
      "image": "https://cdn.example.com/categories/upsc.png",
      "order": 1,
      "status": true,
      "createdAt": "2026-04-12T08:30:00.000Z",
      "updatedAt": "2026-05-02T11:15:00.000Z"
    }
  ]
}
```

### Response Fields

| Field       | Type    | Description                                |
| ----------- | ------- | ------------------------------------------ |
| `_id`       | string  | Package category ID                        |
| `title`     | string  | Display name (e.g. `"UPSC"`)               |
| `slug`      | string  | URL-friendly unique slug                   |
| `image`     | string  | Category icon / image URL                  |
| `order`     | number  | Display order (ascending)                  |
| `status`    | boolean | Always `true` in this listing              |
| `createdAt` | string  | ISO timestamp                              |
| `updatedAt` | string  | ISO timestamp                              |

### Errors

- `401 Unauthorized` — missing / invalid token.
- `500 Internal Server Error` — `{ "success": false, "message": "<error>" }`.

### Source

- Controller: [src/client/categories/categories.controller.ts](../src/client/categories/categories.controller.ts) → `listPackageCategories`
- Route: [src/client/categories/categories.routes.ts](../src/client/categories/categories.routes.ts)

---

## 2. List Packages by Package Category

Used by the **Categories Inner** screen (e.g. tapping "UPSC" → shows packages under UPSC).

### Endpoint

```
GET /api/v1/client/package-categories/:id/packages
```

### Path Parameters

| Name | Type   | Required | Description                                |
| ---- | ------ | -------- | ------------------------------------------ |
| `id` | string | yes      | MongoDB ObjectId of the package category   |

### Behavior

- Filters `Package` documents by `packageCategoryId = :id` and `active = true`.
- Sorted ascending by `order`.
- Each package is enriched with its **pricing plans** from `PackageCourseEbookPrice` (rows where `packageId` matches and `status = true`).
- Plans are sorted with `isDefault` first, then ascending by `duration` (months).
- A convenience `defaultPlan` and `startingPrice` are also surfaced for card rendering.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "_id": "66f0a1b2c3d4e5f600000101",
      "name": "PSI Constable 2.0 Live Batch",
      "description": "Complete PSI prep with live + recorded sessions.",
      "image": "https://cdn.example.com/packages/psi-constable.jpg",
      "shareableLink": "https://app.example.com/p/psi-constable",
      "order": 1,
      "isPaid": true,
      "isMagazine": false,
      "isSmartCourse": false,
      "isPlannerCourse": false,
      "withMaterialText": "Includes printed material",
      "withoutMaterialText": "Digital only",
      "packageTypeId": "66f0a1b2c3d4e5f600000201",
      "goalId": "66f0a1b2c3d4e5f600000301",
      "educatorId": "66f0a1b2c3d4e5f600000401",
      "plans": [
        {
          "_id": "66f0a1b2c3d4e5f600000501",
          "packageId": "66f0a1b2c3d4e5f600000101",
          "name": "6 Months",
          "duration": 6,
          "price": 8999,
          "withMaterial": false,
          "materialPrice": 0,
          "isDefault": true
        },
        {
          "_id": "66f0a1b2c3d4e5f600000502",
          "packageId": "66f0a1b2c3d4e5f600000101",
          "name": "12 Months",
          "duration": 12,
          "price": 14999,
          "withMaterial": true,
          "materialPrice": 1500,
          "isDefault": false
        }
      ],
      "defaultPlan": {
        "_id": "66f0a1b2c3d4e5f600000501",
        "packageId": "66f0a1b2c3d4e5f600000101",
        "name": "6 Months",
        "duration": 6,
        "price": 8999,
        "withMaterial": false,
        "materialPrice": 0,
        "isDefault": true
      },
      "startingPrice": 8999
    }
  ]
}
```

### Response Fields

#### Package

| Field                 | Type            | Description                                         |
| --------------------- | --------------- | --------------------------------------------------- |
| `_id`                 | string          | Package ID                                          |
| `name`                | string          | Package name                                        |
| `description`         | string          | Long description                                    |
| `image`               | string          | Card image URL                                      |
| `shareableLink`       | string          | Public share link                                   |
| `order`               | number          | Display order (ascending)                           |
| `isPaid`              | boolean         | Whether the package requires payment                |
| `isMagazine`          | boolean         | Magazine-type package flag                          |
| `isSmartCourse`       | boolean         | Smart course flag                                   |
| `isPlannerCourse`     | boolean         | Planner course flag                                 |
| `withMaterialText`    | string          | Label shown when material option is included        |
| `withoutMaterialText` | string          | Label shown when material option is excluded        |
| `packageTypeId`       | string \| null  | Reference to `PackageType`                          |
| `goalId`              | string \| null  | Reference to `Goal`                                 |
| `educatorId`          | string \| null  | Reference to `CourseEducator`                       |
| `plans`               | array           | All active pricing plans for this package           |
| `defaultPlan`         | object \| null  | The plan marked `isDefault` (or first if none)      |
| `startingPrice`       | number \| null  | Convenience: `defaultPlan.price`, else `null`       |

#### Plan (`plans[]` / `defaultPlan`)

| Field           | Type    | Description                                                          |
| --------------- | ------- | -------------------------------------------------------------------- |
| `_id`           | string  | Plan ID                                                              |
| `packageId`     | string  | Parent package ID                                                    |
| `name`          | string  | Plan label (e.g. `"6 Months"`)                                       |
| `duration`      | number  | Duration in **months** (used for subscription `endAt` calculation)   |
| `price`         | number  | Base price (₹)                                                       |
| `withMaterial`  | boolean | Whether material is bundled                                          |
| `materialPrice` | number  | Additional price for material option                                 |
| `isDefault`     | boolean | Whether this is the default plan shown on the card                   |

> Packages with no active price rows return `plans: []`, `defaultPlan: null`, `startingPrice: null`.

### Errors

- `400 Bad Request` — `{ "success": false, "message": "Invalid package category id" }`
- `401 Unauthorized` — missing / invalid token.
- `500 Internal Server Error` — `{ "success": false, "message": "<error>" }`.
- Unknown but valid ObjectId → `200 OK` with `data: []`.

### Source

- Controller: [src/client/categories/categories.controller.ts](../src/client/categories/categories.controller.ts) → `listPackagesByCategory`
- Route: [src/client/categories/categories.routes.ts](../src/client/categories/categories.routes.ts)

---

## UI Mapping

| UI element                                       | Endpoint                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| Home → "Categories" grid (UPSC / NEET / SSC …)   | `GET /api/v1/client/package-categories`                                   |
| Home → "View All" → full Categories screen       | `GET /api/v1/client/package-categories`                                   |
| Tap a category → "Categories Inner" cards        | `GET /api/v1/client/package-categories/:id/packages`                      |
| Inner screen → **Recorded Class** tab            | `GET /api/v1/client/package-categories/:id/packages` *(current behavior)* |
| Inner screen → **Live Batches** tab              | Not covered here — use the live course category endpoints                 |

### Recorded Class vs. Live Batches tab

The current packages-by-category endpoint returns **all active packages** for the category and does not distinguish recorded vs. live. Two options to support the tab toggle:

1. **Client-side filter** using a flag on each package (e.g. `isSmartCourse`, `packageTypeId`) — requires extending the response projection.
2. **Live Batches tab** should hit the parallel live course flow:
   - `GET /api/v1/client/live-course-categories`
   - `GET /api/v1/client/live-course-categories/:id/live-courses`
   - See [LIVE_COURSES_BY_CATEGORY_CLIENT.md](LIVE_COURSES_BY_CATEGORY_CLIENT.md).

If you want the Recorded/Live split enforced server-side on this endpoint (e.g. a `?mode=recorded|live` query param), that's an extension we'd need to add.
