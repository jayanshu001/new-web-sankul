# Book — `pages` field

Adds a numeric **page count** (a.k.a. "Papers") to a Book and surfaces it through admin and client APIs so the Book Detail screen in the app can render the badge shown in the design (e.g. "80 books" / "80 pages").

This is a small, self-contained change scoped to the `pages` field only. Delivery ETA, shipping price, etc. are **not** touched in this pass — they already exist on the model and are returned as-is.

## Field

| Field   | Type   | Required | Default | Notes                                  |
|---------|--------|----------|---------|----------------------------------------|
| `pages` | number | no       | `0`     | Non-negative integer. Total page count. |

## Where it lives

### 1. Model — already present

`src/models/book/Book.model.ts` already defines `pages?: number` with `default: 0`. No schema migration is needed; existing rows will read back as `0` until updated.

### 2. Admin — already wired

- Validation: `createBookSchema` and `updateBookSchema` in `src/admin/book/book.validation.ts` accept `pages` as an optional non-negative integer (with `z.coerce.number()` so multipart form-data submissions work).
- Controller: `src/admin/book/book.controller.ts` spreads the parsed body into `Book.create(...)` and `Book.findByIdAndUpdate(..., { $set: data })`, so `pages` flows through without any per-field plumbing.

**Admin → create / update request body** (relevant subset):

```json
{
  "name": "TAT (S) and HS Book Combo",
  "listPrice": 1175,
  "discountedPrice": 1075,
  "pages": 80
}
```

No admin code change was required.

### 3. Client — Book Detail response

`GET /api/v1/client/books/:id` (handler: `getBookDetail` in `src/client/book/book.controller.ts`) returns the full Book document. The handler now:

- reads with `.lean()` for a plain object,
- guarantees `pages` is present in the response (defaults to `0` if a legacy row has it unset),

so the app can render the badge unconditionally without a null check.

**Response shape** (relevant subset):

```json
{
  "success": true,
  "data": {
    "_id": "66f1c2...",
    "name": "TAT (S) and HS Book Combo",
    "listPrice": 1175,
    "discountedPrice": 1075,
    "shippingPrice": 200,
    "deliveryEta": "5-7 days",
    "pages": 80,
    "...": "other Book fields"
  }
}
```

## App rendering

On the Book Detail screen the app should read `data.pages` and render the chip text. A common pattern:

```ts
const pagesLabel = book.pages > 0 ? `${book.pages} pages` : null;
```

Hide the chip when `pages` is `0` (i.e. unset on legacy rows). This keeps old uncurated books from showing a misleading "0 pages" badge.

## Out of scope (intentionally)

- `deliveryEta` — already on the model with default `"5-7 days"`; the app can read `data.deliveryEta` directly from the same response. No change in this pass.
- `shippingPrice` — already returned; drives the `+₹X Delivery Charge` chip.
- Per-pincode delivery estimation — deferred. Static range stays on the Book for now.
- Validation tightening (e.g. capping `pages` at a max) — deferred until we see real data.

## Verification checklist

- [ ] Create a book in the admin panel with `pages: 80`; confirm the value persists.
- [ ] Update a book's `pages` via the admin update endpoint; confirm round-trip.
- [ ] `GET /api/v1/client/books/:id` returns `pages` in `data`.
- [ ] Legacy book (created before the field was used) returns `pages: 0`, not `undefined` or `null`.
