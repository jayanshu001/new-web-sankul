# Commerce / Dashboard Wave — Migration Scope

> **Created:** 2026-06-11
> **Tracker:** §15 — the wave that flips catalog ON. Orders, subscriptions, pricing, promocode, dashboard.
> **Pattern:** `repository → service → transformer` + `isMysqlModule("<key>")` dual-path.
> **Standing rules (memory):** every route requires a Bearer token; any video-URL response matches `/v1/lecture`'s encryption + shape; `duration` on price rows is **days** (use the planDuration helper, `setDate` not `setMonth`).

---

## 0. Why this wave exists / what it unblocks

Catalog (`catalog-package*`, `catalog-course`, `catalog-video`) is **built dual-path, all flags OFF**.
It cannot flip standalone: catalog detail/listing endpoints **join pricing + check subscriptions**, and the
catalog int id-space is read by still-Mongo commerce/dashboard consumers. This wave migrates those
consumers so the **entire int id-space flips at once** — catalog **+** address/profile/bank **+** commerce.

**This is the highest-risk wave in the migration.** The subscription table is the **entitlement source of
truth** (lecture access, ebook downloads, dashboard counts, my-subscriptions, purchase-history all read it),
and `verify.controller.ts` (569 lines) is the **Razorpay payment write-path** — real money, real writes.

---

## 1. Scope boundary — sequenced, NOT one big flip

The recommended sequencing is **read-first**, so the safe reads unblock catalog before the dangerous
write-path is touched:

### Phase 3a — read-only commerce (build + verify, flag OFF) — UNBLOCKS CATALOG
| Table | Rows | Key | Notes |
|---|---|---|---|
| `ws_package_course_ebook_price` | 1353 | `commerce-price` | pure lookup; feeds package/course detail. `duration` = **days**. |
| `ws_package_course_subscription` (read) | 2 | `commerce-subscription` | entitlement read ("does customer own this?"). Write-path is 3b. |
| `ws_ebook_subscription` (read) | 1 | `commerce-ebook-sub` | ebook entitlement read. |
| `ws_promoter` | 114 | `commerce-promoter` | promocode owner master. |
| `ws_promocode` | 2 | `commerce-promocode` | + `ws_promoted_package_course_ebook` (5). read-path for validation. |
| `ws_course_educator` | 56 | `commerce-educator` | **NOT a join table** — full educator entity w/ auth fields. Read-only here. |

### Phase 3a (D2 — catalog relations, folded in) — flip with catalog
| Table | Rows | Notes |
|---|---|---|
| `ws_package_specific_subject` | 1623 | package ↔ subject join (builds package video groups). |
| `ws_video_category_relation` | 2456 | category tree (`parent`/`child`/`order`). `order` is reserved → `@map`. |
| `ws_video_category_package_relation` | 6907 | video-category ↔ package join. |
| `ws_package_course_material` | 1 | package material titles. |

### Phase 3b — write-path (DANGEROUS — done last, isolated) — real money
| Table | Rows | Key | Notes |
|---|---|---|---|
| `ws_package_course_order` | 3 | `commerce-order` | Razorpay order; `customer_id` is **varchar** (see §2). |
| `ws_package_course_subscription` (write) | 2 | — | written by `verify.controller` on payment success. |
| `ws_package_course_subscription_tracking` | 3 | — | `order` column is reserved → `@map`. |
| `ws_ebook_order` + `ws_ebook_subscription` (write) | 2 / 1 | `commerce-ebook-order` | ebook purchase write-path. |

**OUT of this wave (separate later waves):** books (`ws_book*`), pendrive (`ws_pendrive_course*`),
exams (`ws_exam*`), material content (`ws_material*`), offline classes (`ws_offline_*`), referral
transactions/wallet (`ws_refferal_*`), misc (`ws_dynamic_image`, `ws_image_notification`, inquiries),
and the Laravel admin/RBAC tables (`ws_users`, `ws_roles`, `ws_permissions`, …) — "hardest last".
**live-course is Mongo-only** (no `ws_live_course*` table exists in the dump) — not part of this wave.

---

## 2. Schema-drift flags — VISIBLE BEFORE CODING ⚠️

The address/offline lesson: `DESCRIBE` every table vs the Prisma model first. Already spotted:

