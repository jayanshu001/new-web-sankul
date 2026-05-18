# Package Module — Client API

Everything the client app needs to discover, browse, and view packages. All endpoints require a Bearer token.

```
Authorization: Bearer <customer-token>
```

Two routers contribute:
- `/api/v1/client/packages/*` — flat listing, detail, my-subscriptions, chat. Source: [src/client/package/](../src/client/package/).
- `/api/v1/client/package-categories/*` + `/api/v1/client/{video,material,exam}-categories/*` — category discovery, packages-by-category, drill-down. Source: [src/client/categories/categories.controller.ts](../src/client/categories/categories.controller.ts).

---

## Endpoint Map

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/api/v1/client/package-categories` | List active package categories (UPSC / NEET / SSC …). |
| 2 | GET | `/api/v1/client/package-categories/:id/packages` | Packages in a category, each card enriched with plans + `startingPrice`. |
| 3 | GET | `/api/v1/client/packages` | Flat paginated listing of active packages (filters: search / type / goal / flags). |
| 4 | GET | `/api/v1/client/packages/types` | Active `PackageType`s. |
| 5 | GET | `/api/v1/client/packages/type/:typeId` | Packages of a given type, each enriched with plans + subscriber count. |
| 6 | GET | `/api/v1/client/packages/goal?labelIds=…` | Packages grouped per goal-label (input from `/client/goals/my-goals`). |
| 7 | GET | `/api/v1/client/packages/my` | Current customer's active package subscriptions (populated). |
| 8 | GET | `/api/v1/client/packages/:id` | **Full package detail** (videos / materials / tests with child-category flags, plans, promo codes, purchase status). |
| 9 | GET | `/api/v1/client/{video,material,exam}-categories/:id/children` | Drill-down: children of a category, each with its own `havingChildDirectory` + `count`. |
| 10 | GET | `/api/v1/client/packages/:packageId/chat` | Subscription-gated package chat (paginated). |

> Route order matters: `/packages/types`, `/packages/type/:typeId`, `/packages/goal`, `/packages/my` are declared before the catch-all `/packages/:id` in [src/client/package/package.routes.ts](../src/client/package/package.routes.ts).

---

## 1. `GET /package-categories`

Active package categories sorted by `order` asc. No pagination.

**Response 200**
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

---

## 2. `GET /package-categories/:id/packages`

All `active: true` packages with `packageCategoryId = :id`, sorted by `order` asc. Each package card is enriched with plans + a convenience `defaultPlan` + `startingPrice`.

**Errors**
- `400` — `Invalid package category id`
- A valid but unknown `:id` returns `200` with `data: []`.

**Response 200**
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
        { "_id": "…01", "packageId": "…101", "name": "6 Months", "duration": 6, "price": 8999, "withMaterial": false, "materialPrice": 0, "isDefault": true },
        { "_id": "…02", "packageId": "…101", "name": "12 Months", "duration": 12, "price": 14999, "withMaterial": true, "materialPrice": 1500, "isDefault": false }
      ],
      "defaultPlan": { "_id": "…01", "name": "6 Months", "duration": 6, "price": 8999, "withMaterial": false, "materialPrice": 0, "isDefault": true },
      "startingPrice": 8999
    }
  ]
}
```

**Plan sort:** `isDefault` first, then `duration` (months) asc. Packages with no active plans return `plans: []`, `defaultPlan: null`, `startingPrice: null`.

> The `duration` field on plans is **months** — used by the server to compute subscription `endAt`.

---

## 3. `GET /packages`

Flat paginated listing of active packages.

**Query params**
| Param            | Type    | Notes |
|------------------|---------|-------|
| `search`         | string  | Case-insensitive substring match on `name`. |
| `isMagazine`     | `"true"`/`"false"` | Filter by magazine flag. |
| `packageTypeId`  | ObjectId | |
| `goalId`         | ObjectId | |
| `isSmartCourse`  | `"true"`/`"false"` | |
| `isPlannerCourse`| `"true"`/`"false"` | |
| `page`           | number  | Default `1`. |
| `limit`          | number  | Default `20`. |

