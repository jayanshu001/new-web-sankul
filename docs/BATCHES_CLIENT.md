# Offline Batches — Client API

A batch is a scheduled offline cohort that runs at a specific center.

> 🔒 **Auth (current code):** `GET /offline/batches` and `GET /offline/batches/:id` now require a **Bearer token** (authenticated customer). List endpoints are **paginated** — see the consolidated `OFFLINE_CLIENT.md` for the `page`/`limit` contract.
>
> `POST /enquiry` still uses best-effort auth: it accepts both anonymous and authenticated callers; if a Bearer token is sent it is verified and `customerId` is attached to the enquiry.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/client/offline/batches` | List active batches (filterable by center, city, upcoming, name). |
| `GET`  | `/api/v1/client/offline/batches/:id` | Get a single batch with center (and city) populated. |
| `POST` | `/api/v1/client/offline/enquiry` | Submit an enquiry for a specific batch. |
| `GET`  | `/api/v1/client/offline` | Offline home dashboard; includes the `upcoming_batch` section. |

Batches are also returned nested inside center responses — see `CENTERS_CLIENT.md` (`/address/cities/:cityId/centers`, `/offline/centers/:id`).

---

## 1. `GET /offline/batches`

Lists all active batches. `centerId` is populated to the full Center, and within it `cityId` is populated to `{ _id, name }`. Sorted by `startAt` ascending.

**Query params**
| Param      | Type   | Notes |
|------------|--------|-------|
| `centerId` | string (ObjectId) | Filter to one center. Takes precedence over `cityId`. |
| `cityId`   | string (ObjectId) | Filter to all centers in a city. Ignored if `centerId` is provided. |
| `upcoming` | `"true"` | When set, returns only batches with `startAt > now`. |
| `search`   | string | Case-insensitive substring match on `name`. |

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6701b2...",
      "name": "Morning Batch — GS Foundation",
      "image": "https://cdn.example.com/batches/morning.jpg",
      "description": "...",
      "startAt": "2026-06-01T03:30:00.000Z",
      "duration": "6 months",
      "centerId": {
        "_id": "6700a1...",
        "name": "Satellite Branch",
        "address": "...",
        "phone": "+919876543210",
        "cityId": { "_id": "6601...", "name": "Ahmedabad" }
      },
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## 2. `GET /offline/batches/:id`

Returns a single active batch. The `centerId` field is **populated** to the full Center document, and that center's `cityId` is **populated** to the full City document.

**Errors**
- `400` — `Invalid batch id.`
- `404` — `Batch not found.` (also returned when `status: false`)

**Response 200**
```json
{
  "success": true,
  "data": {
    "_id": "6701b2...",
    "name": "Morning Batch — GS Foundation",
    "image": "https://cdn.example.com/batches/morning.jpg",
    "description": "Comprehensive 6-month foundation course covering ...",
    "startAt": "2026-06-01T03:30:00.000Z",
    "duration": "6 months",
    "centerId": {
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
      "status": true
    },
    "status": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## 3. `POST /offline/enquiry`

Submit an enquiry for a specific batch. Works for both anonymous and authenticated users — if `Authorization: Bearer <token>` is provided, the resulting enquiry is attached to that customer.

**Request body**
```json
{
  "name": "Rahul Patel",
  "email": "rahul@example.com",
  "mobile": "+919876543210",
  "qualification": "B.Sc",
  "batchId": "6701b2c5e2b40012ab34cd00",
  "remarks": "Interested in morning batch"
}
```

| Field           | Type   | Required | Constraints |
|-----------------|--------|----------|-------------|
| `name`          | string | yes      | 1–255 chars |
| `email`         | string | yes      | valid email, ≤255 chars |
| `mobile`        | string | yes      | 6–20 chars |
| `qualification` | string | yes      | 1–255 chars |
| `batchId`       | string | yes      | 24-char ObjectId hex |
| `remarks`       | string | no       | ≤2000 chars |

**Errors**
- `400` — Zod validation errors (`{ success: false, errors: [...] }`)
- `404` — `Batch not found.`

**Response 201**
```json
{
  "success": true,
  "data": {
    "_id": "6710f0...",
    "customerId": "65f1...",          // null if anonymous
    "name": "Rahul Patel",
    "email": "rahul@example.com",
    "mobile": "+919876543210",
    "qualification": "B.Sc",
    "batchId": "6701b2c5e2b40012ab34cd00",
    "remarks": "Interested in morning batch",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## 4. `GET /offline` (dashboard — `upcoming_batch` section)

The dashboard returns up to 10 batches with `startAt > now`, sorted by `startAt` ascending. Each batch has `centerId` populated, and within it `cityId` is populated with `name` only.

```json
{
  "title": "Upcoming Batches",
  "type": "upcoming_batch",
  "data": [
    {
      "_id": "6701b2...",
      "name": "Morning Batch — GS Foundation",
      "image": "https://cdn.example.com/batches/morning.jpg",
      "description": "...",
      "startAt": "2026-06-01T03:30:00.000Z",
      "duration": "6 months",
      "centerId": {
        "_id": "6700a1...",
        "name": "Satellite Branch",
        "address": "...",
        "phone": "+919876543210",
        "cityId": { "_id": "6601...", "name": "Ahmedabad" }
      },
      "status": true
    }
  ]
}
```

---

## Field reference — Batch

| Field        | Type            | Notes |
|--------------|-----------------|-------|
| `_id`        | ObjectId string | |
| `name`       | string          | Display name. |
| `image`      | string          | S3 image URL. |
| `description`| string          | Long-form description. |
| `startAt`    | string (ISO date) | Batch start date/time. |
| `duration`   | string          | Free-text, e.g. `"6 months"`, `"12 weeks"`. |
| `centerId`   | ObjectId string **or** populated Center object | Raw ObjectId in list-nested responses; populated in `GET /offline/batches/:id` (also nests `cityId`). |
| `status`     | boolean         | Only `true` rows are returned. |
| `createdAt`/`updatedAt` | ISO date strings | |

## Behavior notes
- Only batches with `status: true` are returned from any client endpoint.
- The `upcoming_batch` dashboard section filters `startAt > now`; the centers-nested batches do **not** filter by `startAt`, so already-started but still-active batches appear there.
- `duration` is a free-text string, not a number — don't try to parse it as months/weeks.
