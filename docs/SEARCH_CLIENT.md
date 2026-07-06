# Global Search API — Client

Powers the search-results screen with tabs (Courses / Packages / Books / E-Books). Each tab issues an independent paginated request. There is **no** "all-types-in-one-response" endpoint — if the UI ever needs counts across tabs, fire one request per tab in parallel.

## Conventions

- Base path: `/api/v1/client/search`
- Auth: **required**. Send `Authorization: Bearer <customerAccessToken>`.
- Response envelope: `{ success: boolean, data?, message? }`

---

## Search

`GET /api/v1/client/search`

Case-insensitive substring match on the `name` field of the selected collection. Only active records (`status: true`) are returned. Results are sorted by `createdAt` desc.

### Query params

| param   | type   | required | notes                                                                 |
|---------|--------|----------|-----------------------------------------------------------------------|
| `q`     | string | yes      | Search term. Min length 2. Regex metacharacters are escaped server-side, so values like `C++` or `(2024)` are safe. |
| `type`  | string | yes      | One of `courses`, `packages`, `books`, `ebooks`.                      |
| `page`  | number | no       | 1-based page index. Default `1`.                                       |
| `limit` | number | no       | Page size. Default `10`, max `50`.                                     |

### Example

```
GET /api/v1/client/search?q=upsc&type=books&page=1&limit=10
Authorization: Bearer <token>
```

### Success — 200

```json
{
  "success": true,
  "data": {
    "type": "books",
    "items": [
      { "_id": "66f...", "name": "UPSC/GPSC All In One PYQs", "author": "...", "discountedPrice": 270, "listPrice": 300, "thumbnail": "...", "status": true, "createdAt": "..." }
    ],
    "total": 23,
    "page": 1,
    "limit": 10,
    "hasMore": true
  }
}
```

`items` is the raw document of the matched collection — fields differ per `type`:

- `type=courses` → `Course` documents
- `type=packages` → `Package` documents
- `type=books` → `Book` documents
- `type=ebooks` → `Ebook` documents (note: price plans are **not** joined here; fetch detail endpoint for pricing)

### Errors

| status | message                                                            | when                                        |
|--------|--------------------------------------------------------------------|---------------------------------------------|
| 400    | `Query 'q' must be at least 2 characters.`                         | `q` missing or shorter than 2 chars         |
| 400    | `Query 'type' must be one of: courses, packages, books, ebooks.`   | `type` missing or not in the allowed set    |
| 401    | (auth middleware)                                                  | missing/invalid bearer token                |
| 500    | error message                                                      | unexpected server error                     |

---

## Pagination

Use `hasMore` to drive infinite-scroll or "Load more". To fetch the next page, increment `page` keeping `q`, `type`, and `limit` constant.

```
GET /api/v1/client/search?q=upsc&type=books&page=2&limit=10
```

## Notes for clients

- **Per-tab requests:** the API intentionally takes one `type` at a time. When the user switches tabs, fire a fresh request — don't try to cache across types.
- **Debounce:** debounce input ~300ms before hitting the endpoint to avoid one request per keystroke.
- **Empty query:** don't call the API until the user has typed at least 2 characters; the server rejects shorter queries with 400.
- **No relevance ranking yet:** results are ordered by `createdAt` desc, not by match score. If product needs ranking later, we'd migrate to `$text` or Atlas Search without changing this contract.

## Files

- Controller: [src/client/search/search.controller.ts](../src/client/search/search.controller.ts)
- Routes: [src/client/search/search.routes.ts](../src/client/search/search.routes.ts)
- Mounted at: [src/client/client.routes.ts](../src/client/client.routes.ts)
