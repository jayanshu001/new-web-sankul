# Frontend Guide — Client Books Listing (`type` + pagination)

`GET /api/v1/client/books`

Lists books for the store. The catalogue is split into **three mutually-exclusive
categories**, each driven independently (its own search box + its own paginator).
You pick the category with the **required** `type` query param.

> Same response whether the backend serves from MySQL or MongoDB — build against
> this contract only.

---

## 1. Auth

Bearer token required (like every client route).

```
Authorization: Bearer <accessToken>
```

---

## 2. Query parameters

| Param    | Required | Type    | Default | Notes |
|----------|----------|---------|---------|-------|
| `type`   | **Yes**  | enum    | —       | One of `magazine` \| `combo` \| `regular`. Missing/invalid → **422**. |
| `search` | No       | string  | —       | Matches book **name or author** (case-insensitive, partial). Trimmed; empty = ignored. |
| `page`   | No       | int     | `1`     | 1-based. Floored at 1. |
| `limit`  | No       | int     | `20`    | Clamped to `[1, 100]`. |
| `language` | No     | string  | —       | Optional exact language filter (e.g. `gu`, `en`). |

### What the three `type` values mean
| `type`     | Returns |
|------------|---------|
| `magazine` | Books flagged as magazines (`isMagazine: true`). |
| `combo`    | Combo packs (`isCombo: true`). |
| `regular`  | Ordinary books — **neither** magazine nor combo. |

The categories never overlap, so a book appears in exactly one of them.

**Each category is its own list.** `search`, `page`, and `limit` apply *within*
the chosen `type`, and `pagination.total` is the count **for that type only**.
Render the three tabs/sections with **independent** search + pagination state.

---

## 3. Request examples

```http
GET /api/v1/client/books?type=regular&page=1&limit=10
GET /api/v1/client/books?type=combo&search=gpsc&page=2&limit=20
GET /api/v1/client/books?type=magazine&language=gu
```

---

## 4. Response shape

```jsonc
{
  "success": true,
  "data": {
    "cartId": "664f...e21" | null,   // active cart id (null if no cart / guest-less)
    "books": [
      {
        "_id": "1023",
        "name": "GPSC Combo Pack",
        "author": "WebSankul",
        "description": "…",
        "image": "https://…/image.png",
        "thumbnail": "https://…/thumb.png",
        "demoUrl": "https://…/demo.pdf" | null,
        "language": "gu",
        "pages": 320,
        "weight": 450,
        "listPrice": 999,
        "discountedPrice": 699,
        "shippingPrice": 40,
        "orderBy": 3,
        "isMagazine": false,
        "isCombo": true,
        "isTrending": false,
        "publication": "WebSankul",
        "deliveryEta": "5-7 days",
        "dynamicLink": "https://…" | null,
        "status": true,
        "createdAt": "2026-06-11T12:31:47.895Z",
        "updatedAt": "2026-06-11T12:31:47.895Z",

        // computed / per-viewer fields:
        "key": "combo",            // "combo" | "individual"
        "isPaid": true,            // discountedPrice > 0
        "isNew": false,            // recently added
        "daysLeft": null,          // always null (one-time purchase, no expiry)
        "shareableLink": "https://…/books/1023",
        "qty": 0,                  // quantity of THIS book in the viewer's cart
        "isPurchased": false       // viewer already owns it (delivered/verified order)
      }
    ]
  },
  "pagination": {
    "total": 9,        // total books in THIS type bucket (matching search/language)
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

### Field notes for the UI
- **`key`** — `"combo"` for combo packs, `"individual"` otherwise. Handy for badge/labeling.
- **`isPaid`** — `false` means free (`discountedPrice === 0`); show "Free" instead of a price.
- **`discountedPrice` vs `listPrice`** — show `discountedPrice` as the live price; strike-through `listPrice` when it's higher.
- **`qty`** — current count in the signed-in user's cart (0 = not in cart). Use to pre-fill the stepper.
- **`isPurchased`** — user already owns it; swap "Add to cart" for "Purchased"/"Download".
- **`isNew`** — show a "New" ribbon.
- **`shareableLink`** — ready-to-share deep link; no need to build it client-side.
- **`daysLeft`** — always `null` for physical books; no countdown UI.

---

## 5. Errors

| Status | When | Body |
|--------|------|------|
| `422`  | `type` missing or not one of the three values | `{ "success": false, "message": "Invalid or missing type. Use one of: magazine, combo, regular." }` |
| `401`  | Missing/expired token | standard auth error |
| `500`  | Unexpected server error | `{ "success": false, "message": "…" }` |

> ⚠️ **Always send `type`.** A bare `GET /client/books` now returns **422** — it is
> no longer a valid call.

---

## 6. Recommended UI pattern

Three tabs (Magazines / Combos / Regular). Keep **separate** state per tab so
switching tabs doesn't reset another tab's search or page:

```ts
type BookType = "magazine" | "combo" | "regular";

interface TabState {
  search: string;
  page: number;
  limit: number;   // e.g. 20
}

async function fetchBooks(type: BookType, s: TabState) {
  const qs = new URLSearchParams({
    type,
    page: String(s.page),
    limit: String(s.limit),
  });
  if (s.search.trim()) qs.set("search", s.search.trim());

  const res = await fetch(`/api/v1/client/books?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return { books: json.data.books, cartId: json.data.cartId, pagination: json.pagination };
}
```

- **Debounce** the search box (~300ms) and **reset `page` to 1** whenever `search`
  (or the tab) changes.
- Drive the paginator from `pagination.totalPages`; disable Next when
  `page >= totalPages`.
- An empty bucket returns `books: []` with `pagination.total: 0` — render an empty
  state, not an error.
- `cartId` is the same across all three tabs (one cart per user); cache it.

---

## 7. Quick reference

| Goal | Call |
|------|------|
| First page of regular books | `GET /client/books?type=regular&page=1&limit=20` |
| Search combos by name/author | `GET /client/books?type=combo&search=gpsc` |
| Magazines in Gujarati | `GET /client/books?type=magazine&language=gu` |
| Next page | bump `page`, keep `type`/`search`/`limit` |