1. **`customer_id` is `varchar(255)`** in `ws_package_course_order` **and** `ws_ebook_order` — it stores the
   Mongo ObjectId as a string. But `ws_package_course_subscription.customer_id` is **`int`**. So one wave
   carries **both** representations of customer id (order = legacy string, subscription = new int). The
   order→subscription seam must be handled deliberately — do **not** assume a uniform int customer id.
2. **Reserved-word columns** needing Prisma `@map`:
   - `ws_package_course_subscription_tracking.order`
   - `ws_video_category_relation.order`
3. **`price.duration` is DAYS** (memory: `project_plan_duration_unit`) — compute `endAt` via the planDuration
   helper using `setDate`, never `setMonth`.
4. **`ws_course_educator`** is a full entity (email/password/about/view/last_seen), **not** a join table —
   it was mis-grouped as a "catalog relation" earlier. Read-only in 3a; its auth fields are admin-side.
5. Per-table, still check: phantom columns, Int vs BigInt overflow (e.g. `tracking` bigint), NOT NULL cols
   the Mongo model omits, nullable mismatches.

---

## 3. Consumer surface (≈30 consumers — entitlement backbone)

The subscription read is joined across the client. Largest/most load-bearing:
- **`src/client/payment/`** — write-path. `verify.controller.ts` (569), `*-payment.controller.ts`,
  `razorpay*.ts`. **3b only.**
- **`src/client/orders/`** (orders.controller 438), **`src/client/purchase-history/`** (315 + receipts 251),
  **`src/client/my-subscriptions/`** — order/subscription **reads**.
- **`src/client/promocode/`** (controller 218, applies-to, validation) — promocode validation read.
- **Entitlement readers:** `course/lecture.controller`, `course/progress`, `ebook/ebook-downloads`,
  `learning/*`, `dashboard/`, `profile/dashboard`, `free/`, `webhook/`, `search/`.
- **Dashboard composition (memory):** profile dashboard `downloads` = savedMaterials + savedVideos +
  activeEbookDownloads — verify those joins after the flip.

---

## 4. ID-space coupling — the whole point of the wave

Catalog + address/profile/bank are OFF because still-Mongo commerce consumers join their int ids across the
ObjectId boundary. This wave removes that boundary by migrating the consumers. **Flip order:**

1. Build **3a** (price, subscription-read, promoter/promocode, educator) + **D2** relations — all dual-path,
   flag OFF, tsx-verified.
2. **Flip 3a + catalog + address/profile/bank together** — one consistent int id-space. This is the first
   go-live since the customer module.
3. Build **3b** write-path with the read-path already proven; flip when verified.

**Do not flip 3a piecemeal** — same inconsistent-id-space failure as the `ws_package_type` standalone attempt.

---

## 5. Open decisions (before coding)

- **C1 — confirm 3a sub-order:** `price` → `subscription-read` → `promoter`+`promocode` → `educator`
  (price first = pure lookup, lowest risk; recommended), or different?
- **C2 — D2 timing:** fold the 4 relation tables into 3a (recommended — they ride the catalog flip), or
  defer again to a browse wave? (Catalog video build already deferred them once.)
- **C3 — customer_id seam (§2.1):** in the order transformer, keep `customer_id` as string and resolve to the
  int customer at the subscription boundary, or normalize earlier? Decide before the order module.
- **C4 — 3b isolation:** confirm the write-path (Razorpay verify) is a **separate focused pass** after 3a +
  catalog flip — not built alongside the reads.

---

## 6. Definition of done (per module)

- [ ] Prisma model verified vs `DESCRIBE` (no drift / overflow / phantom cols / reserved-word `@map`)
- [ ] repository + service (dual-path) + transformer; controllers branched on `isMysqlModule("<key>")`
- [ ] **price:** `duration` treated as days via planDuration helper
- [ ] **subscription/order:** `customer_id` string-vs-int seam handled (§2.1)
- [ ] Entitlement parity: a migrated subscription read grants/denies access identically to Mongo
- [ ] **3b:** Razorpay verify writes order+subscription+tracking correctly; idempotent; no double-grant
- [ ] Consumer audit: 3a + catalog + address/profile/bank flip together (no cross-boundary int↔ObjectId join)
- [ ] Registry + schema-comparison generators; api-tests; test log; tracker; README; regen docs
- [ ] Append newest-first entry to `docs/MIGRATION_QUERY_CHANGES.md`

---

## 7. Build outcome — (to be filled as modules complete)

_(pending C1–C4 answers + build)_
