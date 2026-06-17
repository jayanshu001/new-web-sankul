# Migration Deadline & Implementation Plan — SQL-Only Cutover

> **Snapshot:** 2026-06-17 · DB: `websankul_staging` (MySQL @ 127.0.0.1:3307)
> **Goal:** Every screen shows **SQL data**, not MongoDB — across **Admin** and **Client**.
> **Capacity assumed:** 1 developer, full-time (~6–8 focused hrs/day).
> **Test bar:** Manual QA in the admin panel / client app (click through, confirm SQL rows show).
> **Rule (project):** whichever table/module exists on SQL, we use SQL.

---

## TL;DR — Deadlines at a glance

| Surface | Modules left | Realistic deadline (1 dev, FT) | Hard blocker? |
|---|---|---|---|
| **ADMIN side** | 3 buildable + 2 flips | **5–7 working days** | Notifications + LiveChat have **no SQL table** → cannot be SQL-only without new DDL |
| **CLIENT side** | 5 buildable | **6–8 working days** | None buildable are blocked; live-course/test-series purchase paths have no SQL table |
| **EDUCATOR side** | 3 (dashboard/course/package) | **3–4 working days** | Depend on subscription tables — **these now exist on SQL** ✅ |
| **PROMOTER side** | 4 (auth + 3 read) | **3–4 working days** | `ws_promoter_access_token` **missing** → auth needs a new token table (DDL, ~0.5 day) |
| **Infra / cross-cutting** | FCM, sockets, webhooks, PDF receipt | **2–3 working days** | livechat socket blocked (no SQL table) |

> **End-to-end "everything on SQL" (sequential, 1 dev): ~4–5 calendar weeks (19–26 working days)**, *excluding* the items that physically have no SQL table (see ⛔ section). With the ⛔ items descoped or their tables created, the realistic target is **~3.5 weeks**.

---

## ⚠️ The one fact that caps the deadline: some tables do NOT exist on SQL

"Only show SQL data" is **impossible** for a screen whose table was never created in MySQL. I probed the live staging DB on 2026-06-17. Results:

### ✅ Table EXISTS on SQL — migration is a code task only
| Table | Rows (staging) | Feeds |
|---|---|---|
| `ws_promoter` | 114 | Promoter auth + dashboard + lists |
| `ws_package_course_subscription` | 2 | Educator dashboards, admin customer detail, promoter subs |
| `ws_customer_address` | 2 | Client address book, admin customer detail |
| `ws_book_cart` | 2 | Client cart |
| `ws_ebook_subscription` | 1 | Entitlement (already wired) |
| `ws_image_notification` | 1 | Notification images |
| `ws_refferal_transaction` | 0 | Referral rewards/transactions (empty but present) |

### ⛔ Table MISSING on SQL — CANNOT be SQL-only without new DDL first
| Missing table | Blocks | What it costs to unblock |
|---|---|---|
| `ws_notification` | **Admin → Notifications** create/dispatch/list | New table DDL + Prisma model + backfill, ~1 day before any migration |
| `ws_live_chat_message` | **Admin → LiveChat** history/send + client socket | New table DDL + model, ~1 day |
| `ws_live_chat_ban` | LiveChat ban list | (with above) |
| `ws_promoter_access_token` | **Promoter login** on SQL | New token table DDL (mirror `ws_admin_access_tokens`), ~0.5 day — already a known pattern |
| `ws_test_series` / `ws_test_series_subscription` | Test-series purchase + admin test-series detail | Out of scope this wave (no tables) |
| `ws_live_course` / `ws_live_course_subscription` | Live-course purchase + educator live-course refs | Out of scope this wave (no tables) |

**Decision needed from you:** for Notifications & LiveChat, either (a) create the SQL tables first (adds ~2 days), or (b) leave those two admin screens on Mongo and exclude them from "SQL-only". The deadlines above assume **(b) descope** unless you say otherwise.

---

## Status: what's DONE vs what's LEFT