Sort: `order` asc, then `createdAt` desc. Returns plans (split into `withMaterial`/`withoutMaterial`) + `subscriberCount` per package.

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "…101",
      "name": "PSI Constable 2.0 Live Batch",
      "packageTypeId": { "_id": "…201", "name": "Live" },
      "goalId": { "_id": "…301", "title": "State PSC" },
      "image": "...",
      "order": 1,
      "active": true,
      "plans": {
        "withMaterial": [ /* PackageCourseEbookPrice rows */ ],
        "withoutMaterial": [ /* … */ ]
      },
      "subscriberCount": 1284
    }
  ],
  "pagination": { "total": 47, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

## 4. `GET /packages/types`

Active `PackageType` documents, sorted by `order` asc then `name`.

```json
{ "success": true, "data": [ { "_id": "…", "name": "Live", "order": 1, "active": true } ] }
```

---

## 5. `GET /packages/type/:typeId`

Same enrichment as `/packages` (plans split + subscriberCount), filtered to one type.

**Errors:** `400 Invalid type id.`

---

## 6. `GET /packages/goal?labelIds=id1,id2,id3`

Returns **one entry per requested label** (preserving input order), each with the label's metadata and enriched packages nested inside the `label` object. Driven by labels from `/client/goals/my-goals`.

**Errors**
- `400` — `labelIds query param is required (comma-separated).`
- `400` — `No valid label ids supplied.` (none of the ids parse as ObjectIds)

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "label": {
        "_id": "66f0…label1",
        "name": "Prelims",
        "goalId": "66f0…goal1",
        "goalTitle": "UPSC CSE",
        "packages": [ /* enriched packages (same shape as /packages data items) */ ]
      }
    }
  ]
}
```

Labels that resolve to nothing still appear in the array with `packages: []` and `name/goalId/goalTitle = null`.

---

## 7. `GET /packages/my`

Current customer's active package subscriptions (i.e. `status: true` and `endAt > now` OR `endAt: null`).

**Response 200** — `data` is an array of `PackageCourseSubscription` documents with `packageId` populated (which itself has `packageTypeId` and `goalId` populated). Sorted by `createdAt` desc.

```json
{
  "success": true,
  "data": [
    {
      "_id": "…sub",
      "customerId": "…cust",
      "packageId": {
        "_id": "…101",
        "name": "PSI Constable 2.0 Live Batch",
        "packageTypeId": { "_id": "…201", "name": "Live" },
        "goalId": { "_id": "…301", "title": "State PSC" }
      },
      "status": true,
      "startAt": "2026-04-01T00:00:00.000Z",
      "endAt": "2026-10-01T00:00:00.000Z"
    }
  ]
}
```

---

## 8. `GET /packages/:id` — **Package Detail**

The big one. Returns the package header, plus three category-grouped sections (`videos`, `materials`, `tests`), all available pricing plans (split by `withMaterial`), available public promo codes, and the caller's purchase status.

**The "child-category condition":** Each category entry inside `videos` / `materials` / `tests` carries:
- `havingChildDirectory` — `true` when the category's own `childCategoryIds[]` array has at least one entry.
- `count` — number of direct items (videos / materials / exams) under the category.

> All three category types now use the same shape — a `childCategoryIds: ObjectId[]` array stored on the **parent** that lists its direct children. `havingChildDirectory` is just `childCategoryIds.length > 0`. No relation tables, no per-row parent-pointer lookups.

Use `havingChildDirectory` to decide whether tapping the card should drill into a child-category screen (endpoint #9) or open the items list directly.

| Section    | Items source                                | `count` counts                         |
|------------|---------------------------------------------|----------------------------------------|
| `videos`   | `specificSubjects[].category`               | `Video` rows with `status: true`       |
| `materials`| `materialCategories[].category`             | `Material` rows with `status: true`    |
| `tests`    | `examCategories[].category`                 | `Exam` rows (no status filter)         |

For all three, `havingChildDirectory` is derived from the populated category document's own `childCategoryIds.length > 0`.

**Errors**
- `400` — `Invalid package id.`
- `404` — `Package not found.` (also if `active: false`)

**Response 200**
```json
{
  "success": true,
  "data": {
    "package": {
      "_id": "66f0…101",
      "name": "PSI Constable 2.0 Live Batch",
      "description": "…",
      "image": "https://cdn.example.com/packages/psi-constable.jpg",
      "shareableLink": "https://app.example.com/p/psi-constable",
      "withMaterialText": "Includes printed material",
      "withoutMaterialText": "Digital only",
      "packageType": { "_id": "…201", "name": "Live" },
      "goal": { "_id": "…301", "title": "State PSC" },
      "isPaid": true,
      "isPurchased": true
    },

    "videos": [
      {
        "category": {
          "_id": "…vc1",
          "title": "Polity",
          "image": "https://cdn.example.com/cats/polity.png",
          "childCategoryIds": ["…vc1-a", "…vc1-b"],
          "havingChildDirectory": true,
          "count": 24
        }
      }
    ],

    "materials": [
      {
        "category": {
          "_id": "…mc1",
          "title": "Current Affairs",
          "childCategoryIds": [],
          "havingChildDirectory": false,
          "count": 12
        }
      }
    ],

    "tests": [
      {
        "category": {
          "_id": "…ec1",
          "name": "Prelims Mock Tests",
          "title": "Prelims Mock Tests",
          "childCategoryIds": ["…ec1-a"],
          "havingChildDirectory": true,
          "count": 8
        }
      }
    ],

    "plans": {
      "withMaterial": [ /* PackageCourseEbookPrice rows, sorted by duration asc */ ],
      "withoutMaterial": [ /* … */ ]
    },

    "availablePromoCode": [
      { "title": "Diwali Offer", "promocode": "FEST20", "description": "20% off on all plans" }
    ]
  }
}
```

### Field reference

#### `package`
| Field                 | Type        | Notes |
|-----------------------|-------------|-------|
| `_id`                 | ObjectId    | |
| `name`, `description`, `image` | string | |
| `shareableLink`       | string      | Public share link. |
| `withMaterialText`    | string      | Copy shown next to "with material" plan toggle. |
| `withoutMaterialText` | string      | Copy shown next to "without material" plan toggle. |
| `packageType`         | populated `{ _id, name }` | |
| `goal`                | populated `{ _id, title }` | |
| `isPaid`              | boolean     | |
| `isPurchased`         | boolean     | `true` if the caller has an active subscription to this package. `false` for guests. |

#### Each `videos[i] / materials[i] / tests[i]`
Wrapper object `{ category: { … } }`. Inside `category`:

| Field                  | Type           | Notes |
|------------------------|----------------|-------|
| `_id`                  | ObjectId       | |
| `title`                | string         | For exam categories, populated from the underlying `name` field. |
| `image` / other fields | varies         | The full populated category document is spread in. |
| `childCategoryIds`     | ObjectId[]     | Direct children of this category (canonical source of truth). |
| `havingChildDirectory` | boolean        | Convenience flag — equivalent to `childCategoryIds.length > 0`. |
| `count`                | number         | Items directly under this category (videos/materials/exams). |

Refs come from the package's own arrays (`specificSubjects` / `materialCategories` / `examCategories`) — only entries with `status !== false` are included, sorted by `order` asc.

#### `plans`
| Field             | Type    | Notes |
|-------------------|---------|-------|
| `withMaterial`    | Plan[]  | `PackageCourseEbookPrice` rows where `withMaterial: true`, sorted by `duration` asc. |
| `withoutMaterial` | Plan[]  | Same, `withMaterial: false`. |

Plan shape: `{ _id, packageId, name, duration (months), price, withMaterial, materialPrice, isDefault, status, … }`.

#### `availablePromoCode`
Only public, currently-valid codes for plans of this package. Deduped by promocode string.

| Field        | Type   |
|--------------|--------|
| `title`      | string |
| `promocode`  | string |
| `description`| string |

A code is included only when **all** of these hold: `type === "public"`, `status !== false`, `now ≥ promo_start_at` (if set), `now ≤ promo_expire_at` (if set).

---

## 9. Category Children (drill-down)

When a category in the package detail response has `havingChildDirectory: true`, use these endpoints to fetch the next level. Each child entry carries the same `childCategoryIds` array + derived flags so the client can keep nesting until it hits a leaf.

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/v1/client/video-categories/:id/children`    | Children of a video category. |
| `GET`  | `/api/v1/client/material-categories/:id/children` | Children of a material category. |
| `GET`  | `/api/v1/client/exam-categories/:id/children`     | Children of an exam (test) category. |

