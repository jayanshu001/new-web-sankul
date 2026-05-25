# Package Categories — Client APIs

Auth: all endpoints require `Authorization: Bearer <token>`.

Base path: `/client/categories` (mount prefix per app router).

---

## 1. `GET /package-categories`

Lists active package categories, sorted by `order`.

### Query params

| Param  | Type    | Required | Description                                                                 |
| ------ | ------- | -------- | --------------------------------------------------------------------------- |
| `live` | boolean | no       | When `true`, returns only categories that have at least one active LiveCourse. Any other value (or omitted) returns all active categories. |

### Examples

```
GET /package-categories
GET /package-categories?live=true
```

### Response — 200

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f...",
      "title": "PSI",
      "slug": "psi",
      "image": "https://...",
      "order": 1,
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### Behavior notes

- `?live=true` is intended for screens that only make sense when live batches exist (e.g., a "Live Batches" landing page).
- For the default tabbed UI (Recorded + Live Batches under one category), call this endpoint **without** `live` so the user sees every category, then drill in.

---

## 2. `GET /package-categories/:id/packages`

Returns both **recorded packages** and **live courses** belonging to a single package category. Drives the screen shown in the mock (PSI → Recorded Class / Live Batches tabs).

### Path params

| Param | Description           |
| ----- | --------------------- |
| `id`  | PackageCategory `_id` |

### Response — 200

```json
{
  "success": true,
  "data": {
    "recorded": [
      {
        "_id": "...",
        "name": "Constable",
        "description": "...",
        "image": "https://...",
        "shareableLink": "...",
        "order": 1,
        "isPaid": true,
        "isMagazine": false,
        "isSmartCourse": false,
        "isPlannerCourse": false,
        "withMaterialText": "",
        "withoutMaterialText": "",
        "packageTypeId": "...",
        "goalId": "...",
        "educatorId": "...",
        "plans": [
          {
            "_id": "...",
            "packageId": "...",
            "name": "6 Months",
            "duration": 6,
            "price": 8999,
            "withMaterial": false,
            "materialPrice": 0,
            "isDefault": true
          }
        ],
        "defaultPlan": { "...": "same shape as plans[0]" },
        "startingPrice": 8999
      }
    ],
    "live": [
      {
        "_id": "...",
        "name": "PSI Constable 2.0 Live Batch",
        "description": "...",
        "image": "https://...",
        "shareableLink": "...",
        "ordered": 1,
        "isPaid": true,
        "isPopular": false,
        "level": "Beginner",
        "classType": "live",
        "withMaterial": "",
        "withoutMaterial": "",
        "courseEducatorId": "..."
      }
    ]
  }
}
```

### Field guide

**`recorded[]`** — `Package` documents (currently rendered under the "Recorded Class" tab):
- `plans[]` is sorted with `isDefault` first, then ascending `duration` (months).
- `defaultPlan` is `plans.find(p => p.isDefault) ?? plans[0] ?? null`.
- `startingPrice` is `defaultPlan.price` (or `null` if there are no plans).
- `duration` on plans is in **months** — use it to compute renewal/expiry on the FE.

**`live[]`** — `LiveCourse` documents (rendered under the "Live Batches" tab):
- `ordered` (not `order`) is the sort key on live courses.
- `classType` is one of `"live" | "live_offline" | "offline"`. Render `"live_offline"` as "Live + Offline".
- Live courses don't carry inline pricing here; fetch detail via the live-course detail endpoint when the user taps a row.

### Error responses

| Status | Body                                                          | When                          |
| ------ | ------------------------------------------------------------- | ----------------------------- |
| 400    | `{ success: false, message: "Invalid package category id" }` | `:id` is not a valid ObjectId |
| 500    | `{ success: false, message: "<error>" }`                      | Unexpected server error       |

---

## FE integration recipe

1. **Category list screen**: `GET /package-categories` → render every category card.
2. **Live-only landing (optional)**: `GET /package-categories?live=true` → render only categories with live batches.
3. **Category detail (screenshot)**:
   - `GET /package-categories/:id/packages`
   - Keep `data.recorded` and `data.live` in two local arrays.
   - Tab toggle just switches which array is rendered — no extra network call.
   - If `data.live.length === 0`, disable / hide the "Live Batches" tab.
