# 🖊️ WRITE_PATH_SCOPE.md — Phase 3b: migrating the payment write path

> **Status:** ✅ COURSE + EBOOK PATHS BUILT + WIRED (2026-06-13) — flag OFF, tsx 28/28 each, typecheck clean.
> Modules: `src/modules/commerce-order/` (course) + `src/modules/ebook-order/` (ebook). Endpoints wired:
> `create-order/{course,ebook}` + verify {course,ebook} branches (dual-read fallback). ebook is 2 tables
> (no tracking) and re-derives ebook_id from the plan. ✅ **book-order** also DONE (2026-06-13, own scope:
> BOOK_ORDER_SCOPE.md) — course/ebook/books all built + wired, flag OFF. Next: **wire catalog-book** (now
> unblocked), then offline-enquiry / package-chat, then THE FLIP. See MIGRATION_QUERY_CHANGES.md top entries.
> **(Original sign-off below.)**
>
> **Status (orig):** SIGNED OFF (2026-06-13) — *no write-path code written yet; build may begin.*
> **Sign-off decisions:** Q4 → **course path ONLY** first (ebook/book ride later). · Q3 →
> **dual-read fallback in verify = YES** (the rollback safety mechanism, §3.2/§4). ·
> Q1/Q2 follow the recommended proposals (create-order writes the `order` row only;
> verify writes `subscription`+`tracking`; upsert-extend reproduced in SQL).
> **Author session date:** 2026-06-13 · **Branch:** `migration`
> **Companion:** [`RESUME_HERE.md`](./RESUME_HERE.md) §1, §8 · [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md)
> **Rule this doc satisfies:** RESUME_HERE §1 — "Do NOT write write-path code without the plan."

---

## 0. Why this is different from every module so far

The 29 modules built to date are **read-side**: a Prisma repository, a transformer
to a Mongo-shaped DTO, a dual-path service, wired behind a flag. A read that picks
the wrong store returns stale-but-shaped data — annoying, instantly rolled back by
flipping the flag.

A **write** that picks the wrong store **splits the source of truth**: a customer
pays, the PENDING row lands in store A, the verify call looks in store B, finds
nothing → `404 No local order found` → the customer is charged with no entitlement.
The flag is no longer "which copy do I read" — it is "where does this customer's
money-of-record live." That raises three new problems the read modules never had:

1. **Two endpoints must agree.** `create-order` writes the PENDING row;
   `/payment/verify` flips it to verified. They are separate requests, possibly
   separate deploys. If the flag flips *between* them, the order is orphaned.
2. **No clean rollback.** Flip a read flag back and the next read is correct. Flip a
   write flag back after orders exist in MySQL and those orders become invisible to
   the (now-Mongo) verify path. Rollback must be a *documented data story*, not just
   an env edit.
3. **Idempotency + concurrency are real.** Razorpay's webhook and the client both
   call verify. The Mongo path guards this with status checks; the SQL path must
   reproduce the *exact same* idempotent behavior, transactionally.

---

## 1. What `verify.controller.ts` actually does (read of the real 569 lines)

The checkpoint described this as "Razorpay verify + subscription." It is broader:
**one signature check, then a 5-way fulfillment dispatch** keyed by which local row
owns the `razorpay_order_id`:

| Branch | Mongo collection(s) written | SQL table(s) exist? | In scope for 3b? |
|---|---|---|---|
| **book** | `BookOrder`, `BookCart`, `Counter` (tracking id) | `ws_book_order(_item)`, `ws_book_cart(_item)`, `ws_book_tracking` | **Phase 3b — separate sub-scope** (book-order) |
| **course** | `PackageCourseSubscription` (+ upsert-extend) | `ws_package_course_order` + `_subscription` + `_subscription_tracking` | **YES — this doc's primary target** |
| **ebook** | `EbookOrder`, `EbookSubscription` | `ws_ebook_order` (+ subscription) | **Phase 3b — adjacent, scope next** |
| **live-course** | `LiveCourseSubscription`, `LiveCoursePlan` | ❌ **NONE** (Mongo-only) | **NO — deferred** (RESUME_HERE §7) |
| **test-series** | `TestSeriesOrder`, `TestSeriesSubscription`, `TestSeriesPrice` | ❌ no SQL tables found | **NO — deferred** (verify pre-existing) |

