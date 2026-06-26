# Recent Search History API — Client (Frontend Guide)

Per-customer **recent search history** for the search screen. Shows the user's
latest **10** searches, newest first. Re-searching an existing term moves it back
to the top (no duplicates), and anything older than the newest 10 is dropped
automatically by the server.

## Conventions

- Base path: `/api/v1/client/search/history`
- Auth: **required** on every endpoint. Send `Authorization: Bearer <customerAccessToken>`.
- Response envelope (standard for these endpoints):
  ```json
  { "success": true, "code": 200, "data": {}, "message": "", "messages": {} }
  ```

## How recording works (IMPORTANT — no extra call needed)

You do **not** call any "save search" API. History is recorded **automatically**
on the server whenever the user runs the normal global search:

```
GET /api/v1/client/search?q=<term>&type=<type>&page=1
```

Recording rules (handled server-side):
- Only the **first page** (`page=1`) of a search is recorded — paginating an
  existing query does not re-stamp it.
- The term must be **≥ 2 characters** (after trimming). Shorter terms are ignored.
- The term is **normalized** before storage: trimmed, internal whitespace
  collapsed, and **lowercased**. So `"  UPSC "`, `"upsc"`, and `"UPSC"` all map to
  the single entry `"upsc"`. Note: stored/returned `query` is **lowercase** — render
  it as-is (or title-case it client-side if you prefer).
- **Dedupe / move-to-top (case-insensitive):** searching a term already in
  history (ignoring case/whitespace) refreshes it to the top instead of adding a
  duplicate.
- **Cap 10:** after each new search, only the newest 10 entries are kept.

> Net effect: just call the existing search endpoint as you already do. The
> history list will reflect it on the next `GET /history`.

---

## 1. Get recent searches

`GET /api/v1/client/search/history`

Returns the latest 10 searches for the logged-in customer, newest first.

### Example

```
GET /api/v1/client/search/history
Authorization: Bearer <token>
```

### Success — 200

```json
{
  "success": true,
  "code": 200,
  "data": {
    "items": [
      { "_id": "1024", "id": 1024, "query": "upsc", "createdAt": "2026-06-26T09:12:44.000Z" },
      { "_id": "1019", "id": 1019, "query": "gpsc prelims", "createdAt": "2026-06-26T08:55:01.000Z" }
    ],
    "total": 2
  },
  "message": "Recent searches fetched.",
  "messages": {}
}
```

- `items` — array (max 10), newest first.
  - `_id` / `id` — the history entry id (use `id` for the single-delete endpoint).
  - `query` — the search term to render (and to re-run if the user taps it).
  - `createdAt` — ISO timestamp of the last time this term was searched.
- `total` — number of items returned (0–10). Empty history → `items: []`, `total: 0`.

---

## 2. Remove a single entry

`DELETE /api/v1/client/search/history/:id`

Deletes one history entry. The `:id` is the `id` from the list. Scoped to the
logged-in customer (you can only delete your own entries).

### Example

```
DELETE /api/v1/client/search/history/1024
Authorization: Bearer <token>
```

### Success — 200

```json
{ "success": true, "code": 200, "data": {}, "message": "Search history entry removed.", "messages": {} }
```

### Not found — 404

```json
{ "success": false, "code": 404, "data": {}, "message": "Search history entry not found.", "messages": {} }
```
Returned when the id doesn't exist or belongs to another customer.

---

## 3. Clear all history

`DELETE /api/v1/client/search/history`

Deletes the customer's entire search history.

### Example

```
DELETE /api/v1/client/search/history
Authorization: Bearer <token>
```

### Success — 200

```json
{ "success": true, "code": 200, "data": { "deleted": 7 }, "message": "Search history cleared.", "messages": {} }
```

- `data.deleted` — how many rows were removed (0 if history was already empty).

---

## Error responses (all endpoints)

| status | when                                            |
|--------|-------------------------------------------------|
| 401    | missing / invalid bearer token                  |
| 404    | (single-delete only) entry not found / not owned|
| 422    | `:id` is not a positive integer                 |
| 500    | unexpected server error                         |

422 example (bad id):
```json
{ "success": false, "code": 422, "data": {}, "message": "Validation failed.", "messages": { "id": "Expected number, received nan" } }
```

---

## Suggested frontend flow

1. **On opening the search screen (empty input):** call `GET /history` and render
   the chips/list of recent searches. Tapping one re-runs `GET /client/search` with
   that `query`.
2. **As the user searches:** nothing extra to do — recording is automatic. Optionally
   re-fetch `GET /history` after a search if you want the list to update live.
3. **Per-item "x":** call `DELETE /history/:id`, then remove the chip locally (or
   re-fetch).
4. **"Clear all" button:** call `DELETE /history`, then clear the list locally.

## Files (backend reference)

- Controller: [src/client/search/search-history.controller.ts](../src/client/search/search-history.controller.ts)
- Auto-record hook: [src/client/search/search.controller.ts](../src/client/search/search.controller.ts) (`globalSearch`)
- Routes: [src/client/search/search.routes.ts](../src/client/search/search.routes.ts)
- Module: [src/modules/client-search-history/](../src/modules/client-search-history/)
- DDL: [docs/migration/schema-changes/2026-06-26-search-history.sql](migration/schema-changes/2026-06-26-search-history.sql)
