# Cart APIs — Client

Step 1 of the cart flow shown in the design (My Cart → Select Address → Add Address → Test Instructions → Checkout). This document covers only the **first two endpoints**: add-to-cart (POST) and view-cart (GET). Quantity edit, delete-line, address attachment, promo, and checkout are deliberately out of scope and will land in subsequent steps.

> **Note (migration):** an older cart implementation lived at `/api/v1/client/books/cart` (`getCart`, `addToCart`, `updateCartItem`, `removeCartItem`, `clearCart` in `src/client/book/book.controller.ts`). It has been **removed**. The new canonical path is `/api/v1/client/cart` documented here. Both implementations wrote to the same `BookCart` collection, so existing carts in the database remain valid. The shipping / order endpoints under `/api/v1/client/books/*` (`POST /shipping`, `POST /order`, `GET /orders`, `GET /orders/:id`) are unchanged and continue to read the active `BookCart` row.

Scope of this pass: **physical books only**. Ebooks / courses / packages are not in the cart at this stage.

## Conventions

- Base path: `/api/v1/client/cart`
- Auth: **required**. Send `Authorization: Bearer <customerAccessToken>` on every request.
- Response envelope: `{ success: boolean, data?, message?, errors? }`
- One active cart per customer is enforced by a partial unique index on `BookCart` (`customerId + status: true`).

## Data model (existing)

`src/models/book/BookCart.model.ts` — already defined:

```ts
{
  customerId: ObjectId,           // Customer
  items: [{ bookId: ObjectId, qty: number }],
  shippingId: ObjectId | null,    // attached later in checkout step
  status: boolean,                // true = active cart
}
```

The unique partial index `{ customerId: 1, status: 1 }` (where `status: true`) guarantees a customer has at most one active cart row. Closed/converted carts can be archived later by flipping `status: false` during checkout.

---

## 1) Add to cart

`POST /api/v1/client/cart`

Adds a book to the customer's active cart. If the same `bookId` already exists in the cart, its `qty` is incremented (no duplicate lines). If the customer has no active cart row yet, one is created via upsert.

### Request body

| field    | type    | required | notes                            |
|----------|---------|----------|----------------------------------|
| `bookId` | string  | yes      | 24-char Mongo ObjectId of a Book |
| `qty`    | number  | no       | integer 1–99, default `1`        |

```json
{ "bookId": "66f1c2...", "qty": 1 }
```

### Responses

- `201 Created` — first-time add (line created or cart created)
- `200 OK` — existing line had its `qty` incremented
- `400` — validation failure (invalid `bookId`, qty out of range)
- `401` — missing/invalid bearer token
- `404` — book does not exist

```json
{
  "success": true,
  "message": "Added to cart.",
  "data": {
    "_id": "...",
    "customerId": "...",
    "items": [{ "bookId": "66f1c2...", "qty": 1 }],
    "status": true,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### Behaviour notes

- The qty-increment path uses an atomic `findOneAndUpdate` with the positional `$` operator, so two concurrent adds for the same book result in `qty + 2`, not two separate lines.
- The first-time add uses `$push` + `upsert` so a brand-new customer needs no separate "create cart" call.

---

## 2) Get cart

`GET /api/v1/client/cart`

Returns the customer's active cart, with each line populated with the underlying `Book` and a price summary suitable for the My Cart screen.

### Response

- `200 OK` always. An empty cart returns `items: []` and zeroed summary — the client does not need to handle a 404.

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "items": [
      {
        "bookId": "66f1c2...",
        "qty": 1,
        "book": { "_id": "66f1c2...", "title": "Constable 20 Paper set", "listPrice": 300, "discountedPrice": 270, "shippingPrice": 0, "...": "..." },
        "lineSubtotal": 270,
        "lineList": 300
      }
    ],
    "summary": {
      "subtotal": 270,    // sum of discountedPrice * qty   -> drives "Total Amount"
      "listTotal": 300,   // sum of listPrice       * qty   -> for showing strikethrough
      "discount": 30,     // listTotal - subtotal
      "itemCount": 1      // sum of qty across all lines
    }
  }
}
```

### Field mapping to the design

| UI element                    | API field                           |
|-------------------------------|-------------------------------------|
| Line item title / image       | `items[].book.title` / image fields |
| `₹270 ₹300` (strike + final)  | `book.discountedPrice` / `book.listPrice` |
| `1` (qty stepper value)       | `items[].qty`                       |
| "Discount -2000" row          | `summary.discount`                  |
| "Total Amount ₹2345"          | `summary.subtotal`                  |
| Bottom-bar `₹6293`            | `summary.listTotal` (or your own `subtotal + shipping` once shipping is added in a later step) |

Shipping, promo discount, and the final payable are intentionally **not** computed here yet — those come from the address + promocode + checkout endpoints in the next steps.

---

---

## 3) Update line quantity

`PATCH /api/v1/client/cart/items/:bookId`

Sets the line's `qty` to an **absolute** value (not a delta). Drives both `+` and `−` buttons on the My Cart stepper — the client sends the new displayed value.

### Request body

| field | type   | required | notes                |
|-------|--------|----------|----------------------|
| `qty` | number | yes      | integer, 1–99        |

```json
{ "qty": 3 }
```

### Responses

