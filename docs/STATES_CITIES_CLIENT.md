# States & Cities — Client API (Frontend)

Two-step location dropdown: **load states → user picks a state → load that state's
cities.** Cities can now be filtered by `stateId`.

Base URL: `/api/v1/client/address`
Auth: **public** (no Bearer token) — these are location dropdowns. (Address CRUD on
the same module is auth'd, but the dropdowns below are not.)

Response envelope: `{ "success": true, "data": ... }`.

---

## 1. List states — `GET /api/v1/client/address/states`

**Query params**
- `search` *(optional)* — case-insensitive substring match on state `name`.

**Response 200**
```json
{
  "success": true,
  "data": [
    { "_id": "6a19a61d...", "name": "Gujarat", "stateCode": "GJ" },
    { "_id": "6a19a635...", "name": "Maharastra", "stateCode": "MH" }
  ]
}
```
Sorted by `name` ascending. Use `_id` as the `stateId` for the cities call below.

---

## 2. List cities — `GET /api/v1/client/address/cities`

**Query params**

| Param     | Type              | Notes |
|-----------|-------------------|-------|
| `stateId` | string (ObjectId) | **NEW.** Filter to one state's cities. **Optional** — omit to get all cities (unchanged behavior). Invalid id → `400 { message: "Invalid stateId." }`. |
| `search`  | string            | Case-insensitive substring on city `name`. Combines with `stateId`. |

**Recommended flow:** once the user selects a state from call #1, fetch its cities:

```
GET /api/v1/client/address/cities?stateId=6a19a61d...
```

**Response 200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6a19...",
      "name": "Gandhinagar",
      "image": "https://.../gandhinagar.jpg",
      "stateId": { "_id": "6a19a61d...", "name": "Gujarat", "stateCode": "GJ" },
      "order": 0,
      "status": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```
Sorted by `order` then `name`. `stateId` is **populated** to `{ _id, name, stateCode }`
(or `null` if a city has not yet been assigned a state — see note).

---

## FE integration notes

- **Two calls, in order:** `GET /states` to fill the State dropdown; on selection,
  `GET /cities?stateId=<selectedStateId>` to fill the City dropdown. Clear/disable the
  City dropdown until a state is chosen.
- **Backward compatible:** calling `/cities` with **no** `stateId` still returns every
  city (for any existing screen that listed all cities). Nothing breaks if you don't
  adopt the filter.
- **`stateId` may be `null`** on a city if an admin hasn't assigned its state yet. Such a
  city will **not** appear under any `?stateId=` filter (only in the unfiltered list).
  This is a data-entry gap, not an API error — surface it to whoever manages cities.
- **Reading the state name:** prefer `city.stateId.name` (populated). The field is an
  object, not a bare id.

---

## Quick reference

| Step | Method | Path | Purpose |
|------|--------|------|---------|
| 1 | GET | `/address/states?search=` | State dropdown |
| 2 | GET | `/address/cities?stateId=<id>&search=` | City dropdown for the chosen state |

> The legacy `GET /address/states/:stateId/districts` endpoint is deprecated — use the
> `stateId`-filtered `/cities` call above instead.
