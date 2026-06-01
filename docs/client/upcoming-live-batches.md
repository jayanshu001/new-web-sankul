# Upcoming Live Batches API — Client Integration Doc

Powers the home-screen **"Upcoming Live Batches"** carousel together with its
**All / PSI / TAT / UPSC / DYSO …** category tab bar — in a single call.

> This is a **new** endpoint. The existing `GET /api/v1/client/live-courses/`
> (full catalogue listing) and every other live-course endpoint are unchanged.

---

## Endpoint

```
GET /api/v1/client/live-courses/upcoming-batches
```

**Auth:** Required. Send `Authorization: Bearer <token>` (customer token), same
as all other client live-course routes.

An **"upcoming batch"** = an active live course whose `startTime` is still in
the future. Started / evergreen courses do **not** appear here (use
`GET /api/v1/client/live-courses/` for the full catalogue).

---

## Query parameters

| Param        | Type              | Default | Notes |
|--------------|-------------------|---------|-------|
| `categoryId` | string (ObjectId) | _none_  | **The tab filter.** Omit for the **"All"** tab. Pass a category `_id` (from the `categories` array in the response) to filter to one category. Invalid id → `422`. |
| `search`     | string            | `""`    | Case-insensitive match on batch name. |
| `page`       | number            | `1`     | Pagination. |
| `limit`      | number            | `20`    | Max `50`. |

- **"All" tab** → call with **no** `categoryId`.
- **A category tab** → call with `?categoryId=<that category's _id>`.

---

## Response `200`

```jsonc
{
  "success": true,
  "message": "Upcoming live batches fetched.",
  "data": {
    "liveBatches": [
      {
        "_id": "66f0a1...",
        "name": "GPSC Complete Course",
        "subtitle": "Batch Starts March 2026",
        "description": "Comprehensive GS & CSAT...",
        "image": "https://.../cover.png",
        "level": "Foundation",
        "classType": "live",                 // "live" | "live_offline" | "offline"
        "isPaid": true,
        "isPopular": false,
        "startTime": "2026-03-15T04:30:00.000Z",
        "ordered": 1,
        "courseEducatorId": { "_id": "...", "name": "...", "image": "..." },
        "packageCategoryId": {               // the batch's category
          "_id": "66cat...", "title": "UPSC", "slug": "upsc", "image": "..."
        },

        // per-user / computed fields:
        "daysLeft": null,                    // days left on user's subscription, else null
        "isPurchased": false,                // user already owns this batch
        "purchaseCount": 128,                // verified subscribers (popularity)
        "shareableLink": "https://.../share/live-courses/66f0a1..."
      }
    ],
    "total": 12,                             // total upcoming batches matching the current filter
    "page": 1,
    "limit": 20,

    // ---- tab bar data ----
    "categories": [                          // only categories that HAVE upcoming batches
      { "_id": "66cat1...", "title": "PSI",  "slug": "psi",  "image": "...", "count": 3 },
      { "_id": "66cat2...", "title": "TAT",  "slug": "tat",  "image": "...", "count": 2 },
      { "_id": "66cat3...", "title": "UPSC", "slug": "upsc", "image": "...", "count": 5 },
      { "_id": "66cat4...", "title": "DYSO", "slug": "dyso", "image": "...", "count": 2 }
    ],
    "allCount": 12,                          // count for the synthetic "All" tab
    "selectedCategoryId": null               // echoes the categoryId you sent (null = All)
  }
}
```

### Field reference

| Field | Meaning |
|-------|---------|
| `liveBatches[]` | The upcoming batches for the current filter / page. |
| `liveBatches[].packageCategoryId` | The batch's category, populated `{ _id, title, slug, image }`. |
| `liveBatches[].daysLeft` | Days left on the authenticated user's subscription to this batch; `null` if not subscribed. |
| `liveBatches[].isPurchased` | `true` when the user already owns this batch. |
| `liveBatches[].purchaseCount` | Verified subscriber count (popularity signal). |
| `liveBatches[].shareableLink` | Deep link to share the batch. |
| `total` | Total upcoming batches matching the **current** filter (drives pagination). |
| `categories[]` | Tab bar — only categories that have ≥1 upcoming batch, ordered by admin `order`. Each carries a `count` badge. |
| `allCount` | Count for the synthetic **"All"** tab (total upcoming batches across all categories). |
| `selectedCategoryId` | Echoes the `categoryId` you sent; `null` means the "All" tab. |

---

## Error responses

| Status | Body `message` | When |
|--------|----------------|------|
| `422`  | `Invalid category id.` | Malformed `categoryId`. |
| `401`  | _Unauthorized_ | Missing / invalid token. |
| `500`  | `Failed to fetch upcoming live batches.` | Server error. |

---

## How to render the mockup

1. **Tab bar** — render an **"All"** chip first (badge = `allCount`), then one
   chip per item in `categories` (label = `title`, badge = `count`). The backend
   returns only categories that actually have upcoming batches, so there are no
   empty tabs to hide.
2. **Default load** — call with **no** `categoryId` → "All" tab selected, full
   upcoming list in `liveBatches`.
3. **Tap a tab** — re-call with `?categoryId=<that tab's _id>`. `categories` /
   `allCount` stay stable across tab switches (always computed over the
   unfiltered upcoming set), so you can compute the tab bar once on first load
   and only refresh `liveBatches` on subsequent tab taps.
4. **Card** — use `image` (cover), `name` (title), `subtitle`
   (e.g. "Batch Starts March 2026"), and `courseEducatorId.name`. The
   **"View Details"** button → navigate to the batch detail screen using `_id`.
5. **"View All"** link → switch to the "All" tab (clear `categoryId`).

---

## Behaviour notes

- Sorted **soonest-starting first** (`startTime` ascending), ties broken by the
  curated `ordered` field.
- `isPurchased` / `daysLeft` reflect the authenticated user; for a token with no
  subscriptions they are `false` / `null`.
- The category tab counts (`categories[].count`, `allCount`) are computed over
  the unfiltered upcoming set, so they don't change when you switch tabs.

---

## Related endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/client/live-courses/` | Full live-course catalogue (incl. started/evergreen) with hero-card ranking. **Unchanged.** |
| `GET /api/v1/client/live-courses/:id` | Single batch detail (plans, stats, subscription state). Use with `liveBatches[]._id`. |
| `GET /api/v1/client/package-categories?live=true` | Categories that have ≥1 active live course (alternative tab source). |