- `200 OK` — line updated; full cart returned
- `400` — qty out of range (including `0` — use DELETE instead) or invalid `bookId`
- `401` — missing/invalid token
- `404` — no active cart, or this `bookId` is not a line in it

### Behaviour notes

- **Absolute, not delta** → the call is idempotent. A retried request from a flaky network won't double-decrement.
- **Qty `0` is rejected** intentionally. Removing a line is the DELETE endpoint's job, not a hidden side effect of PATCH. Keeps the two responsibilities clean.
- Atomic positional update (`items.$.qty`), so it is safe under concurrent edits to other lines.

---

## 4) Remove line

`DELETE /api/v1/client/cart/items/:bookId`

Removes a single line from the active cart — the trash icon on the My Cart screen.

### Responses

- `200 OK` — removed; the updated cart (after `$pull`) is returned so the client can re-render the summary in one round trip
- `401` — missing/invalid token
- `404` — no active cart, or this `bookId` is not a line in it

### Behaviour notes

- This does **not** archive or close the cart row. Even when the last line is pulled, the active cart row stays (with `items: []`) so the next add lands in the same row. The cart row is only flipped to `status: false` during checkout.
- Idempotency: a retried DELETE returns 404 the second time. That's fine — the client should treat 200 and 404 the same way for this action (the line is gone either way).

---

---

## 5) Attach shipping address to cart

`POST /api/v1/client/cart/shipping`

The "Deliver Here" action on the Select Address screen. Stamps the user's chosen saved address onto their active cart, which is what unblocks the payment flow (`/payment/create-order` requires `cart.shippingId` to be set).

### Auth

Required.

### Request body

```json
{ "addressId": "66f1c2..." }
```

| field       | type   | required | notes                                                                              |
|-------------|--------|----------|------------------------------------------------------------------------------------|
| `addressId` | string | yes      | The `_id` of a saved `CustomerAddress` (managed via `/api/v1/client/address/*`). |

We deliberately key on the **saved address id**, not on a full address inline. The Select Address screen lists the user's saved addresses — they tap one, the app sends the id, done. Re-entering the address would duplicate the address-management flow that already lives under `/address`.

### Successful response (`200`)

```json
{
  "success": true,
  "message": "Shipping address attached.",
  "data": {
    "cart":     { "_id": "...", "items": [...], "shippingId": "...", "status": true },
    "shipping": { "_id": "...", "name": "...", "phone": "...", "address": "...", "city": "Surat", "pincode": "395007" }
  }
}
```

### Error responses

| Status | When                                                                                       |
|--------|--------------------------------------------------------------------------------------------|
| `400`  | `addressId` malformed; the saved address has no city; no phone is available on either the address or the customer profile. |
| `401`  | Missing/invalid bearer token.                                                              |
| `404`  | `addressId` doesn't exist or doesn't belong to this customer.                              |

### Behaviour notes

- **Two address tables, internally.** The codebase has both `CustomerAddress` (what the user manages on the profile / Select Address screens) and `CustomerShipping` (what `BookCart.shippingId` and `BookOrder.shippingId` reference, kept for legacy reasons). This endpoint takes a `CustomerAddress` id, mirrors it into a matching `CustomerShipping` row (find-or-create dedupe on `customer + name + phone + address + pincode`), and stamps that mirror's id onto the cart. The user only ever has to think about `CustomerAddress`.
- **Phone/email fallback to the customer profile.** The Add Address form per the design only collects name + address + city + state + pincode + label — there is no phone or email field. So when the saved `CustomerAddress` lacks them, the endpoint falls back to `Customer.phoneNumber` / `Customer.emailAddress` (we already have the user from auth). Phone is the only hard requirement (couriers call); if the customer record also has no phone, the endpoint 400s with a "update your profile" message. Email is informational, so its absence is allowed (this required a one-line schema relaxation on `CustomerShipping.email` to make it optional, matching `CustomerAddress`).
- **City must resolve.** `CustomerAddress.cityId` is required to resolve to an `OfflineCity.name`. If the row has no `cityId` or the city is missing, the endpoint returns 400. This makes the failure mode explicit instead of surfacing a Mongoose validation error mid-checkout.
- **No new cart row is created** if one already exists for the user — the active cart is upserted to ensure `shippingId` lands somewhere even if the user somehow hits this before adding any items. Empty-cart attachment is allowed; it just means the payment endpoint will fail on the empty-cart check, not on the missing-shipping check.

### Migration note — old shipping endpoint removed

The previous `POST /api/v1/client/books/shipping` (took a full address inline, created a fresh `CustomerShipping` row each call) has been **deleted**. Two reasons: it lived under `/books/*` after cart became its own module, and it duplicated the address-management UX. The new path is `POST /api/v1/client/cart/shipping`.

The unused `attachShippingSchema` Zod schema and the `src/client/book/book.validation.ts` file (which had nothing else in it) were removed at the same time.

---

## What's next (not in this PR)

1. `POST /cart/promocode` / `DELETE /cart/promocode` — apply / remove promo (reuses the existing client promocode validation).
2. `POST /cart/checkout` is already covered by `POST /api/v1/client/payment/create-order` (see [PAYMENT_CREATE_ORDER_CLIENT.md](PAYMENT_CREATE_ORDER_CLIENT.md)) — no new endpoint needed for the cart module; the verify endpoint that flips the cart to inactive on success is the next thing to build there.
