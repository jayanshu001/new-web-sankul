# Trending Books & Ebooks — Client-Side Integration

Trending content is now split into two independent rails: **Trending Books** (physical) and **Trending Ebooks** (digital). The legacy combined endpoint is preserved for back-compat but new screens should consume the split endpoints.

All endpoints require `Authorization: Bearer <token>`.

---

## 1. Dashboard sections

`GET /api/v1/client/dashboard` now returns the trending rails as **two separate sections** (when each has items):

```jsonc
{
  "dashboard": [
    // ...other sections...
    {
      "title": "Trending Books",
      "type": "trending-book",
      "data": [ /* Book[] — see schema below */ ]
    },
    {
      "title": "Trending Ebooks",
      "type": "trending-ebook",
      "data": [ /* Ebook[] — see schema below */ ]
    }
  ]
}
```

`GET /api/v1/client/free-dashboard` mirrors the split:

- `title: "Trending Free Books"` → `type: "trending-book"`
- `title: "Trending Free Ebooks"` → `type: "trending-ebook"`

Each section is capped at 5 items on the free dashboard, 20 on the paid dashboard. Render each rail independently — they are no longer merged or sorted together.

---

## 2. Standalone listing endpoints

### 2.1 Trending Books (physical only)

```
GET /api/v1/client/books/trending/books
```

**Query params** (all optional):

| Param      | Values                  | Default | Notes                                            |
| ---------- | ----------------------- | ------- | ------------------------------------------------ |
| `type`     | `paid` \| `free`        | `paid`  | `free` = `discountedPrice === 0`                  |
| `language` | language string         | —       | Exact match on `Book.language`                   |
| `search`   | string                  | —       | Case-insensitive match on `name` or `author`     |
| `limit`    | integer (1–100)         | `20`    | Clamped to range                                 |

**Response**:

```jsonc
{
  "success": true,
  "data": {
    "type": "paid",
    "total": 12,
    "items": [
      {
        "type": "book",
        "_id": "…",
        "name": "…",
        "description": "…",
        "author": "…",
        "language": "English",
        "image": "…",
        "thumbnail": "…",
        "demoUrl": "…",
        "isTrending": true,
        "isCombo": false,
        "isMagazine": false,
        "listPrice": 499,
        "discountedPrice": 349,
        "shippingPrice": 40,
        "pages": 320,
        "price": 349,           // alias of discountedPrice
        "isFree": false,
        "createdAt": "…",
        "shareableLink": "https://…/share/books/<id>"
      }
    ]
  }
}
```

### 2.2 Trending Ebooks (digital only)

```
GET /api/v1/client/books/trending/ebooks
```

Same query params as above. For ebooks, `free` vs `paid` is decided by the **minimum active plan price** (`EbookPrice.price`); an ebook with no active plans is treated as free.

**Response**:

```jsonc
{
  "success": true,
  "data": {
    "type": "paid",
    "total": 8,
    "items": [
      {
        "type": "ebook",
        "_id": "…",
        "name": "…",
        "description": "…",
        "author": "…",
        "publisher": "…",
        "language": "English",
        "image": "…",
        "thumbnail": "…",
        "demoUrl": "…",
        "isTrending": true,
        "price": 199,           // min active plan price (0 if free)
        "isFree": false,
        "plans": [              // all active plans, sorted by duration asc
          { "_id": "…", "duration": 1, "price": 199, /* … */ }
        ],
        "createdAt": "…",
        "shareableLink": "https://…/share/ebooks/<id>"
      }
    ]
  }
}
```

### 2.3 Combined (legacy — still works)

```
GET /api/v1/client/books/trending
```

Returns books + ebooks merged in one array (each item carries a `type: "book" | "ebook"` discriminator). Same query params. Prefer the split endpoints in new code; only use this if you need a unified rail.

---

## 3. Suggested rendering

- **Dashboard**: render `trending-book` and `trending-ebook` sections as separate horizontal carousels in the order they appear in `dashboard[]`.
- **"See all" link**:
  - From the `Trending Books` rail → `/books/trending/books?type=paid` (or `free` on the free dashboard).
  - From the `Trending Ebooks` rail → `/books/trending/ebooks?type=paid` (or `free`).
- **Item taps**:
  - `type: "book"` → book detail screen, navigate by `_id`.
  - `type: "ebook"` → ebook detail / plan-picker screen, navigate by `_id`. Use `plans` to render plan options without an extra fetch.
- **Share**: every item carries `shareableLink` — use it directly with the OS share sheet.

---

## 4. Migration checklist

- [ ] Replace the single "Trending Books" dashboard rail with two rails keyed off `type === "trending-book"` and `type === "trending-ebook"`.
- [ ] Point the "See all" CTAs to the new split endpoints.
- [ ] Remove any client-side splitting of the combined response (filtering by `item.type`) — the server now returns them pre-split.
- [ ] Keep falling back to the combined endpoint only if you need to support older app versions.