**Errors (all three):**
- `400` — `Invalid category id.`
- `404` — `Video / Material / Exam category not found.`

**Common response shape**
```json
{
  "success": true,
  "data": {
    "parent": { /* the requested category document (lean) — has its own childCategoryIds[] */ },
    "list": [
      {
        "category": {
          "_id": "…childA",
          "title": "Indian Polity > Constitution",
          "image": "https://…",
          "childCategoryIds": [],
          "havingChildDirectory": false,
          "count": 14
        }
      },
      {
        "category": {
          "_id": "…childB",
          "title": "Indian Polity > Acts & Amendments",
          "childCategoryIds": ["…grand1"],
          "havingChildDirectory": true,
          "count": 0
        }
      }
    ]
  }
}
```

### How children are loaded
All three endpoints read the same way:

1. Look up the parent document.
2. Read its `childCategoryIds[]` array.
3. Fetch those child documents (only `status: true` are returned) and sort by the category-type's natural order field (`order_by` / `order` / `orderBy`).
4. For each returned child: `count` is queried against the item collection (`Video` / `Material` / `Exam`), and `havingChildDirectory` is `child.childCategoryIds.length > 0`.

| Endpoint                                       | Sort field | `count` query                              |
|------------------------------------------------|------------|---------------------------------------------|
| `/video-categories/:id/children`               | `order_by` asc | `Video.{ videoCategoryId, status: true }` |
| `/material-categories/:id/children`            | `order` asc    | `Material.{ materialCategoryId, status: true }` |
| `/exam-categories/:id/children`                | `orderBy` asc  | `Exam.{ categoryId }` (no status filter)  |

