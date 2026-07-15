# Recently Added (Planner + Smart + Live) — Client (Frontend Guide)

The home dashboard's **"Recently Added"** rail and its **"View All"** screen both show
the newest items across **three kinds**, merged and sorted by created date (newest
first):

| `kind`        | source                          | notes |
|---------------|---------------------------------|-------|
| `planner`     | Package (package type = Planner) | a course package |
| `smart`       | Package (package type = Smart)   | a course package |
| `live-course` | Live course                      | |

Every item carries a `kind` **and** a coarser `type` (`"package"` \| `"live-course"`) so
you can branch rendering/navigation without a second lookup.

> Planner and Smart are **package types** on the server (`ws_package.package_type_id`).
> The server resolves them by **name** from `ws_package_type` (the same source as
> `GET /admin/packages/types`): any type whose name contains "planner" → `planner`,
> "smart" → `smart` (e.g. "Planner Course" / "Smart Course"). No env/config — renaming
> ids is safe; renaming the type away from those words would drop it from the feed.

---

## 1. Dashboard rail — inside `GET /client/dashboard`

The dashboard response's section array contains one section for this rail:

```json
{
  "title": "Recently Added",
  "type": "recently-added",
  "data": [ /* up to 5 items, newest-first, mixed kinds */ ]
}
```

- **Capped at 5 items total** (combined across the three kinds — not 5 per kind).
- `type` of the section is now `"recently-added"` (previously `"package"`).
- Each `data[]` item is a **Recently-Added card** (shape below).
- Wire the rail's "View All" button to the endpoint in §2.

---

## 2. View All — `GET /api/v1/client/recently-added`

Paginated + searchable feed of the same three kinds.

- Auth: **required** — `Authorization: Bearer <customerAccessToken>`.
- Envelope: standard `{ success, code, data, message, messages }`.

### Query params

| param    | type   | required | default | notes |
|----------|--------|----------|---------|-------|
| `page`   | int    | no       | `1`     | 1-based page index. |
| `limit`  | int    | no       | `20`    | Page size, clamped to `[1, 100]`. |
| `search` | string | no       | —       | Case-insensitive match on the item name/title. |
| `kind`   | string | no       | all     | CSV filter, any of `planner,smart,live-course`. Omitted/invalid → all three. |

`kind` examples: `?kind=planner` (only Planner packages), `?kind=planner,smart`
(both package kinds, no live), `?kind=live-course`.

### Example

```
GET /api/v1/client/recently-added?kind=planner,smart,live-course&search=gpsc&page=1&limit=20
Authorization: Bearer <token>
```

### Success — 200

```json
{
  "success": true,
  "code": 200,
  "data": {
    "data": [
      {
        "_id": "4",
        "kind": "live-course",
        "type": "live-course",
        "title": "GPSC Non-Featured Batch",
        "name": "GPSC Non-Featured Batch",
        "image": "https://cdn.websankul.com/live/gpsc.jpg",
        "isPaid": true,
        "isPurchased": false,
        "daysLeft": null,
        "plans": [
          { "_id": "41", "liveCourseId": "4", "name": "1 Year", "duration": 365, "price": 9800, "originalPrice": 12000, "isDefault": true, "status": true }
        ],
        "createdAt": "2026-07-14T09:12:00.000Z"
      },
      {
        "_id": "990092",
        "kind": "planner",
        "type": "package",
        "title": "GPSC Planner 2026",
        "name": "GPSC Planner 2026",
        "image": "https://cdn.websankul.com/pkg/planner.jpg",
        "packageType": { "_id": "3", "name": "Planner" },
        "isPaid": true,
        "isPurchased": true,
        "daysLeft": 210,
        "plans": {
          "withMaterial": [ { "_id": "5501", "packageId": "990092", "duration": 365, "price": 5999, "withMaterial": true, "status": true } ],
          "withoutMaterial": [ { "_id": "5500", "packageId": "990092", "duration": 365, "price": 4999, "withMaterial": false, "status": true } ]
        },
        "createdAt": "2026-07-13T06:40:00.000Z"
      }
    ],
    "kinds": ["planner", "smart", "live-course"],
    "pagination": { "total": 37, "page": 1, "limit": 20, "totalPages": 2 }
  },
  "message": "Recently added items fetched.",
  "messages": {}
}
```

> Note the payload nests `data.data` (the item array) alongside `data.pagination` — the
> outer `data` is the standard envelope, the inner `data` is the list.

---

## 3. Card shape (`data[]` items)

### Common fields (all kinds)

- `_id` — id of the package **or** live course (scoped by `kind`/`type`).
- `kind` — `"planner" | "smart" | "live-course"`. Use for badges/filters.
- `type` — `"package" | "live-course"`. Use to choose the detail route.
- `title` / `name` — display name (identical value; `title` is the stable label).
- `image` — thumbnail URL (nullable).
- `isPaid` — always `true` for these kinds.
- `isPurchased` — `true` if the user currently owns it (active subscription).
- `daysLeft` — remaining days on an owned item; `null` = not owned **or** lifetime.
- `createdAt` — used for the newest-first ordering; safe to show "Added on".

### Kind-specific fields

**`type: "package"`** (`kind` = `planner` | `smart`)
- `packageType` — `{ _id, name }` of the package type.
- `plans` — an **object**: `{ withMaterial: Plan[], withoutMaterial: Plan[] }`
  (matches the existing package card). Pick a bucket per the material toggle.

**`type: "live-course"`** (`kind` = `live-course`)
- Carries the full live-course listing card fields (`subtitle`, `level`, `classType`,
  `startTime`, `courseEducatorId`, `packageCategoryId`, `shareableLink`, …).
- `plans` — an **array** `Plan[]` (same as the live-course listing). Use `plans[0]` or
  the `isDefault` plan for the price.

> ⚠️ `plans` differs by kind: **object** for packages, **array** for live courses.
> Branch on `type` before reading `plans`.

### Navigation

| `type`         | detail route |
|----------------|--------------|
| `package`      | `GET /api/v1/client/packages/:id` |
| `live-course`  | `GET /api/v1/client/live-courses/:id` |

---

## 4. Pagination

- `pagination.total` is the exact combined count for the active `kind`/`search` filter.
- `pagination.totalPages` is precomputed; or use `page * limit < total` for infinite scroll.

## 5. Errors

| status | when |
|--------|------|
| 401 | missing/invalid bearer token |
| 500 | unexpected server error |

## 6. Backend reference

- Dashboard section: `src/modules/client-dashboard/client-dashboard.service.ts` → `buildHomeDashboard` (section `type: "recently-added"`, limit 5).
- View All route: `src/client/recently-added/recently-added.routes.ts` (`GET /recently-added`).
- Controller: `src/client/recently-added/recently-added.controller.ts` → `listRecentlyAdded`.
- Service: `src/modules/client-recently-added/client-recently-added.service.ts` → `listRecentlyAdded`.
- Type→kind resolution: `client-recently-added.service.ts` → `resolveKindTypeIds` (name match on `ws_package_type`, no env).