### ✅ DONE & confirmed by you (tested in admin panel)
`ws_testimonial` · `ws_faq` · `ws_popup_notification` · `ws_department` · `ws_users` (administrators) · `ws_customers` · `ws_course_educators`

### ✅ DONE in code & tsx-verified, but **NOT yet manually QA'd in the panel** (your next testing pass)
These are live on SQL (flag ON) but you haven't clicked through them:
`app-update` · `version` · `banner-slider` · `terms` · `offline-city` · `catalog-package-type` · `catalog-course` · `catalog-video` · `catalog-ebook` · `catalog-exam` · `catalog-material` · `catalog-book` · `offline-batch` · `commerce-price` · `commerce-subscription` · `commerce-ebook-sub` · `commerce-promoter` · `commerce-promocode` · `commerce-educator` · `customer-auth` · `customer-lookups` · `customer-profile` · `customer-bank-account` · `admin-auth` (full administrator CRUD) · `educator-auth` (login + admin educator master CRUD)

### 🟡 BUILT but flag-OFF (write/payment paths — enable + QA needed)
`commerce-order` (course purchase) · `ebook-order` · `book-order` · `offline-enquiry` · `package-chat`
→ These are tsx-verified but never ran live on SQL. Enabling = add to `MIGRATION_MYSQL_MODULES` + real end-to-end payment QA.

### 🔴 LEFT TO BUILD (no SQL branch yet)
Grouped by surface below.

---

## STRATEGY — Module-by-module, every folder mapped to a category

The codebase splits cleanly into **5 surfaces**. Each row lists **the exact folder(s)**, the SQL table, whether the table exists, and the estimate.

---

### 🟦 SECTION A — ADMIN SIDE  *(deadline: 5–7 working days)*

| # | Folder | Mongo models used | SQL table | Exists? | Effort | Notes |
|---|---|---|---|---|---|---|
| A1 | `src/admin/dashboard/` | Customer | `ws_customer` | ✅ | **0.5 d** | Pure `count`/`countActive` → `prisma.customer.count`. Cheapest win. |
| A2 | Admin customer **detail aggregates** in `src/admin/customer/customer.controller.ts` (`getCustomerCourseSubscriptions`, `getCustomerEbookSubscriptions`, `getCustomerAddresses`, `getCustomerDetails`) | PackageCourseSubscription, EbookSubscription, CustomerAddress, BookOrder | `ws_package_course_subscription`, `ws_ebook_subscription`, `ws_customer_address`, `ws_book_order` | ✅ all exist | **1.5 d** | CRUD already SQL; these 4 handlers return empty today. Now unblocked — tables exist. |
| A3 | `src/admin/notification/` (`notification.controller.ts`, `audience.ts`, `dispatcher.ts`) | Notification, ImageNotification, Customer | `ws_notification` | ⛔ **MISSING** | **1 d build + 1 d DDL** | Blocked: must create `ws_notification` first, OR keep on Mongo. |
| A4 | `src/admin/livechat/` | LiveChatMessage, LiveChatBan, Customer | `ws_live_chat_message`, `ws_live_chat_ban` | ⛔ **MISSING** | **1 d build + 1 d DDL** | Same blocker. Realtime socket (`src/socket/livechat.socket.ts`) rides along. |

**Admin deadline:** A1+A2 = **2 days** (both fully unblocked). A3+A4 = **2 days IF you descope to Mongo**, or **+2 days** if you create the tables. → **5–7 days** depending on the Notifications/LiveChat decision.

---

### 🟩 SECTION B — CLIENT SIDE  *(deadline: 6–8 working days)*

