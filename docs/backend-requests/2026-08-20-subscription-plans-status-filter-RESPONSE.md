# Response — `/admin/subscriptions/plans` drops inactive plans and omits `updatedAt`

**Re:** `2026-08-20-subscription-plans-status-filter.md` (revised version)
**Date:** 2026-08-20
**Status:** ✅ Both halves implemented — `status` param **and** `updatedAt`. No DDL, no
migration. Backend ships alone.
**Action required from the frontend:** send `?status=all` from the picker. Then read the
two data findings below — they change what you will actually see.

---

## What you asked for, and what shipped

An opt-in way to include inactive plans, default unchanged. Done, using the
`status=all` spelling you listed first (not `includeInactive=true`).

```
GET /api/v1/admin/subscriptions/plans?courseId=41              → active only  (unchanged default)
GET /api/v1/admin/subscriptions/plans?packageId=5&status=true  → active only  (explicit)
GET /api/v1/admin/subscriptions/plans?packageId=5&status=false → inactive only
GET /api/v1/admin/subscriptions/plans?packageId=5&status=all   → both
```

| Param | Type | Notes |
|---|---|---|
| `courseId` / `packageId` | int | Unchanged. One is still required (`400` otherwise) |
| `status` | `true` \| `false` \| `all` | **Optional. Absent = `true`.** Unknown value → `422` |

**The default did not move.** Every existing caller, including the customer-facing app,
gets exactly what it got before. Only an explicit `status=all` widens the result.

## `updatedAt` — shipped

The row now carries `updatedAt` (ISO string or `null`), matching the live-course /
test-series / ebook plan DTOs. Purely additive: **exactly one new key**, appended after
`packageId`. The other ten keys, their order, and `duration ASC` are untouched.

```jsonc
{ "_id": "389", "name": "1 Month", "duration": 30, "price": 799, "materialPrice": 0,
  "withMaterial": false, "isDefault": true, "status": false, "courseId": null,
  "packageId": "5", "updatedAt": "2025-06-19T15:32:14.000+05:30" }
```

## ⚠ Two data findings — read before you test the 7-day rule

We counted across all 1367 rows of `ws_package_course_ebook_price` on staging:

| | Count |
|---|---|
| Inactive plans | 317 |
| … `updated_at IS NULL` → **your rule drops these permanently** | **149** (47%) |
| … `updated_at` within the last 7 days → actually visible | **0** |

**1. Half the inactive plans have no `updated_at`.** Your stated rule is "an inactive plan
with no `updatedAt` is dropped — it cannot prove it is recent." That silently hides 149
plans. We cannot fix this server-side: there is no truthful value to backfill them with,
and inventing one (`created_at`, or `NOW()`) would make stale plans look fresh. If those
plans need to be reachable, the rule needs a fallback on your side — not the API.

**2. Zero inactive plans were touched in the last 7 days on staging.** So the rule
currently surfaces nothing there. The endpoint is correct, but the feature will look inert
until someone toggles a plan off. Flagging it so nobody reports it as a bug.

Your own caveat about `updated_at` not being a deactivated-at holds, and the data makes it
concrete: a plan switched off months ago but renamed yesterday passes the recency test.
The exact fix is a `deactivated_at` column stamped on the true → false transition. You did
not request it; we did not build it. Say the word if you want it.

## Two decisions we made beyond the spec — please read

**1. Unknown `status` values return `422`, they are not ignored.**

```jsonc
{ "success": false, "message": "Validation failed",
  "messages": { "status": "status must be one of: true, false, all" } }
```

Silently falling back to active-only on a typo would reproduce the exact bug you
reported, only harder to spot. If you would rather have a lenient fallback, say so and
we will flip it — but you would then need to be careful about the spelling.

**2. The default lives in the controller, not the repository.** The repository's
`undefined` now honestly means "no filter". This matters only to backend callers; the
HTTP contract above is unaffected.

## Response shape

The ten original keys, unchanged in name, type and order — plus `updatedAt`:

```jsonc
{ "success": true, "data": [
  { "_id": "389", "name": "1 Month", "duration": 30, "price": 799, "materialPrice": 0,
    "withMaterial": false, "isDefault": true, "status": false, "courseId": null,
    "packageId": "5", "updatedAt": "2025-06-19T15:32:14.000+05:30" }
] }
```

`status` per row was always mapped faithfully from
`ws_package_course_ebook_price.status` — it simply could never be `false` before, because
those rows were filtered out server-side. Your Plan Status column will now render
correctly for Package and Course.

`orderBy: duration ASC` kept as requested, across the whole set — active and inactive are
interleaved by duration, **not** segregated into two blocks. Tell us if you want them
grouped by status instead. No pagination on this endpoint; it returns every matching row.

## Verified

Live HTTP against staging, package 5 (5 active / 12 inactive plans):

| Request | Result |
|---|---|
| `?packageId=5` | 5 rows, all active — **unchanged default** |
| `?packageId=5&status=true` | 5 rows |
| `?packageId=5&status=false` | 12 rows, all inactive |
| `?packageId=5&status=all` | 17 rows, 5 active + 12 inactive |
| `?packageId=5&status=bogus` | `422` |
| `?courseId=11` / `&status=all` | 3 rows / 4 rows |
| no id at all | `400 Provide courseId or packageId.` |

---

## Your `materialPrice` data question — checked, not a gap

You asked for a spot-check before anyone debugs the endpoint. On staging:

| | Count |
|---|---|
| Plans with `with_material = 1` | 217 |
| … `material_price` **NULL** | **0** |
| … `material_price = 0` | 1 |
| … `material_price > 0` | 216 |
| `with_material = 0` but `material_price > 0` | 1 |

216 of 217 carry a real material price, so the null→`0` coalesce is not masking a
data-entry problem. Both outliers are junk rows and neither is reachable from the picker:

- **id 923** (`3 Months`, `with_material=1`, `material_price=0`) — `package_id`,
  `course_id` and `ebook_id` are all `0`, so it is attached to no product, and it is
  inactive.
- **id 1459** (`Mechelle Berger`, `with_material=0`, `material_price=832`) — a
  faker-named seed row on course 990117.

⚠ **This is staging data.** Someone with prod access should re-run the same two counts
before treating the question as closed.

---

## Noted, not actioned

Your frontend-side `limit: 500` fix for `GET /admin/test-series/:id/prices` and
`GET /admin/ebooks/:id/plans` is a workaround for those endpoints defaulting to
`limit: 10` with no "give me all" option. That is a real backend wart. Not changed here
because it was outside this request — open a handoff if you want it fixed server-side.
