# Free Ebooks — Client

Adds a dedicated **free ebook** listing, a **Free Ebooks** section on the free dashboard, and makes the ebook `isPaid` flag an explicit, admin-controlled field instead of something inferred from price plans.

**Auth:** `Authorization: Bearer <token>` required on every endpoint below.

---

## What "free" means now

An ebook is **free when `isPaid === false`**.

`isPaid` is an admin-controlled boolean on the ebook (default `true`). It is the **single source of truth** — the FE should read `isPaid` directly and must **not** infer free/paid from the `plans` array anymore. (A free ebook may still carry a ₹0 plan; that's fine.)

> Migration note: legacy ebooks created before the field existed are backfilled to `isPaid: true`. So an existing ebook only becomes free once an admin explicitly marks it free.

---

## 1. Free ebooks listing — NEW

### `GET /api/v1/client/free-ebooks`

Returns only ebooks with `isPaid: false`. Response shape is **identical to `GET /api/v1/client/ebooks`**, so you can reuse the same ebook card component.

**Query params** (all optional):

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `search` | string | — | Case-insensitive match on `name` OR `author` |
| `language` | string | — | Exact language filter |
| `page` | number | `1` | 1-based |
| `limit` | number | `20` | Page size |

**Response**

```json
{
  "success": true,
  "data": [
    {
      "_id": "65f...",
      "name": "Free Current Affairs Digest",
      "author": "Editorial Team",
      "publisher": "Sankul",
      "language": "english",
      "image": "https://.../cover.jpg",
      "thumbnail": "https://.../thumb.jpg",
      "plans": [
        { "_id": "...", "duration": 30, "price": 0, "status": true }
      ],
      "details": [
        { "id": 1, "mainText": "Language", "subText": "english" },
        { "id": 2, "mainText": "Author", "subText": "Editorial Team" },
        { "id": 3, "mainText": "Publisher", "subText": "Sankul" }
      ],
      "isPaid": false,
      "isPurchased": false,
      "isNew": true,
      "subscriptionEndAt": null,
      "daysLeft": null,
      "shareableLink": "https://.../share/ebooks/65f...",
      "...": "all other ebook fields preserved"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

**Per-item fields**

| Field | Type | Meaning |
|-------|------|---------|
| `isPaid` | boolean | Always `false` here (this is the free list). |
| `isPurchased` | boolean | `true` if the user has a currently-active subscription for this ebook. |
| `subscriptionEndAt` | ISO date \| null | Expiry of the active subscription (latest wins), else `null`. |
| `daysLeft` | number \| null | Whole days until `subscriptionEndAt`, else `null`. |
| `isNew` | boolean | Added within the last 7 days. |
| `shareableLink` | string | Deep link for sharing. |

> Note on `isPurchased` for a free ebook: a user "owns" a free ebook only after they've actually subscribed/downloaded it (an active `EbookSubscription` row). A free ebook with no subscription yet returns `isPurchased: false`, `daysLeft: null` — the FE should treat `isPaid: false` as "no payment required", not "already owned".

---

## 2. Free dashboard — NEW section

### `GET /api/v1/client/free-dashboard`

A new **`Free Ebooks`** section is appended to the `dashboard[]` array (capped at 5 items). It is driven by `isPaid: false` (the same source of truth as `/free-ebooks`).

> This is distinct from the existing **`Trending Free Ebooks`** row, which is price-derived (ebooks whose minimum plan price is 0). Both may appear; render by `type`.

```json
{
  "todayDate": "2026-06-05",
  "logo": "https://.../logo.png",
  "dashboard": [
    { "title": "Trending Free Books",  "type": "trending-book",  "data": [ /* ... */ ] },
    { "title": "Trending Free Ebooks", "type": "trending-ebook", "data": [ /* ... */ ] },
    {
      "title": "Free Ebooks",
      "type": "free-ebook",
      "data": [
        {
          "_id": "65f...",
          "name": "Free Current Affairs Digest",
          "plans": [ { "duration": 30, "price": 0 } ],
          "isPaid": false,
          "isPurchased": false,
          "daysLeft": null,
          "...": "all other ebook fields preserved"
        }
      ]
    },
    { "title": "Free Videos", "type": "video", "data": [ /* ... */ ] }
  ]
}
```

Section objects to handle by `type`:

| `type` | `title` | Source of "free" | Item shape |
|--------|---------|------------------|------------|
| `free-ebook` | `Free Ebooks` | `isPaid: false` (admin field) | Ebook card (same as `/ebooks`) |
| `trending-ebook` | `Trending Free Ebooks` | price-derived (min plan price 0) | Trending ebook |

Each section is omitted entirely when it has no items — render whatever is present in `dashboard[]`.

---

## 3. `isPaid` on the existing ebook endpoints — CHANGED

`GET /api/v1/client/ebooks` and `GET /api/v1/client/ebooks/:id` now return `isPaid` from the **admin field** rather than computing it from price plans.

- Behavior for already-priced ebooks is unchanged (admin field defaults to `true`).
- After an admin marks an ebook free, `isPaid` flips to `false` here too — even if a ₹0 plan exists.

**FE action:** read `isPaid` straight off the ebook object on every ebook endpoint (`/ebooks`, `/ebooks/:id`, `/free-ebooks`, and the dashboard sections). Stop deriving paid/free from `plans`.

---

## Summary of FE work

1. New screen/list: call `GET /api/v1/client/free-ebooks` (reuse the existing ebook card).
2. Free dashboard: render the new `type: "free-ebook"` section (title `Free Ebooks`).
3. Anywhere you currently infer paid/free from `plans`, switch to the `isPaid` boolean.