| # | Folder | Mongo models | SQL table | Exists? | Effort | Notes |
|---|---|---|---|---|---|---|
| B1 | `src/client/goal/goal.client.service.ts` | Goal | `ws_customer_target_goal` | ✅ | **0.5 d** | Profile already hydrates goals from SQL — reuse that repo. |
| B2 | `src/client/cart/cart.controller.ts` | BookCart, Book, BookOrder | `ws_book_cart`, `ws_book_cart_item` | ✅ | **1.5 d** | 4 handlers (add/update/remove/get). Book + book-order already SQL → ids line up. |
| B3 | `src/client/referral/referral.controller.ts` | Customer, ReferralTransaction, CustomerBankAccount | `ws_customer`, `ws_refferal_transaction` | ✅ (txn table empty) | **2 d** | Bank-account ops already SQL. Withdrawal uses Razorpay payout — careful QA. |
| B4 | `src/client/promocode/promocode.controller.ts` | PromoCode, Customer | `ws_promocode`, `ws_customer` | ✅ | **0.5 d** | Admin promocode already SQL; client apply-path just needs the customer lookup flipped. |
| B5 | `src/client/orders/orders.controller.ts` | Customer (`findOne({referralCode})`) | `ws_customer` | ✅ | **0.5 d** | Single referral lookup; small. |
| B6 | **Enable** built write paths (`commerce-order`, `ebook-order`, `book-order`, `offline-enquiry`, `package-chat`) | — | already mapped | ✅ | **1.5 d** | Flag-flip + real Razorpay end-to-end QA. |

**Client deadline:** ~6.5 days of build + buffer → **6–8 days**. None are hard-blocked.

---

### 🟨 SECTION C — EDUCATOR SIDE  *(deadline: 3–4 working days)*

| # | Folder | Mongo models | SQL table | Exists? | Effort |
|---|---|---|---|---|---|
| C1 | `src/educator/dashboard/dashboard.controller.ts` | Course, Package, PackageCourseSubscription, Customer | `ws_package_course_subscription` (+ course/package already SQL) | ✅ | **1 d** |
| C2 | `src/educator/course/course.controller.ts` | Course, PackageCourseEbookPrice, PackageCourseSubscription, Customer | same | ✅ | **1.5 d** |
| C3 | `src/educator/package/package.controller.ts` | Package, PackageCourseEbookPrice, PackageCourseSubscription, Customer | same | ✅ | **1.5 d** |

> Auth (`educator.auth.service.ts`) + admin educator master CRUD = **already done** (2026-06-17). These three were "blocked on subscription models" — but `ws_package_course_subscription` **exists on SQL**, so they're now buildable. **No hard blockers.**

---

### 🟧 SECTION D — PROMOTER SIDE  *(deadline: 3–4 working days)*

| # | Folder | Mongo models | SQL table | Exists? | Effort | Notes |
|---|---|---|---|---|---|---|
| D1 | `src/promoter/auth/promoter.auth.service.ts` | Promoter, PromoterAccessToken | `ws_promoter` ✅ / `ws_promoter_access_token` ⛔ | partial | **1 d** | `ws_promoter` has 114 rows. Token table **missing** → create it (mirror `ws_admin_access_tokens`, a known pattern, ~0.5 d). |
| D2 | `src/promoter/dashboard/` (`dashboard.controller.ts` + `overview.service.ts`) | Promoter, ReferralTransaction, Customer | `ws_promoter`, `ws_refferal_transaction`, `ws_customer` | ✅ | **1 d** | Shares referral tables with client B3 — do together. |
| D3 | `src/promoter/customer/customer.controller.ts` | Customer, Promoter | `ws_customer`, `ws_promoter` | ✅ | **0.5 d** | |
| D4 | `src/promoter/subscription/subscription.controller.ts` | PackageCourseSubscription, Customer | `ws_package_course_subscription` | ✅ | **0.5 d** | |

---

### 🟫 SECTION E — INFRA / CROSS-CUTTING  *(deadline: 2–3 working days)*

| Folder | Area | SQL table | Exists? | Effort |
|---|---|---|---|---|
| `src/utils/fcm.ts` | FCM delivery tracking (`updateMany` device/read) | `ws_customer` | ✅ | **0.5 d** |
| `src/webhooks/razorpay-payout.controller.ts` | Payout webhook | `ws_refferal_transaction`, `ws_customer` | ✅ | **0.5 d** (do with B3) |
| `src/socket/livechat.socket.ts` | LiveChat realtime | `ws_live_chat_message` | ⛔ | blocked with A4 |
| `src/utils/pdfCourseReceipt.ts` | Receipt PDF | `ws_customer` | ✅ | **0.5 d** |
| `src/libs/core/generate.ts` | ref-code/seq generation | generic | n/a | **0.5 d** |

