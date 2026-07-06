# Physical-Material Conditions on Package/Course Subscription (MySQL verify path)

> **Scope:** the MySQL `commerce-order` write path only — `verifyCourseOrderMysql` /
> `verifyPackageOrderMysql` in `src/modules/commerce-order/commerce-order.service.ts`
> and `verifyCourseTx` / `verifyPackageTx` in `commerce-order.repository.ts`.
> The Mongo fallback is untouched (its subscription model has no material columns).
>
> **Source intent:** ports the legacy V1 logic in
> `docs/PC_MATERIAL_SUBSCRIPTION_FLOW.md`. This doc records the *exact conditions*
> that were added in **this** codebase and *why*.
>
> **No schema change.** Every column written (`course_amount`, `material_amount`,
> `pc_material_id`, `shipping`, `tracking`) already existed in MySQL. Deploy = flip
> code only; no `ALTER TABLE`, no backfill.

---

## TL;DR — the one gate

Everything material-related keys off a **single boolean**: the purchased plan's
`with_material` (`ws_package_course_ebook_price.with_material`). Get that right and
the rest follows. It decides four things at payment-verify time:

1. whether the paid amount is **split** into course vs material portions,
2. whether a **material kit** (`pc_material_id`) is copied onto the subscription,
3. what **status** the tracking row starts in,
4. (always) the **shipping** address is carried from the order to the subscription.

These are **internal/back-office** fields — never returned to the client. The verify
API response (`VerifiedCourseSubscriptionDto`) is unchanged.

---

## Condition 1 — Price split (`course_amount` / `material_amount`)

**Where:** `computeMaterialSplit(paidAmount, plan)` in `commerce-order.service.ts`.

```
if (!plan.withMaterial) {
    courseAmount   = paidAmount      // full amount is the digital portion
    materialAmount = null            // no physical portion
} else {
    materialPrice  = plan.materialPrice ?? 0
    courseAmount   = max(paidAmount - materialPrice, 0)
    materialAmount = paidAmount - courseAmount        // residual
}
```

**Reason:**
- **`materialAmount` is the residual, not `plan.materialPrice`.** Computing it as
  `paidAmount − courseAmount` guarantees `courseAmount + materialAmount` always
  equals **exactly what the customer paid**, even after a promo discount. This is an
  accounting/tax requirement (physical and digital goods are taxed differently).
- **Why this collapses the doc's 3 discount branches into 1.** The legacy doc has
  three branches (no-promo / referral / promocode), each computing
  `courseDiscount = (price − materialPrice) − discount`. But in **this** codebase the
  order row already stores the **post-discount** paid amount (`discount_price`). Since
  `paidAmount = price − discount` in every branch, all three reduce to the same
  `paidAmount − materialPrice`. So we split the paid amount directly — no need to
  re-derive the discount.
- **Clamp at `0`, not `minimumAmount.course`.** The legacy floored the digital
  portion at a `constants.minimumAmount.course` value. **That constant does not exist
  in this codebase**, so we clamp at `0` instead — its only job here is to stop the
  digital portion going negative if a heavy promo drops `paidAmount` below
  `materialPrice`. (If a real minimum is ever required, it goes here.)

---

## Condition 2 — Material kit (`pc_material_id`)

**Where:** `verifyCourseOrderMysql` / `verifyPackageOrderMysql`.

```
pcMaterialId = split.withMaterial
    ? (course path  ? repo.findCoursePcMaterialId(courseId)
                    : repo.findPackagePcMaterialId(packageId))
    : null
```

**Reason:**
- The kit the customer is entitled to is **copied from the purchased Course or
  Package** (`ws_course.pc_material_id` / `ws_package.pc_material_id`) onto the
  subscription. A plan points at **either** a course **or** a package, so exactly one
  lookup runs.
- **Only resolved when `withMaterial`.** A digital-only purchase has no kit → stays
  `null`. We also skip the extra DB read entirely when there's no material.

---

## Condition 3 — Tracking row status

**Where:** `verifyCourseTx` / `verifyPackageTx` (fresh-grant branch),
`commerce-order.repository.ts`.

```
trackingRow.status = material.withMaterial ? "pending" : "complete"
```