**Signature verify** (`verifySignature`, lines 36–50) is store-agnostic crypto —
**unchanged** by the migration. Do not touch it.

### The "find which entity owns this order" fan-out (lines 78–90)
`Promise.all` of 5 `findOne({ razorpayOrderId, customerId })`. In a dual-path world
this must become: *for each kind, query whichever store that kind currently lives in.*
A kind whose flag is OFF keeps querying Mongo; a kind whose flag is ON queries MySQL.
The dispatch below it (`if (bookOrder) … if (courseSub) …`) is unchanged in shape.

---

## 2. The impedance mismatch (the core design problem)

The Mongo course path uses **one document** — `PackageCourseSubscription` — that
carries *both* the order facts (razorpay ids, paidAmount, paymentStatus
pending→verified) *and* the entitlement facts (startAt, endAt, status). SQL splits
this across **three tables**:

```
ws_package_course_order              (the payment / order-of-record)
  id PK · customer_id VARCHAR(ObjectId) · razorpay_order_id · razorpay_payment_id
  status enum('cancel','complete','pending')  ← order lifecycle
        │ order_id FK
        ▼
ws_package_course_subscription       (the entitlement / access grant)
  id PK · customer_id INT · order_id · package_id · course_id · pcb_id
  start_at · end_at · amount · status tinyint · payment_type enum('backend','online')
  tracking BIGINT  ← FK-ish to the tracking row's id
        │ order (FK = order.id, NOT subscription.id — column is `order`)
        ▼
ws_package_course_subscription_tracking
  id BIGINT PK · order INT · status varchar(25)
```

**Decisions this forces (need sign-off):**

- **D-W1 — create-order writes how many rows?** Mongo writes ONE pending doc at
  order time. SQL splits order vs subscription. Proposal: at create-order write the
  **`ws_package_course_order` row only** (status=pending); at verify write the
  **`ws_package_course_subscription` + `_tracking`** rows. This matches the table
  semantics (subscription = granted access, only exists once paid) and matches the
  Mongo `paymentStatus` flip conceptually. *Alternative:* write a pending
  subscription too — rejected, no "pending" state exists in the subscription
  `status tinyint`.

- **D-W2 — `customer_id` type split (a known trap).** `ws_package_course_order.customer_id`
  is **VARCHAR(255)** (ObjectId-shaped), but `ws_package_course_subscription.customer_id`
  is **INT**. RESUME_HERE §6 / decision C3: migrated id-space `customerId` is INT.
  So the order row stores customerId as a string, the subscription row as an int.
  The transformer/service must cast at the boundary and **must not** assume one type
  across both tables. *This is exactly the kind of split that silently breaks a join.*

- **D-W3 — upsert-extend semantics.** The Mongo course branch (lines 188–235) folds a
  new purchase onto an existing active verified subscription (same course/package
  target) and retires the new pending row (`status:false`). SQL must reproduce: find
  active `ws_package_course_subscription` where `status=1`, same `course_id` (or
  `package_id` when course_id null), extend `end_at` via the **DAYS** planDuration
  helper (RESUME_HERE §6 — `duration` is days, `setDate`), sum `amount`, and mark the
  new order `complete` without creating a second subscription. Mongo→SQL field map:
  Mongo `targetPackageId` → SQL `package_id`; Mongo `packageId` (the plan) → SQL
  `pcb_id`. (RESUME_HERE §6 name-divergence note.)

- **D-W4 — `tracking` BIGINT.** `ws_package_course_subscription.tracking` and
  `ws_package_course_subscription_tracking.id` are BIGINT — Prisma must model these as
  `BigInt` and surface as number/string (RESUME_HERE §6 bigint-overflow class). The
  tracking row's `order` column points at **order.id**, not subscription.id.

- **D-W5 — transaction boundary.** verify writes order(→complete) + subscription +
  tracking. These must be **one Prisma `$transaction`** so a mid-write crash can't
  leave a complete order with no entitlement (the Mongo path's stated risk, lines
  423–436, is exactly this). Idempotency guard reads inside the txn.

---

## 3. Flag-gating strategy (the two-endpoint problem)

**Flag key:** `commerce-order` (one key gates the course write path end-to-end).

**Invariant to preserve:** an order created in store X must be verifiable in store X.
The order is keyed by `razorpay_order_id`. Rules:

1. **create-order** branches on `isMysqlModule("commerce-order")` → writes the pending
   row to MySQL *or* Mongo.