---

## HOW WE PROCEED — execution order (waves)

Ordered so each wave **unblocks the next** and shares table work (referral, subscriptions) to avoid touching the same table twice.

**Wave 1 — Cheap admin + client wins (2 days):** A1 (admin dashboard counts), B1 (goals), B4 (promocode), B5 (orders lookup). All single-table count/lookup flips. *Immediate admin-panel visibility.*

**Wave 2 — Subscription-backed reads (3 days):** A2 (admin customer detail) + C1/C2/C3 (educator) + D4 (promoter subs). All read `ws_package_course_subscription` — build the subscription repo **once**, reuse 5×.

**Wave 3 — Referral cluster (2.5 days):** B3 (client referral) + D2 (promoter dashboard) + razorpay-payout webhook. All share `ws_refferal_transaction` + `ws_customer`. Build together.

**Wave 4 — Promoter auth + remaining promoter (1.5 days):** create `ws_promoter_access_token` (DDL), D1 + D3.

**Wave 5 — Cart + write-path enablement (3 days):** B2 (cart) + B6 (flip commerce-order/ebook-order/book-order/offline-enquiry/package-chat ON, real-payment QA).

**Wave 6 — Infra (1.5 days):** fcm.ts, pdfCourseReceipt.ts, generate.ts.

**Wave 7 (CONDITIONAL) — Notifications + LiveChat (4 days):** ONLY if you choose to create `ws_notification` / `ws_live_chat_*` tables. Otherwise these two admin screens stay on Mongo and are formally descoped.

> **Total: Waves 1–6 = ~13.5 working days ≈ 2.5–3 calendar weeks** for full Admin+Client+Educator+Promoter+Infra **excluding** the no-table items.
> **+ Wave 7 = ~3.5 weeks** if Notifications/LiveChat tables are created.

---

## Per-module implementation recipe (the repeatable pattern)

Every migration so far followed this — keep it identical for consistency and low risk:

1. **Confirm the SQL table + columns** (`prisma db pull` already done; check the `@@map` model exists). If missing → DDL first.
2. **Build `src/modules/<name>/`** = `repository.ts` (raw Prisma reads/writes) + `transformer.ts` (row → Mongo-shaped DTO) + optional `service.ts`.
3. **Branch the controller** behind `isMysqlModule("<flag>")` — keep the Mongo path as fallback (dual-read safety).
4. **Verify** against live `websankul_staging` (your bar: manual QA in the admin panel — open the screen, confirm SQL rows render and CRUD works).
5. **Flip the flag** — add `<flag>` to `.env` `MIGRATION_MYSQL_MODULES`, restart `yarn dev`.
6. **Log it** — append a newest-first entry to [docs/MIGRATION_QUERY_CHANGES.md](MIGRATION_QUERY_CHANGES.md) and update [docs/MIGRATION_MONGO_REMAINING.md](MIGRATION_MONGO_REMAINING.md).

**Manual-QA checklist per screen (your test bar):**
- [ ] Screen loads without 500s
- [ ] Row count / values match what MySQL holds (not Mongo)
- [ ] Create → row appears in `ws_*` table
- [ ] Update → row changes
- [ ] Delete/disable → row hidden/soft-deleted
- [ ] Search / filter / pagination return correct SQL results

---

## Open decisions I need from you

1. **Notifications + LiveChat:** create the SQL tables (adds ~2 days, makes them SQL-only) **or** descope to Mongo? *(deadlines above assume descope)*
2. **Live-course / Test-series:** confirmed out of scope (no SQL tables, like pendrive-course)? They affect educator live-course refs + the purchase verify dispatch.
3. **Write-path go-live:** OK to flip commerce-order/ebook-order/book-order ON in staging for real-payment QA? They're built but have never run live on SQL.

Answer these three and I'll start Wave 1 immediately.
