# Caching (project-owned doc)

> This is the **authoritative, project-owned** caching doc. The `cache/` folder
> at the repo root is a **reference copy from a different project** (git-ignored)
> — do not treat it as this project's source of truth. All real caching code and
> decisions for THIS project are described here.

## What we use

**Route-level HTTP response caching** — cache the serialized response of a read
route, with no changes to services. Opt in per route; invalidate on write.

| File | Role |
|------|------|
| [`src/middlewares/cacheRoute.ts`](../src/middlewares/cacheRoute.ts) | Read cache — per-user keys, stampede lock, auth guard, normalized query keys, fail-open, jitter, metrics |
| [`src/middlewares/autoFlush.ts`](../src/middlewares/autoFlush.ts) | `autoFlush()`, `autoFlushGroup()`, `flushEntity()` (for non-route writes) |
| [`src/middlewares/flushGroups.ts`](../src/middlewares/flushGroups.ts) | `CacheEntity` typed union + the admin→client flush map |
| [`src/admin/cache/`](../src/admin/cache/) | `POST /api/v1/admin/cache/flush` + `GET /stats` (auth-gated) |

## How to cache a route

```ts
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";

// READ — tag with a CacheEntity; scope "user" (default) or "shared"
router.get("/:id", cacheRoute({ ttl: 600, entity: "ebook" }), getEbook);

// WRITE — flush the entity + every client cache that embeds it
router.put("/:id", autoFlushGroup("ebook"), updateEbook);
```

- **`scope: "shared"`** — one entry for ALL users. Use ONLY when the response is
  identical for every user. A wrong `shared` on user-specific data leaks it.
- **`scope: "user"` (default)** — keyed by user id + role. Safe for auth-gated,
  per-user responses.
- Add new entity tags to the `CacheEntity` union first (typo = compile error).

## Client read tiers (how we decide)

| Tier | Meaning | Cache |
|------|---------|-------|
| **1 fully shared** | identical for every user (no per-user field) | ✅ `scope:"shared"`, short TTL |
| **2 shared + overlay** | shared content + per-row `isPurchased`/`progress`/etc. | ⏳ needs service split (shared list + per-user overlay) — deferred |
| **3 fully per-user** | whole response is the user's (cart, orders, subs, progress) | `scope:"user"` short-TTL, or don't cache |

## What's wired today

### TTL policy (why almost everything is 24h)

A long TTL does **not** make responses slower — a cache HIT is fast at any TTL; a
longer TTL just means fewer slow MISSes. Freshness comes from **flushing on
change**, not from a short TTL. So:

- **Content + shared reads → `86400` (24h).** Their only staleness source is an
  admin edit, which already flushes instantly. TTL is a pure backstop.
- **Per-user catalog reads (`isPurchased` overlay) → `86400` (24h) + purchase
  flush.** A purchase/grant calls `flushUserRouteCache(customerId)` (see
  Invalidation), so `isPurchased` flips to `true` immediately for that buyer.
- **Kept short:** `GET /client/cart` (30s — your own fast-changing data) and the
  dashboards (60s — embed **notifications**, which nothing flushes).

Residual caveat (accepted): `isPurchased` going `true→false` from a **subscription
expiry or admin revoke** is time/rare-based and reflects on the catalog *card*
within the TTL — actual content access is separately gated live, so it's cosmetic.

**Admin (reads cached, 24h TTL; every write `autoFlushGroup`):**
ebook, course (+ course-scoped video & video-category/material relation writes),
book, package (+ package-type), exam (+ exam-category, questions), material
(+ material-category), video, videoCategory, goal, examCountdown, promocode, plan,
live-course, cms (faq/popup/banner/testimonial/social-link/current-affair/terms),
master (educator/subject-category/material/video-category/package-category).
plan-popularity writes `autoFlush("plan")` (pin/recompute flip an embedded flag).