2. **verify**'s owner-lookup fan-out queries **both stores** for the course kind
   regardless of the flag, OR — safer — queries the store the flag currently names
   **plus** Mongo as fallback. Proposal: **dual-read the course owner-lookup** (check
   MySQL if flag ON, else Mongo; on miss in the flagged store, fall back to the other
   store) so a flag flip between create and verify can't orphan an in-flight payment.
   This fallback is verify-only and read-only — it does not split writes.
3. **No backfill at flip time.** Pre-existing Mongo orders stay in Mongo and verify via
   the fallback. Only *new* orders after the flip land in MySQL. This makes the flip
   non-destructive and the rollback (§4) clean.

---

## 4. Rollback story (must exist before we build)

| Scenario | Action | Data state |
|---|---|---|
| Flag ON, no orders yet created | flip OFF | no MySQL order rows; nothing to reconcile |
| Flag ON, N orders created+verified in MySQL, then flip OFF | verify still finds them via the **dual-read fallback** (§3.2); new orders go to Mongo | MySQL holds N closed orders, Mongo resumes; no customer loses access |
| Flag ON, order created in MySQL but **unverified** at flip OFF | dual-read fallback finds the pending MySQL order at verify time → completes in MySQL | the one in-flight order completes correctly; safe |

**Conclusion:** the dual-read fallback in verify is what makes write-path rollback
safe. It is non-optional. Without it, a flip orphans in-flight payments.

---

## 5. Proposed build order (smallest safe increments)

1. **Schema-drift fix first** (RESUME_HERE §4 step 1) — model the 3 tables in
   `prisma/schema.prisma`: `order` (varchar customer_id, status enum), `subscription`
   (int customer_id, tracking BigInt, payment_type enum), `tracking` (BigInt id).
   Regenerate (pinned 5.22.0 per §5).
2. **`commerce-order` module** (`src/modules/commerce-order/`) — repository (reads for
   the owner-lookup + the active-subscription query), service (dual-path + txn writer
   `verifyCourseOrderMysql`), transformer (SQL rows → the `{kind:"course", subscription}`
   DTO byte-identical to the Mongo response), types + SCOPE/DRIFT block.
3. **tsx verify** in `scripts/_tmp/` against live DB (flag OFF): assert create→verify
   round-trips, idempotent re-verify, upsert-extend, DAYS endAt, customer_id type
   split, BigInt tracking. `rm -rf scripts/_tmp` after.
4. **Wire** create-order + verify course branches behind `isMysqlModule("commerce-order")`
   with the dual-read fallback. Response stays byte-identical.
5. **Typecheck** (0 errors ex the 2 known files) → **full doc protocol** (§4.6).
6. **Do NOT add `commerce-order` to `MIGRATION_MYSQL_MODULES`** until the user signs off
   on flipping a write path live.

**ebook-order** rides the same pattern next; **book-order** is its own sub-scope
(carts + courier tracking counter); **live-course / test-series stay deferred** (no
SQL tables).

---

## 6. Open questions for sign-off

- **Q1 (D-W1):** confirm create-order writes only the `order` row, verify writes
  `subscription`+`tracking`. Agree?
- **Q2 (D-W3):** confirm upsert-extend should be reproduced in SQL (vs. always
  creating a fresh subscription row). The Mongo path extends; matching it keeps the
  "My Subscriptions" UI from showing duplicate cards.
- **Q3 (§3.2/§4):** confirm the **dual-read fallback in verify** is acceptable — it's
  the safety mechanism for write-path rollback. (Recommended: yes.)
- **Q4:** scope boundary — do this doc's **course** path alone first, then ebook, then
  book? Or bundle course+ebook (they share verify + the order/subscription split)?
- **Q5:** there are **3 orders / 2 subs / 3 tracking rows** in staging — tiny. OK to
  rely on staging data for tsx verification, or seed a fixture?

---

## 7. What is explicitly NOT in this scope

- live-course, test-series verify branches (no SQL tables — RESUME_HERE §7)
- signature verification crypto (store-agnostic, untouched)
- the Razorpay order-creation API call itself (external, unchanged)
- flipping the flag live (separate sign-off after build + verify)
- promocode/referral application (`promocode`/`refferalcode` JSON cols) — order rows
  carry them as JSON; we persist as-stored, we do **not** reimplement the
  commerce-promocode `appliesTo` contract (deferred, §7).
