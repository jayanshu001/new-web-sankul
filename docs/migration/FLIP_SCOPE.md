# 🎚️ THE FLIP — Scope & Go-Live Plan (Phase 3a + catalog + customer)

> **Status:** SCOPED, awaiting sign-off. **Nothing flipped yet.**
> **Author note:** written from a live audit of the working tree on 2026-06-12, NOT from the
> handoff doc's framing. The audit changed the picture materially — read §1 first.
> **Branch:** `migration` (still NOT merging to `main`).

---

## 1. ⚠ Reality check — what "flip everything together" actually means right now

The RESUME/COMMERCE docs say "flip 3a + catalog (4 keys) + address/profile/bank ON together." That
describes the *eventual* target. But an audit of which module branches are **actually wired into live
request paths** shows most of those keys are inert today:

| Module key | Built? | **Wired into a live controller?** | Flipping it ON today would… |
|---|:--:|---|---|
| `catalog-package-type` | ✅ | ✅ `listPackageTypes` (`GET /client/packages/types`) | **change live traffic** |
| `catalog-package` | ✅ | ❌ reads built, NOT wired (no endpoint branches on `isPackageMysql`) | do nothing |
| `catalog-course` | ✅ | ✅ `listCourseCategoriesHandler` (`GET /client/courses/categories`) | **change live traffic** |
| `catalog-video` | ✅ | ❌ not wired (no safe standalone video-URL endpoint) | do nothing |
| `commerce-price` | ✅ | ❌ not wired | do nothing |
| `commerce-subscription` | ✅ | ❌ not wired | do nothing |
| `commerce-ebook-sub` | ✅ | ❌ not wired | do nothing |
| `commerce-promoter` | ✅ | ❌ not wired | do nothing |
| `commerce-promocode` | ✅ | ❌ not wired | do nothing |
| `commerce-educator` | ✅ | ❌ not wired | do nothing |
| `customer-address` | ✅ | ✅ `address.controller.ts` | **change live traffic** |
| `customer-profile` | ✅ | ✅ `profile/customer.service.ts` | **change live traffic** |
| `customer-bank-account` | ✅ | ✅ `referral.controller.ts` | **change live traffic** |

**Conclusion:** "the flip" as a single big-bang of 13 keys is not real yet. Only **5 keys** are wired
(`catalog-package-type`, `catalog-course`, `customer-address`, `customer-profile`,
`customer-bank-account`). The other 8 are dual-path code with **no consumer** — their flag does nothing
until a controller is rewired to call their branch. That rewiring is itself work that hasn't been done.

So there are really **two different things** the docs have been conflating:
1. **Flipping wired keys** — flips that change behavior (the 5 above).
2. **Wiring the unwired modules** — rewriting controllers (`/client/packages`, `/courses`, `/ebook`,
   `/promocode`, `/dashboard`, …) to call the new branches. This is the bulk of the remaining work and
   is NOT done.

---

## 2. The id-space coupling (why wired keys still can't flip independently)

Even among the 5 wired keys, they can't flip one at a time. MySQL ids are `int`; Mongo ids are
`ObjectId`. A consumer still on Mongo that joins a now-MySQL collection sees mismatched ids.

- `catalog-package-type` / `catalog-course` return **int** `_id`s when ON. Still-Mongo consumers
  (`/packages`, `/courses` detail, dashboard, categories, free, my-subscriptions) join those ids and
  would break.
- `customer-address` / `customer-profile` / `customer-bank-account` are coupled to cart / referral /
  dashboard (still Mongo) via the customer id-space.

This is the genuine reason for "together": any wired key whose output ids are consumed by a still-Mongo
path must wait until those consumers are ALSO on MySQL.

---

## 3. Recommended path forward (smallest safe go-live first)

Big-bang flipping 13 keys is not the right next step, because 8 do nothing and the wired ones still have
Mongo consumers. Instead:

### Option A — **Wire the commerce reads into catalog, THEN flip the catalog+commerce cluster** (recommended)
The 6 commerce read modules exist precisely to unblock catalog detail/listing (which join pricing +
subscriptions). The real next step is to **rewire** `/client/packages`, `/courses`, `/ebook`,
`/promocode`, `/dashboard` to call the commerce + catalog branches, THEN flip that whole cluster as one
consistent int id-space. This is the work that makes the flip meaningful.
- Pro: turns the dormant commerce code into actual value; one coherent go-live.
- Con: the wiring is real work (several controllers, the largest of which join 3–4 tables).

### Option B — **Flip only the customer cluster now** (address/profile/bank)
These 3 are wired and self-contained-ish (customer id-space). If their still-Mongo consumers (cart,
referral, dashboard) can tolerate the int customer id — needs checking — they could go live sooner as a
small, low-blast-radius first flip, independent of catalog/commerce.
- Pro: smallest possible real go-live; proves the flip mechanics end-to-end on low-risk surface.
- Con: needs a consumer-coupling audit first; may surface the same id-space block.

### Option C — **Build D2 catalog relations first** (no flip yet)
`ws_package_specific_subject` (1623), `ws_video_category_relation` (2456),
`ws_video_category_package_relation` (6907), `ws_package_course_material` (1) — these ride the catalog
flip. Building them keeps everything ready but flips nothing.

---

## 4. What a flip actually requires (the runbook, once a cluster is ready)

1. **Pre-flip audit:** for every key in the cluster, grep every consumer of its output ids; confirm each
   consumer is either also in the cluster or tolerates the int id. No dangling Mongo consumer.
2. **Add keys** to `MIGRATION_MYSQL_MODULES` in `.env` (the whole cluster at once).
3. **Restart** the app (`yarn dev` locally first; the flag is read at boot).
4. **HTTP verification** (not tsx): `yarn migration:api` + manual hits on every affected endpoint —
   assert the response contract is byte-compatible with the Mongo path (shape, ids-as-strings, counts).
5. **Rollback plan:** remove the keys from `.env`, restart. Instant revert (no data written — these are
   all reads). Document this in the go-live note.
6. **Per-protocol:** update `MIGRATION_TEST_LOG.md` with the HTTP results + the go-live timestamp.

---

## 5. Open decisions (need your call before I proceed)

| # | Decision | Recommended |
|---|---|---|
| **F1** | Which path next — A (wire commerce→catalog then flip), B (flip customer cluster now), or C (build D2 first)? | **A** — it's the point of the commerce wave; makes the flip meaningful |
| **F2** | If A: scope the wiring as its own pass (controller-by-controller, flag still OFF, verified per-endpoint) before any flip? | **Yes** — same discipline as the module builds |
| **F3** | First HTTP go-live target environment — local `yarn dev` only for now, or staging? | **Local first**, then decide on staging with you |

---

## 6. TL;DR

- "The flip" is not one ready action — **8 of the 13 keys are unwired and would do nothing**.
- Only 5 keys are wired; they still can't flip piecemeal due to int-vs-ObjectId id coupling.
- The meaningful next step is **wiring the commerce reads into the catalog/ebook/promocode/dashboard
  controllers**, then flipping that cluster as one int id-space — not flipping flags on dormant code.
- Recommendation: **Option A**, scoped as a focused wiring pass (flag OFF, per-endpoint HTTP-verified),
  then the cluster flip with the §4 runbook.