**Client Tier-1 (`shared`):** CMS (all), course `/categories`, package `/types`,
exam `/categories`, catalog `/tests`, free `/free-materials`, book `/trending*`,
category `/children` drill-downs + `/package-categories`, examCountdown (all),
goal `/`, promocode `/`, referral `/terms` + `/faqs`, inquiry `/contactus`,
notification `/image-notifications`, address reference dropdowns, app-version
`/check`, offline center/batch masters.

**Client per-user (`scope:"user"`, 24h, catalog-* entity — per-user
`isPurchased`/token overlay; flushed by admin writes AND by the buyer's own
purchase):** ebook, book, course (list + category-courses + detail), package
(list + type + goal + detail), catalog `/materials`, categories
material/exam/exam-countdown/package listings, material (contents/recent/detail),
exam (category-exams + daily), free (`/free-tests` `/free-ebooks` `/free-courses`
`/free-videos`†), educator, testSeries, recently-added, live-course (discovery
feeds + detail + sessions). **Kept short:** cart (30s), dashboards (60s).

† `/free-videos` is `scope:"user"` (not shared) because it mints a customer-bound
`mediaToken` per row — a shared key would leak one user's token to all.

## Dashboard, cart & other per-user routes

These are **per-user** — they must NOT be `scope:"shared"` (would leak one user's
data to another). They're cached with **`scope:"user"` + a short TTL** so each
user gets their own copy that refreshes fast:

| Route | Scope | TTL | Why |
|-------|-------|-----|-----|
| `GET /client/dashboard` + `/free-dashboard` | user | 60s | embed **notifications** (arrive anytime, nothing flushes them) |
| `GET /client/cart` | user | 30s | it's *my* cart; changes on my own add/remove |
| catalog per-user reads (ebook/book/course/package/…) | user | 24h | `isPurchased` overlay — flipped to true instantly by the purchase flush |

Cart & dashboards stay short because they go stale from something a purchase
flush can't fix (my own cart edits; incoming notifications). Everything else
per-user is 24h + purchase-flush. **Not** cached (Tier-3, no benefit or
correctness risk): orders, invoices, subscriptions, downloads, resume/progress,
saved, wishlist, single-video playback (per-request tokens), payments.

## Invalidation

- **Admin writes** call `autoFlushGroup(entity)` → clears that entity + every
  client cache embedding it (map in `flushGroups.ts`).
- **Non-route writes** (BullMQ jobs, webhooks, other modules) call
  `await flushEntity(entity)` directly.
- **Entitlement changes** (purchase / admin grant) call
  `await flushUserRouteCache(customerId)` — a **per-user** sweep that clears only
  *that buyer's* keys across all entities (not everyone's), so their `isPurchased`
  overlay refreshes immediately. Wired in `payment/verify.controller` (all 6
  product kinds) and the admin grant controllers (course/package, ebook,
  live-course). This is what lets per-user catalog reads run a 24h TTL safely.
- **Cart & dashboards** rely on TTL (30s / 60s) — cart also self-flushes on its
  own writes; dashboards just expire fast because notifications aren't flushed.
- **Manual:** `POST /api/v1/admin/cache/flush { prefix? }` (admin-auth).

## The rule for future modules (review checklist)

1. New cached read → `cacheRoute({ entity })`, tag in the `CacheEntity` union.
2. Every write on that entity → `autoFlushGroup(entity)`.
3. Response embeds another entity's data → add this tag to that entity's group.
4. A write elsewhere (job/webhook) changes this data → `flushEntity(entity)`.
5. Client read identical for all users → `scope:"shared"`; else `"user"`.
6. `yarn typecheck` green.

## Limitations (accepted, at admin scale)

Response caching has no data model, so: the flush map is **manual** (add an embed
→ update the map, or stale until TTL); flushes are **entity-wide** (blunt but
correct); Tier-2 lists need a **service split** to cache. These are fine at
500–1000 admins + a small embed graph. Full detail + the deferred Tier-2 overlay
plan live in the reference `cache/README.md` (git-ignored) and the notes here.

## Debug / ops

```bash
CACHE_DEBUG=true yarn dev     # logs HIT / MISS / auto-flush per route
```
`/metrics` → `cacheHitsTotal` / `cacheMissesTotal`. Redis down → bypass, still correct.