**Reason & the one behavior change to be aware of:**
- A tracking row is **still created on every fresh subscription** (unchanged — this
  preserves existing behavior; we did **not** adopt the legacy "create only if
  material" gating, to avoid removing tracking rows from digital orders).
- **What changed:** the status. Previously it was **always `"complete"`**. Now a
  **material** order starts `"pending"` so the physical kit can be picked up and
  advanced through dispatch as it ships; a **digital-only** order stays `"complete"`
  (nothing to ship), exactly as before.

---

## Condition 4 — Shipping address (`shipping`)

**Where:** create-order (`createCourseOrderMysql` / `createPackageOrderMysql`) +
verify (`verifyCourseTx` / `verifyPackageTx`).

```
// create-order: persist the validated address on the order row
order.shipping = customerShippingId ?? null

// verify (fresh grant): copy it from the order onto the subscription
subscription.shipping = order.shipping ?? null
```

**Reason:**
- The SQL create-order path **validated** `customerShippingId` (ownership check) but
  then **dropped it** — it never reached the order row, so a material kit had no
  dispatch address. We now persist it on the order at create-order time and copy it
  onto the subscription at verify, matching the legacy `subscription.shippingId =
  order.shipping`.
- Carried for **all** orders (null for digital-only); it's only *meaningful* for
  material plans but harmless otherwise.

---

## Important boundary — material fields land on a FRESH grant only

When a customer **re-purchases** an already-active plan, the verify path **extends**
the existing subscription (folds the new window + amount onto it) instead of creating
a new row. The **extend branch is unchanged** — it updates only `end_at` and
`amount`. It does **not** re-split amounts, re-copy `pc_material_id`, or create a new
tracking row.

**Reason:** the legacy doc describes **fresh subscription creation only**; it has no
concept of re-purchase/extend. Replicating it faithfully means the material columns
are populated when the subscription row is first created.

> ⚠️ **Open decision (not yet implemented):** if a material re-purchase should
> generate a **new kit shipment** (a fresh tracking row + material split each time the
> customer pays again), the extend branch needs explicit handling. Today it does not.

---

## Quick reference — what gets written, and when

| Field (table) | Set when | Source |
|---|---|---|
| `course_amount` (subscription) | always (fresh grant) | `max(paid − materialPrice, 0)`; full `paid` if no material |
| `material_amount` (subscription) | **only if `withMaterial`** | `paid − course_amount` (residual) |
| `pc_material_id` (subscription) | **only if `withMaterial`** | `ws_course` or `ws_package` `pc_material_id` |
| `shipping` (order + subscription) | when address sent (null otherwise) | validated `customerShippingId`, copied order → subscription |
| tracking `status` | always (fresh grant) | `"pending"` if `withMaterial` else `"complete"` |

---

## Files touched (this change only)

- `src/modules/commerce-order/commerce-order.repository.ts` — `findPlan` reads
  `with_material`/`material_price`; new `findCoursePcMaterialId` /
  `findPackagePcMaterialId`; `createPendingOrder` persists `shipping`; both verify
  txs write the material columns + tracking status.
- `src/modules/commerce-order/commerce-order.service.ts` — `computeMaterialSplit`;
  both verify functions resolve split + kit; both create-order functions accept
  `customerShippingId`.
- `src/client/payment/course-payment.controller.ts`,
  `src/client/payment/package-payment.controller.ts` — pass `customerShippingId`
  through the SQL create-order branch.

See `docs/MIGRATION_QUERY_CHANGES.md` (2026-06-27) for the changelog entry.

---

## Why we did this — in plain English

When a customer buys a plan that includes **printed/physical study material** (books,
notes mailed to them), one payment actually covers **two different kinds of things**:
a digital course (online access) and a physical product (something we ship).

The business needs to treat those two halves differently:

- **Accounting / tax** — physical goods and digital goods are taxed and reported
  differently, so we have to know *how much* of the payment was for the course and
  *how much* was for the material. That's `course_amount` + `material_amount`.
- **Fulfillment** — someone in the warehouse needs to know **what kit to pack**
  (`pc_material_id`), **where to send it** (`shipping`), and **whether it still needs
  to go out** (the tracking row's `pending` status).

Before this change, a "With Materials" purchase went through online checkout but the
system recorded **none of that** — it just stored one lump amount with no split, no
kit reference, no shippable status, and even threw away the delivery address. So the
money couldn't be split for accounting and the warehouse had no record telling them to
ship anything. This change fills in exactly those gaps **at the moment payment
succeeds**, so every material purchase is immediately ready for both the books and the
dispatch desk.

If the plan has **no material**, nothing extra happens — it's just a normal digital
purchase, exactly as before.

---

## Do we need to show this on the Frontend / Admin side?

**Short answer: nothing is *required* for this change to work, and there is no
mandatory FE task. But there are two *optional* admin surfaces worth a product
decision.**

### What's already true today (no work needed)
- These fields are **internal/back-office** — they are **never sent to the customer
  app**, and the customer-facing purchase/verify response is unchanged.
- The **admin subscription list** already shows the `withMaterial` flag. The admin
  **detail (SQL) read** already derives `withMaterial` (from `pc_material_id`) and
  returns the `shipping` address. So the "is this a material order?" signal is already
  visible to admins.
- The **material kit catalog is admin-managed** — admins define kits via
  `src/admin/pc-material/*` (`/api/v1/admin/pc-materials`, single `{ title }` field).
- **Attaching a kit to a course/package** (`pcMaterialId`) is now wired on the **SQL
  admin** course + package create/update (see the next section). This is what gives the
  verify-time copy real data — previously `pc_material_id` was always null for in-app
  products.

### Optional follow-ups (only if Ops wants them) — not built
1. **Show the revenue split in admin.** The admin read responses currently expose
   `paidAmount`/`withMaterial` but **not** `course_amount` / `material_amount`. If the
   accounts team wants to see the course-vs-material breakdown per subscription, the
   admin-subscription transformer/DTO would need those two fields added (read-only —
   the data is already stored). **Small, additive, optional.**
2. **A dispatch/tracking screen.** The tracking row now starts `"pending"` for material
   orders, but **there is no admin endpoint to advance it** (`pending → shipped →
   delivered`) for package/course material — unlike the **book-order** flow, which has
   full courier/AWB tracking. If Ops is expected to fulfil and update kit shipments
   inside this system, that workflow (list pending material subscriptions → mark
   shipped, etc.) would be a **new, separate feature**. Today the field is written but
   nothing advances it.

> **Heads-up — admin offline-grant uses a different split.** When an admin grants a
> subscription manually (`src/modules/admin-subscription/*`, offline/cash/backend),
> it already writes `course_amount = plan.price` and `material_amount = materialPrice`
> (full plan price as the course portion) and **does not set `pc_material_id`**. The
> **online verify path documented here** instead uses the **residual** split
> (`course = paid − materialPrice`) and **does set `pc_material_id`**. They differ on
> purpose (offline grants have no promo/paid-amount and no kit picker wired into the
> admin form). If accounting needs one consistent rule across both, that's a product
> decision to flag — not changed here.

### Bottom line for FE
- **Customer app:** nothing to do.
- **Admin app:** wire the **kit picker** on the course/package forms (below). Optionally
  (a) display the course/material split and (b) build a kit-dispatch/tracking screen —
  both are separate, additive asks, not part of this change.

---

## Attach a kit to a Course/Package — Admin (SQL) contract for Frontend

> **MySQL/Prisma path only.** All ids are numeric. `null` detaches the kit.

**Step 1 — load the kit options for the dropdown**
`GET /api/v1/admin/pc-materials` → `{ success, data: [{ id, title }, ...] }`.

**Step 2 — send the selected kit id on the existing course/package save**

| Form | Endpoint | New field |
|---|---|---|
| Course create | `POST /api/v1/admin/courses` | `pcMaterialId`: number \| null (optional) |
| Course update | `PUT /api/v1/admin/courses/:id` | `pcMaterialId`: number \| null (optional) |
| Package create | `POST /api/v1/admin/packages` | `pcMaterialId`: number \| null (optional) |
| Package update | `PUT /api/v1/admin/packages/:id` | `pcMaterialId`: number \| null (optional) |

Rules:
- **Optional** — omit it and nothing changes (on update, the kit is left as-is).
- Send a **positive integer** = the `id` from `GET /pc-materials` to attach a kit.
- Send **`null`** to detach (clear) the kit.
- Course detail (`GET /api/v1/admin/courses/:id`) and package detail
  (`GET /api/v1/admin/packages/:id`) now **return `pcMaterialId`** so the form can
  pre-select the current kit.

**UX note:** the kit picker is only meaningful for products sold with a "With Materials"
plan. The kit drives *what to ship*; the `withMaterial` boolean still lives on the
**plan/price row**, not on the course/package. Showing the picker only when at least one
material plan exists is a reasonable FE choice (not enforced by the backend).
