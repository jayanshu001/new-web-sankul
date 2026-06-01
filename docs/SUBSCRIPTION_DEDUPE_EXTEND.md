# Subscription De-duplication & Extend-in-Place

## The bug

After **extending a course's availability** for a customer, the **My Subscription**
screen showed the **same course twice** — two cards for one course, each with a
different availability / expiry date. This happened for **Course, Package, and
Live Course**.

It was a backend issue.

## Why it happened

A customer's subscription is stored as **one row per purchase / grant**:

- `PackageCourseSubscription` — course & package subscriptions
- `LiveCourseSubscription` — live course subscriptions

There was **no uniqueness constraint** on `(customerId, courseId)` /
`(customerId, targetPackageId)` / `(customerId, liveCourseId)`. When availability
was "extended", the write paths **inserted a brand-new row** instead of updating
the existing one. The **My Subscription** listing then returned **every** active
row (`paymentStatus: "verified"`, `status: true`, `endAt > now`) with **no
de-duplication** — so both the old row and the new row rendered as separate cards.

Concretely, a customer could end up with:

| row | course | endAt        | shown? |
|-----|--------|--------------|--------|
| A   | X      | 2026-06-01   | ✅ card 1 |
| B   | X      | 2026-12-01   | ✅ card 2 |

…when they should only ever see **one** card for course X with the latest `endAt`.

## How we fixed it

Three layers — fix the write paths, clean the read path, backfill existing data.

### 1. Extend-in-place on every write path (no more duplicate rows)

A shared helper computes the extended window so every callsite is consistent:

`src/utils/planDuration.ts` → **`extendEndAt`**

```ts
extendEndAt({ currentEndAt, durationMonths, now })
```

- If the current subscription is **still active** (`currentEndAt` in the future),
  the new duration **stacks onto `currentEndAt`** — the customer keeps the days
  they already paid for and the extension lands after them.
- If it has **lapsed** (or has no `endAt`), the window starts from `now`.

This helper is wired into all the paths that previously inserted a second row.
Each now looks for an **existing active verified subscription for the same
target** and extends that row's `endAt` in place; it only creates a fresh row
when none exists.

| Path | File | Behaviour change |
|------|------|------------------|
| Admin add/extend course & package | `src/admin/subscription/subscription.controller.ts` → `createCourseSubscription` | If an active verified sub exists for the same `courseId` / `targetPackageId`, extend it; otherwise create. Skipped (creates fresh) when caller pins an explicit `startAt`. |
| Admin grant live course | `src/admin/live-course/live-course.subscription.controller.ts` → `grantLiveCourseSubscription` | Previously returned `409` if an active sub existed. Now **extends it in place** and returns `200`. Skipped when explicit `startAt`/`endAt` overrides are passed. |
| Customer self-service payment | `src/client/payment/verify.controller.ts` → course & live branches | A pending row is created at order time. On activation, if an active verified sub already exists for the same target, the purchased window is **folded onto it** and the just-paid pending row is **retired** (`status: false`) — keeping the payment audit trail but hiding it from listings. |

> **Activation is single-path.** `/client/payment/verify` is the only endpoint
> that activates course/package/live subscriptions (there is no separate
> subscription-activating webhook — the only payment webhook is for ebooks,
> which is a separate flow). So extend-on-activation is fully covered.

### 2. De-duplication in the listing (defence-in-depth)

`src/client/my-subscriptions/my-subscriptions.controller.ts` → `listMySubscriptions`

The listing now fetches **all** active rows, collapses them to **one row per
target** (keeping the furthest-out `endAt`), and **then** paginates:

- Course subs group by `courseId`
- Package subs group by `targetPackageId`
- A row with neither falls back to its own `_id` (never dropped)

This guarantees a single card per course/package even if duplicate rows somehow
still exist in the database. The per-card payload shape is unchanged.

### 3. Migration to clean existing duplicates

`src/migrations/2026-dedupe-active-subscriptions.ts`

Collapses duplicate **active + verified** rows that already exist in Mongo. Per
`(customer, target)` group it keeps the row with the furthest-out `endAt` and
deactivates the rest with `status: false` (rows are **not** deleted — payments /
receipts reference them). Idempotent and safe to re-run.

```bash
# preview counts without writing
npx ts-node -T src/migrations/2026-dedupe-active-subscriptions.ts --dry-run

# apply
npx ts-node -T src/migrations/2026-dedupe-active-subscriptions.ts
```

Returns stats:

```ts
{
  courseGroupsCollapsed, courseRowsDeactivated,
  liveGroupsCollapsed,   liveRowsDeactivated,
}
```

## API contract changes (for the frontend)

The fix changes a few response shapes on the write paths. The frontend should
not assume a `201` status or that the returned `_id` equals the row it just
created — read `data._id` / `data.endAt` from the response.

| Endpoint | Before | Now (when it extends an existing sub) |
|----------|--------|----------------------------------------|
| `POST /api/v1/admin/subscriptions` | `201 { success, data }` | `200 { success, data, extended: true }` |
| `POST /api/v1/admin/live-courses/:id/grant` | `201 … "Subscription granted."` | `200 … "Subscription extended."` (no longer `409`) |
| `POST /api/v1/client/payment/verify` | returns the activated row | may return the **pre-existing** row (paid pending row is retired with `status:false`) |

**Recommended frontend wiring:** the admin **"Extend availability"** action
should call the dedicated in-place update endpoint with the existing
subscription `_id` rather than the create/grant endpoint:

- Course / Package: `PUT /api/v1/admin/subscriptions/:id` with `{ endAt }`
- Live Course: `PUT /api/v1/admin/live-courses/subscriptions/:subscriptionId` with `{ endAt }`

Even if the frontend keeps calling create/grant, the backend now
extends-in-place instead of duplicating — so the bug will not recur either way.
**My Subscription** needs no frontend change; de-duplication is server-side.

## Data model note

There is still no DB-level unique constraint on
`(customerId, courseId)` / `(customerId, targetPackageId)` /
`(customerId, liveCourseId)`. The guarantees above are enforced in application
code. A partial unique index over active rows could be added later as a
hard backstop.
