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

**Admin:** ebook, course (reads cached; writes `autoFlushGroup`).
**Client Tier-1 (`shared`):** CMS (all), course `/categories`, package `/types`,
exam `/categories`, catalog `/tests`, free `/free-materials` + `/free-videos`,
book `/trending*`, category `/children` drill-downs, `/package-categories`.
**Client per-user short-TTL (`scope:"user"`):** dashboard, cart (see below).

## Dashboard, cart & other per-user routes

These are **per-user** — they must NOT be `scope:"shared"` (would leak one user's
data to another). They're cached with **`scope:"user"` + a short TTL** so each
user gets their own copy that refreshes fast:

| Route | Scope | TTL | Why |
|-------|-------|-----|-----|
| `GET /client/dashboard` | user | 60s | isPurchased per card + notifications + goal ordering are per-user |
| `GET /client/cart` | user | 30s | it's *my* cart; changes on add/remove |

Short TTL because per-user data changes often; the cache only helps rapid
re-loads within the window. **Not** cached (Tier-3, genuinely no benefit or
correctness risk): orders, invoices, subscriptions, downloads, resume/progress,
saved, wishlist, single-video playback (per-request tokens), payments.

## Invalidation

- **Admin writes** call `autoFlushGroup(entity)` → clears that entity + every
  client cache embedding it (map in `flushGroups.ts`).
- **Non-route writes** (BullMQ jobs, webhooks, other modules) call
  `await flushEntity(entity)` directly.
- **Per-user short-TTL routes** rely on TTL (no flush needed for cart/dashboard).
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
