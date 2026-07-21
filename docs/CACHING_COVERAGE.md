# Caching Coverage — Which Modules Are Cached (and Which Aren't)

A simple, module-by-module map of where route-level response caching is applied.
For the *how* (tiers, scopes, flush map), see [`CACHING.md`](./CACHING.md).

**Quick key**
- **Cached** = read responses are stored (Redis) and served fast; writes clear them.
- **Shared** = one copy for everyone (public data).
- **Per-user** = one copy per customer, 24h life (data has a personal bit like *isPurchased*); a purchase instantly clears that buyer's copy so it never shows stale ownership. Cart (30s) and dashboard (60s) stay short.
- **Not cached** = served fresh every time (reason given).

---

## Admin side

### ✅ Cached (list + detail cached; every edit clears the cache)

| Module | What's cached | Why it's safe/useful |
|--------|---------------|----------------------|
| ebook | list + detail | master catalog data, changes rarely |
| book | list + detail | master catalog data |
| course | list + detail + course videos | master catalog data |
| package | list + detail + package types | master catalog data |
| exam | list + detail + exam categories + questions | master data |
| material | list + detail + material categories | master data |
| video | list + detail | master data |
| videoCategory | list + detail | master data |
| goal | list + detail | small master list |
| examCountdown | categories + countdowns | master data |
| promocode | list + detail | master data |
| plan | list + detail | pricing master (embedded everywhere) |
| live-course | list + detail | master catalog data |
| cms | faq, popup, banner, testimonial, social-link, current-affair, terms | slow-changing content |
| master | educator, subject/material/video/package categories | master lookups |
| plan-popularity | *(no read)* — pin/recompute just clear the plan cache | keeps "Most Popular" badge fresh |

### ⛔ Not cached (with reason)

| Module | Reason |
|--------|--------|
| auth | login/refresh tokens — must never be cached |
| dashboard | live counts that must always be current |
| exports | streaming CSV/Excel downloads |
| uploads | file upload / signed URLs (one-time) |
| cache | it *is* the flush/stats endpoint |
| notification | sending + live unread counts |
| livechat, livepoll, live | real-time / live-session state |
| tracking | write/telemetry only |
| customer, subscription, promoter, referral | per-user / financial data (and no shared cache tag) |
| offline, inquiry | live enquiries; no matching cache tag |
| administrator, role, permission, permissionCategory | super-admin config, rarely read |
| address, customer-master, pc-material, testSeries | reference/relational data with no matching cache tag |

> "No matching cache tag" means there's no entity label for it yet, so it can't be
> auto-cleared when edited — safer to leave uncached than risk stale data.

---

## Client side

### ✅ Cached — Shared (one copy for all users, public data)

| Module | Route(s) | Why shared is safe |
|--------|----------|--------------------|
| cms | all content endpoints | same content for everyone |
| examCountdown | categories, upcoming, list | same for everyone |
| goal | active goals list | same for everyone |
| promocode | public promocode list | same for everyone |
| referral | terms, faqs | static content |
| inquiry | contact-us | static info |
| notification | image-notifications (banners) | same for everyone |
| address | states, cities, centers, educations, characteristics | public dropdowns |
| app-version | version check | app config |
| offline | centers, batches (+ detail) | same for all customers |
| book | trending lists | no personal data |
| course | categories | no personal data |
| package | types | no personal data |
| exam | categories | no personal data |
| catalog | tests tab | count summaries only |
| categories | children drill-downs, package-categories | tree data only |
| free | free-materials | same for everyone |

### ✅ Cached — Per-user (24h + purchase-flush, because it carries a personal *isPurchased* bit)

| Module | Route(s) |
|--------|----------|
| ebook | list + detail |
| book | list + detail |
| course | list, category-courses, detail |
| package | list, by-type, by-goal, detail |
| catalog | materials tab |
| categories | material/exam/exam-countdown/package listings |
| material | contents, recent, detail |
| exam | category-exams, daily |
| free | free-tests, free-ebooks, free-courses, **free-videos** |
| educator | educator detail (with courses) |
| testSeries | list, detail, papers |
| recently-added | combined feed |
| live-course | discovery feeds, detail, sessions |
| dashboard | dashboard |
| cart | cart |

> **free-videos** is per-user (not shared) on purpose: it mints a token tied to the
> logged-in customer, so a shared copy would hand one user's token to everyone else.

### ⛔ Not cached (with reason)

| Area | Reason |
|------|--------|
| Any video/lecture playback (course `/lecture`, category videos, live-course recordings/lecture) | each response has a one-time, customer-bound media token |
| Live things (live-now sessions, package chat, live-session status, live chat/poll) | state changes second-to-second |
| Orders, invoices, receipts | personal purchase records |
| Subscriptions, my-subscriptions, purchase-history | personal account data |
| Downloads, saved materials, wishlist, folders, notes | personal lists |
| Progress / resume (course `/my`, free-videos resume, learning) | changes as the user watches |
| Profile, addresses, referral rewards/transactions/bank-accounts | personal data / financial |
| Notifications feed + unread count | personal + live |
| Search, search history | open-ended queries, per-user |
| Payments | never cache money movement |

---

## The one rule behind all of it

- **Same for everyone?** → cache *shared*.
- **Has a personal bit (isPurchased/progress)?** → cache *per-user*, short life.
- **Changes constantly, is a one-time token, or is money/account data?** → don't cache.

Every cached read is tagged to an entity, and every admin edit of that entity
clears the matching caches — so users never see stale data beyond the short TTL.
