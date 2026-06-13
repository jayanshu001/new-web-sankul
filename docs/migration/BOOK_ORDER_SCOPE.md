# 📦 BOOK_ORDER_SCOPE.md — Phase 3b: the book-order write path

> **Status:** SIGNED OFF (2026-06-13) — build may begin.
> **Decisions:** Q2 → **synthesize the single verify `history` entry in the DTO** (flat status row
> persisted; multi-step timeline is a noted fidelity gap). Q4 → **use `ws_book_tracking.tracking_id`
> AUTO_INCREMENT as the AWB allocator** (verify the live base first). Q5 → **book-order only now; wire
> catalog-book as a follow-up.** Q1/Q3 follow the proposals (create-order writes order + item rows in one
> txn; verify writes tracking + flips cart `status=0` only, leaving cart_item rows).
>
> **Status (orig):** DRAFT for sign-off — *no book-order code written yet.*
> **Date:** 2026-06-13 · **Branch:** `migration`
> **Companions:** [`WRITE_PATH_SCOPE.md`](./WRITE_PATH_SCOPE.md) (course+ebook, done) · [`RESUME_HERE.md`](./RESUME_HERE.md)
> **Why a separate scope:** book-order is a genuinely DIFFERENT shape from course/ebook
> (carts + line items + a courier tracking-id COUNTER), not a "same pattern" reuse. RESUME_HERE's
> discipline: scope a different-shaped write before building.

---

## 0. Why book is not course/ebook

course/ebook were "one order row → one subscription row." book is a **cart checkout** that fans
into FIVE tables, has **line items**, and allocates a **sequential courier AWB** on payment. Getting
the wrong store here doesn't just mis-grant access — it can charge a customer and leave their books
order with no line items or no courier id.

---

## 1. The write surface (real code, read 2026-06-13)

**create-order** (`payment.controller.ts createBookOrderPayment`, POST `/client/payment/create-order`):
reads the active `BookCart`, validates shipping + book availability, computes totals (with a
free-shipping threshold from `BookSetting`), writes a PENDING `BookOrder` (with embedded `items[]`),
creates the Razorpay order, saves `razorpayOrderId`.

**verify** (`verify.controller.ts` book branch, lines 182–236): flips order PENDING→VERIFIED, sets
`paidAt`, **allocates the next sequential courier tracking id** via `nextTrackingId(COURIER.TIRUPATI.INITIAL_Number)`
(an atomic counter — the id doubles as the courier AWB), appends a `tracking.history` entry, then
**deactivates the BookCart** that matched this order's shipping. Idempotent on re-entry.

---

## 2. The impedance mismatches (the design problems)

