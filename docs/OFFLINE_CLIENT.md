# Offline Centers & Batches — Client API (Frontend Doc)

Consolidated frontend reference for the three offline browsing endpoints:
**centers list**, **center detail**, and **batches list**. These mirror the admin
endpoints (`/admin/offline/centers`, `/admin/offline/batches`) but only ever return
**active** records (`status: true`) and are scoped for the customer app.

> 🔒 **Auth:** All three endpoints now require a **Bearer token** for an
> authenticated customer.
>
> ```
> Authorization: Bearer <accessToken>
> ```
>
> A missing/invalid token returns `401`; a non-customer role returns `403`
> (standard `{ success:false, code, message }` envelope).

---

## Endpoint summary

| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | `GET` | `/api/v1/client/offline/centers` | Paginated list of active centers (filter by city / name). |
| 2 | `GET` | `/api/v1/client/offline/centers/:id` | A single center with its city populated and active batches nested. |
| 3 | `GET` | `/api/v1/client/offline/batches` | Paginated list of active batches (filter by center / city / upcoming / name). |

Base URL (prod): `https://websankul-api.4tysixapplabs.com`
Base URL (local): `http://localhost:4001`

---

## Pagination contract (lists only)

Both list endpoints (1 and 3) accept and return pagination:

**Query params**

| Param   | Type   | Default | Notes |
|---------|--------|---------|-------|
| `page`  | number | `1`     | 1-based. Values `< 1` are clamped to `1`. |
| `limit` | number | `20`    | Clamped to the range **1–100**. Send `limit=100` to mirror the admin screens. |

**Response shape**

```json
{
  "success": true,
  "data": [ /* array of items */ ],
  "pagination": {
    "total": 137,
    "page": 1,
    "limit": 20,
    "totalPages": 7
  }
}
```

> The detail endpoint (2) is **not** paginated and returns `{ success, data }`.

---

## 1. List centers — `GET /api/v1/client/offline/centers`

**Query params**

| Param    | Type   | Description |
|----------|--------|-------------|
| `cityId` | string (ObjectId) | Filter to one city. Ignored if not a valid ObjectId. |
| `search` | string | Case-insensitive substring match on the center `name`. |
| `page`   | number | See pagination contract. |
| `limit`  | number | See pagination contract (max 100). |

**Example**

```
GET /api/v1/client/offline/centers?cityId=6601a...&search=satellite&limit=100
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "_id": "6620aa...",
      "name": "WebSankul Satellite",
      "images": ["https://.../center1.jpg"],
      "address": "2nd Floor, ... Ahmedabad",
      "latitude": 23.0123,
      "longitude": 72.5123,
      "phone": "+919900112233",
      "cityId": { "_id": "6601a...", "name": "Ahmedabad", "image": "https://.../ahmedabad.jpg" },
      "status": true,
      "createdAt": "2026-01-10T09:00:00.000Z",
      "updatedAt": "2026-02-01T09:00:00.000Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

`cityId` is populated to `{ _id, name, image }`. Each center also carries its own
`images` array. Sorted by `createdAt` descending (newest first).

---

## 2. Center detail — `GET /api/v1/client/offline/centers/:id`

Returns one active center with the **full** city object populated and all of the
center's **active** batches nested under `batches` (sorted by `startAt` ascending).

**Path param:** `id` — center ObjectId.

**Errors**
- `400` — invalid ObjectId.
- `404` — center not found or not active.

**Response 200**

```json
{
  "success": true,
  "data": {
    "_id": "6620aa...",
    "name": "WebSankul Satellite",
    "images": ["https://.../center1.jpg"],
    "address": "2nd Floor, ... Ahmedabad",
    "latitude": 23.0123,
    "longitude": 72.5123,
    "phone": "+919900112233",
    "cityId": {
      "_id": "6601a...",
      "name": "Ahmedabad",
      "order": 1,
      "status": true
    },
    "status": true,
    "createdAt": "...",
    "updatedAt": "...",
    "batches": [
      {
        "_id": "6630bb...",
        "name": "GPSC Foundation 2026",
        "image": "https://.../batch.jpg",
        "description": "Full-time classroom program.",
        "startAt": "2026-07-01T04:30:00.000Z",
        "duration": "12 months",
        "centerId": "6620aa...",
        "status": true,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

> Use this for the center landing screen — one call gives the center plus its batch list.

---

## 3. List batches — `GET /api/v1/client/offline/batches`

**Query params**

| Param      | Type   | Description |
|------------|--------|-------------|
| `centerId` | string (ObjectId) | Filter to one center. |
| `cityId`   | string (ObjectId) | Filter to all centers in a city. **Ignored if `centerId` is also supplied.** |
| `upcoming` | `"true"` | When `true`, only batches whose `startAt` is in the future. |
| `search`   | string | Case-insensitive substring match on the batch `name`. |
| `page`     | number | See pagination contract. |
| `limit`    | number | See pagination contract (max 100). |

**Example**

```
GET /api/v1/client/offline/batches?cityId=6601a...&upcoming=true&limit=100
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "data": [
    {
      "_id": "6630bb...",
      "name": "GPSC Foundation 2026",
      "image": "https://.../batch.jpg",
      "description": "Full-time classroom program.",
      "startAt": "2026-07-01T04:30:00.000Z",
      "duration": "12 months",
      "centerId": {
        "_id": "6620aa...",
        "name": "WebSankul Satellite",
        "images": ["https://.../center1.jpg"],
        "address": "2nd Floor, ... Ahmedabad",
        "phone": "+919900112233",
        "cityId": { "_id": "6601a...", "name": "Ahmedabad", "image": "https://.../ahmedabad.jpg" }
      },
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "total": 34, "page": 1, "limit": 20, "totalPages": 2 }
}
```

`centerId` is populated with the full center — including its `images` array — which in
turn has its `cityId` populated to `{ _id, name, image }`. Each batch also carries its
own `image`. Sorted by `startAt` ascending (soonest first).

---

## Field reference

**Center**

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | |
| `name` | string | |
| `images` | string[] | CDN URLs |
| `address` | string | |
| `latitude` / `longitude` | number | For map pin |
| `phone` | string | |
| `cityId` | object | Populated `{ _id, name }` in lists; full city in detail |
| `status` | boolean | Always `true` for client responses |
| `batches` | array | Only in center detail (#2) and `/address/cities/:cityId/centers` |

**Batch**

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | |
| `name` | string | |
| `image` | string | single CDN URL |
| `description` | string | |
| `startAt` | ISO date | Batch start |
| `duration` | string | Free-text, e.g. `"12 months"` |
| `centerId` | object | Populated center (with nested `cityId`) in lists |
| `status` | boolean | Always `true` for client responses |

---

## Error envelope

All errors use the standard wrapper:

```json
{ "success": false, "code": 401, "data": {}, "message": "Authentication token is required.", "messages": {} }
```

| Status | When |
|--------|------|
| `400` | Invalid ObjectId (detail endpoint). |
| `401` | Missing / invalid / expired Bearer token. |
| `403` | Token is valid but the role is not `customer`. |
| `404` | Center not found (detail endpoint). |
| `500` | Unexpected server error. |

---

## Related docs

- `CENTERS_CLIENT.md` — original centers + city-scoped endpoints.
- `BATCHES_CLIENT.md` — batches + enquiry submission.
- The offline **dashboard** (`GET /api/v1/client/offline`) and **enquiry**
  (`POST /api/v1/client/offline/enquiry`) endpoints are unchanged and documented there.