> Exam category documents have a `name` field instead of `title`; the API surfaces it as both for parity.

### Client drill-down pattern

```ts
async function openCategory(cat, type /* "video" | "material" | "exam" */) {
  if (!cat.havingChildDirectory) {
    // Leaf — open the items list directly.
    return openItemsList(cat._id, type);
  }
  // Drill into the next level.
  const { data } = await api.get(`/${type}-categories/${cat._id}/children`);
  renderChildScreen(data.parent, data.list);
}
```

> Same `videos[]` / `materials[]` / `tests[]` wrapper shape as package detail — each entry is `{ category: { ... } }` — so a single component can render both screens.

---

## 10. `GET /packages/:packageId/chat`

Paginated package-wide chat messages. **Gated by active subscription** to this package.

**Query params:** `page` (default `1`), `limit` (default `20`).

**Errors**
- `400` — `Invalid package id.`
- `401` — `Unauthorized.` (no `req.user`)
- `403` — `You must have an active subscription to view package chat.`

**Response 200**
```json
{
  "success": true,
  "data": [ /* PackageChat docs, sorted by createdAt desc */ ],
  "pagination": { "total": 87, "page": 1, "limit": 20, "totalPages": 5 }
}
```

---

## UI Mapping

| Screen / element                                          | Endpoint(s) |
|-----------------------------------------------------------|-------------|
| Home → "Categories" grid (UPSC / NEET / SSC …)            | (1) `/package-categories` |
| Tap a category → "Categories Inner" cards                 | (2) `/package-categories/:id/packages` |
| Browse all packages / search / filter screen              | (3) `/packages` |
| "Recommended for your goals" rail                         | (6) `/packages/goal?labelIds=…` (labels from `/client/goals/my-goals`) |
| Type-pivoted listing (e.g. "Live", "Recorded")            | (4) `/packages/types` then (5) `/packages/type/:typeId` |
| My Subscriptions / Active Packages tab                    | (7) `/packages/my` |
| Package detail page (header + Videos/Materials/Tests tabs)| (8) `/packages/:id` |
| Tap a category card on detail page                        | If `havingChildDirectory`: (9) `/{video,material,exam}-categories/:id/children`; else open items list directly. |
| Package chat tab (only if `isPurchased`)                  | (10) `/packages/:packageId/chat` |

---

## Behavior Notes

- **Unified category storage.** Video / Material / Exam categories all use `childCategoryIds: ObjectId[]` on the parent document. The client never needs to know about the legacy `parent` / `parentId` / `ancestors` fields — read `childCategoryIds` everywhere.
- **`havingChildDirectory` is derived.** It's set to `(childCategoryIds?.length ?? 0) > 0` so the client doesn't have to compute it.
- **Auth on everything.** Both routers apply `authenticate` at the top.
- **Active rows only.** All listings filter `active: true` (packages) / `status: true` (categories, plans, subcategories).
- **Plan durations are months** — clients should label as "6 Months" / "12 Months" and not try to parse as days.
- **`isPurchased`** in package detail is computed via `PackageCourseSubscription` (`status: true` AND (`endAt: null` OR `endAt > now`)).
- **`startingPrice`** in `/package-categories/:id/packages` is purely a convenience derived from `defaultPlan.price`. For full plan info, use the package detail endpoint.
- **Empty references are tolerated.** If `specificSubjects`/`materialCategories`/`examCategories` are missing, the corresponding section returns `[]`.
- **Promo codes are best-effort.** If `PromotedPackageCourseEbook` rows exist but reference a missing/private/expired promocode, they're silently filtered out.

---

## Source

- [src/client/package/package.routes.ts](../src/client/package/package.routes.ts)
- [src/client/package/package.controller.ts](../src/client/package/package.controller.ts)
- [src/client/categories/categories.routes.ts](../src/client/categories/categories.routes.ts)
- [src/client/categories/categories.controller.ts](../src/client/categories/categories.controller.ts)