### M-1 — Embedded arrays → child tables (TWO of them)
- Mongo `BookOrder.items[]` (embedded) → SQL **`ws_book_order_item`** rows (FK `order_id` = the
  order's VARCHAR business key, NOT the int PK). Plus SQL keeps a denormalized **`order_items` TEXT**
  column on `ws_book_order` (Prisma `orderItems String` — NOT NULL). So items are stored TWICE: the
  JSON blob + the child rows.
- Mongo `BookCart.items[]` (embedded) → SQL **`ws_book_cart` + `ws_book_cart_item`** (two cart tables;
  note the confusing `ws_book_cart` ALSO has its own `item_id`/`qty` columns — a legacy single-item
  shape — alongside the proper `ws_book_cart_item` child rows).

### M-2 — Rich embedded tracking → flat table (data LOSS)
Mongo `BookOrder.tracking` = `{ trackingId, status, history:[{status,location,note,at}] }` (embedded,
with a status timeline). SQL `ws_book_tracking` = `{ tracking_id, order_id, status }` — **no history,
no note, no location, no `at`**. The Mongo verify path pushes a `history[]` entry ("Order Placed /
Payment received"); SQL has nowhere to put it. **Decision needed (D-B3).**

### M-3 — The courier tracking-id COUNTER
Mongo uses a `Counter` collection + `nextTrackingId(seed)` to atomically hand out a monotonic id
seeded at `COURIER.TIRUPATI.INITIAL_Number` (119400228001). In SQL, `ws_book_tracking.tracking_id` is
**`bigint AUTO_INCREMENT`** — the DB itself is the counter. So the SQL path gets the next id "for free"
by inserting a tracking row, IF the auto-increment is already seeded at the right base. **Must verify
the live `AUTO_INCREMENT` value** (staging has 3 rows ~1.19e11, so it's seeded). The allocated id
becomes `ws_book_order.tracking_id`.

### M-4 — **BIGINT overflow (read-breaking drift — MUST FIX before building)**
`ws_book_tracking.tracking_id` and `ws_book_order.tracking_id` are **BIGINT** in the DDL (values like
`119400228001` overflow Int32), but the Prisma models map them as **`Int`**:
```
model BookTracking { tracking_id Int @id ... }          // ← must be BigInt
model BookOrder    { trackingId Int? @map("tracking_id") } // ← must be BigInt?
```
Reading any existing book order/tracking row **throws** today. This is the same class as
commerce-subscription's `tracking` fix. Surface as number/string in the DTO.

### M-5 — customer_id is INT here (NOT the course/ebook VARCHAR split)
`ws_book_order.customer_id` is **INT** (unlike `ws_package_course_order` / `ws_ebook_order`, which are
VARCHAR). So NO type-split casting on the order row — straight int. (`order_id` is the VARCHAR business
key, distinct from the int PK; child tables + tracking FK on that string.)

### M-6 — NOT NULL columns with no Mongo source
`ws_book_order` requires `cart_id` (VARCHAR), `razorpay_order` (TEXT), `gateway_order_id`. The Mongo
path has the cart id and the razorpay payload; we must populate all NOT NULL columns at create-order
(can't defer to verify). `order_date` defaults to CURRENT_TIMESTAMP.

---

## 3. Proposed design (for sign-off)

- **D-B1 — write split across the two endpoints:**
  - **create-order** writes, in ONE `$transaction`: the `ws_book_order` row (PENDING, with the
    `order_items` JSON blob + cart_id + razorpay placeholders) **+ its `ws_book_order_item` child rows**.
    (Items belong at order time — they're the priced snapshot of the cart.)
  - **verify** writes, in ONE `$transaction`: insert a `ws_book_tracking` row (auto-increment hands out
    the AWB) → set `ws_book_order.tracking_id` + status=verified + gateway_transaction_id → **deactivate
    the cart** (`ws_book_cart.status=0` matching user + shipping).
  *Alternative:* allocate tracking at create-order — rejected (Mongo allocates at verify; matching keeps
  the AWB tied to payment, not to an abandoned pending order).

- **D-B2 — cart representation:** read carts from `ws_book_cart` + `ws_book_cart_item` (child rows),
  not the legacy single-item `ws_book_cart.item_id`. Deactivate by setting `status=0` on the matching
  `ws_book_cart` row(s). Confirm whether to also clear `ws_book_cart_item` (Mongo just flips the cart's
  `status:false` and leaves items). **Proposal: mirror Mongo — flip status only, leave items.**

- **D-B3 — tracking history loss:** SQL `ws_book_tracking` can't store the `history[]` timeline. The
  Mongo response returns `data.order` with `tracking.history`. **Proposal:** the verify DTO synthesizes
  a single-entry `history: [{status:"Order Placed", note:"Payment received", at: paidAt}]` from the
  flat row (the same entry Mongo writes on verify), so the response stays shape-compatible even though
  SQL doesn't persist the timeline. Flag this as a known fidelity gap (multi-step courier history would
  need a schema add — out of scope). **Confirm acceptable.**

- **D-B4 — schema fix:** `BookTracking.tracking_id Int→BigInt`, `BookOrder.trackingId Int?→BigInt?`,
  regenerate (pinned 5.22.0). Surface as number in the DTO (fits a JS double).

- **D-B5 — dual-read fallback in verify** (same rollback net as course/ebook): check MySQL for the book
  order first when the flag is ON; on miss, fall through to the Mongo fan-out.

- **D-B6 — flag key `book-order`**, gates create-order + the verify book branch. Flag OFF until go-live.
  Completing this is what lets **catalog-book WIRE** (its reads are built but blocked on order/cart deps).

---

## 4. Open questions for sign-off

- **Q1 (D-B1):** create-order writes order + order_item child rows in one txn; verify writes tracking +
  cart deactivation. Agree?
- **Q2 (D-B3):** OK to synthesize the single verify `history` entry in the DTO (SQL won't persist the
  timeline)? Or hold book-order until a tracking-history schema add is in scope?
- **Q3 (D-B2):** deactivate cart by flipping `ws_book_cart.status=0` only (leave cart_item rows), mirroring
  Mongo — yes?
- **Q4 (M-3):** rely on `ws_book_tracking.tracking_id` AUTO_INCREMENT as the AWB allocator (vs. porting
  the Counter)? (I'll verify the live AUTO_INCREMENT base before building.)
- **Q5:** scope boundary — build book-order alone now, then WIRE catalog-book as a follow-up? (catalog-book
  reads are already built.)

---

## 5. What is NOT in this scope
- Multi-step courier tracking history persistence (SQL schema lacks the columns — fidelity gap noted)
- catalog-book wiring (separate follow-up once book-order lands)
- the free-checkout (zero-amount) flow · promocode/referral on book orders
- flipping the flag live (separate sign-off)
