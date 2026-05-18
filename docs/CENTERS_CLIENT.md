# Offline Centers — Client API

Centers are physical learning centers that belong to a city and host batches.

> ⚠️ **Auth status (current code):** Browsing endpoints below are presently **public** (no Bearer token enforced) so the marketing site can surface them. Per project policy all client routes should require auth — flag this if it's intentional vs. an oversight.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/client/address/cities` | List active cities (with optional `?search=`). |
| `GET`  | `/api/v1/client/address/cities/:cityId/centers` | List active centers in a city, each with its active batches nested. |
| `GET`  | `/api/v1/client/offline/centers` | List all active centers (filterable by city or name). |
| `GET`  | `/api/v1/client/offline/centers/:id` | Get a single center with its city populated and active batches nested. |
| `GET`  | `/api/v1/client/offline` | Offline home dashboard (banners + cities → centers → batches + upcoming batches). |

---

## 1. `GET /address/cities`

**Query params**
- `search` *(optional)* — case-insensitive substring match on `name`.

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6601...",
      "name": "Ahmedabad",
      "order": 1,
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## 2. `GET /address/cities/:cityId/centers`

Lists active centers for a city. Each center includes its active `batches` (sorted by `startAt` ascending).

**Errors**
- `400` — `Invalid city id.`

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6700a1...",
      "name": "Satellite Branch",
      "images": ["https://cdn.example.com/centers/sat-1.jpg"],
      "address": "12, Some Road, Ahmedabad",
      "latitude": 23.0225,
      "longitude": 72.5714,
      "phone": "+919876543210",
      "cityId": "6601...",
      "status": true,
      "createdAt": "...",
      "updatedAt": "...",
      "batches": [
        {
          "_id": "6701b2...",
          "name": "Morning Batch — GS Foundation",
          "image": "https://cdn.example.com/batches/morning.jpg",
          "description": "...",
          "startAt": "2026-06-01T03:30:00.000Z",
          "duration": "6 months",
          "centerId": "6700a1...",
          "status": true,
          "createdAt": "...",
          "updatedAt": "..."
        }
      ]
    }
  ]
}
```

---

## 3. `GET /offline/centers`

Lists all active centers. `cityId` is populated to `{ _id, name }` so the client can group/label without an extra call. Sorted by `createdAt` descending.

**Query params**
| Param   | Type   | Notes |
|---------|--------|-------|
| `cityId`| string (ObjectId) | Filter to one city. Invalid ids are ignored. |
| `search`| string | Case-insensitive substring match on `name`. |

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6700a1...",
      "name": "Satellite Branch",
      "images": ["https://cdn.example.com/centers/sat-1.jpg"],
      "address": "12, Some Road, Ahmedabad",
      "latitude": 23.0225,
      "longitude": 72.5714,
      "phone": "+919876543210",
      "cityId": { "_id": "6601...", "name": "Ahmedabad" },
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

> Note: this endpoint does **not** nest `batches`. Use `/address/cities/:cityId/centers` or `/offline/centers/:id` if you need batches alongside.

---

## 4. `GET /offline/centers/:id`

Single center detail. `cityId` is **populated** to the full city document. `batches` is an array of the center's active batches.

**Errors**
- `400` — `Invalid center id.`
- `404` — `Center not found.` (also returned when `status: false`)

**Response 200**
```json
{
  "success": true,
  "data": {
    "_id": "6700a1...",
    "name": "Satellite Branch",
    "images": ["https://cdn.example.com/centers/sat-1.jpg"],
    "address": "12, Some Road, Ahmedabad",
    "latitude": 23.0225,
    "longitude": 72.5714,
    "phone": "+919876543210",
    "cityId": {
      "_id": "6601...",
      "name": "Ahmedabad",
      "order": 1,
      "status": true
    },
    "status": true,
    "createdAt": "...",
    "updatedAt": "...",
    "batches": [ /* same shape as in cities/:cityId/centers above */ ]
  }
}
```

---

## 5. `GET /offline` (dashboard — center-related sections)

The dashboard response is a discriminated array. The center-related sections:

- `type: "city"` — each city with `centers[]`, each center with `batches[]`.
- `type: "upcoming_batch"` — next 10 batches with `startAt > now`, with `centerId` populated (which itself populates `cityId.name`).

```json
{
  "success": true,
  "data": {
    "dashboard": [
      { "title": "Banner", "type": "banner", "data": [ /* banners */ ] },
      {
        "title": "City",
        "type": "city",
        "data": [
          {
            "_id": "6601...",
            "name": "Ahmedabad",
            "centers": [
              {
                "_id": "6700a1...",
                "name": "Satellite Branch",
                "batches": [ /* active batches */ ]
              }
            ]
          }
        ]
      },
      {
        "title": "Upcoming Batches",
        "type": "upcoming_batch",
        "data": [ /* batches with centerId populated (city name nested) */ ]
      }
    ]
  }
}
```

---

## Field reference — Center

| Field      | Type            | Notes |
|------------|-----------------|-------|
| `_id`      | ObjectId string | |
| `name`     | string          | Display name. |
| `images`   | string[]        | S3 image URLs. |
| `address`  | string          | Full postal address. |
| `latitude` | number          | Decimal degrees. |
| `longitude`| number          | Decimal degrees. |
| `phone`    | string          | Up to 20 chars. |
| `cityId`   | ObjectId string **or** populated City object | Raw ObjectId in list responses; populated in `GET /offline/centers/:id`. |
| `status`   | boolean         | Only `true` rows are returned. |
| `createdAt`/`updatedAt` | ISO date strings | |
| `batches`  | Batch[] (added by the API) | Active batches for this center, sorted by `startAt` ascending. Present in cities-by-city and center-detail responses. |
