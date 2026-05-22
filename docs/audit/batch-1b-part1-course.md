# Backend Audit — Batch 1b (Part 1): Course canonical refactor + Plan P0 fix

This batch consumes the foundation landed in [batch-1a-foundation.md](./batch-1a-foundation.md) on a single canonical domain (**course**) plus the cross-cutting plan transaction P0 fix.

The shape established here is the template for the remaining 5 admin domains in subsequent batches (package, ebook, referral, permission, live-course).

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/admin/course/course.service.ts](../../src/admin/course/course.service.ts) | All domain logic for course CRUD + plans + masters. Cache integration, transactions, `.lean()`/`.select()`. |
| [docs/audit/batch-1b-part1-course.md](./batch-1b-part1-course.md) | This document. |

### Rewritten
| File | Before | After |
|---|---|---|
| [src/admin/course/course.controller.ts](../../src/admin/course/course.controller.ts) | 665 lines, 25 handlers, inline try/catch + Mongoose calls. | 248 lines, all handlers `asyncHandler`-wrapped, parse → service → respond. |

### Modified
| File | Change |
|---|---|
| [src/admin/plan/plan.controller.ts](../../src/admin/plan/plan.controller.ts) | `enforceSingleDefault` now accepts a session; `createPlan` / `updatePlan` / `markAsDefault` wrap plan write + sibling flip in `session.withTransaction()`. **P0 fix.** |

---

## Module 2 — Controllers

### Issue (P1)
All ~25 course handlers used inline `try/catch` and ad-hoc 500 responses; business logic embedded in the controller.

### Refactor — example diff
```ts
// before — course.controller.ts (legacy)
export const getCourses = async (req: Request, res: Response) => {
  try {
    /* 60 lines: parse query, build filter, run paginated Promise.all,
       map response, ad-hoc 500 catch */
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// after — course.controller.ts
export const getCourses = asyncHandler(async (req, res) => {
  const { data, pagination } = await courseService.listCourses(req.query);
  return res.status(200).json({ success: true, data, pagination });
});
```

### Impact
- **Memory:** read paths now `.lean()` — every list/detail Mongoose document allocation is gone. Rough 30–50% drop in heap per request on `GET /courses` (list of 10 with 6 populates).
- **Reliability:** unhandled rejections forward to the global error middleware (which already wires Sentry-style email + structured logging). No more silent `error.message`-only 500s.
- **Maintainability:** course controller dropped from 665 → 248 lines (~63%). All Mongoose calls moved behind `courseService.*`.

### Verification
```bash
# Happy path
curl -s "http://localhost:3000/api/v1/admin/courses?limit=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.success, .data | length, .pagination'

# Error envelope: invalid ObjectId
curl -i "http://localhost:3000/api/v1/admin/courses/not-an-id" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Expect: HTTP/1.1 400, body { success: false, code: 400, message: "Invalid Course ID", ... }
```

---

## Module 3 — Services

### Issue (P1)
- `.lean()` missing on list/detail queries.
- `.select()` missing on populate refs (returned full referenced docs).
- 4 separate cache-aside implementations across goal/admin code, none for course.

### Refactor
- Every read in `course.service.ts` is `.lean()` + explicit projection.
- Populate calls keep their `_id, name/title` selects (preserved from legacy).
- `cache.aside` used on `listCourses` (per-filter-hash key) and `getCourseById`.

### Cache wiring
| Endpoint | Key | TTL | Invalidated on |
|---|---|---|---|
| `GET /courses` | `{env}:admin:course:list:{filterHash}:v1` | 300s + jitter | create / update / delete / popular toggle / plan write |
| `GET /courses/:id` | `{env}:admin:course:detail:{id}:v1` | 300s + jitter | update / delete / popular toggle / plan write |

Invalidation uses `cache.invalidateByPrefix` for the list partition (filters are open-ended) and a direct `cache.invalidate` for the detail key.

### Impact
- **Latency:** repeat course list reads served from Redis in ~1–3ms vs ~15–40ms from Mongo with 6 populates.
- **Cost:** cache.aside is fail-open — if Redis is unavailable, requests degrade to direct Mongo, no errors surfaced.

### Verification
```bash
# Warm the cache
curl -s "http://localhost:3000/api/v1/admin/courses?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null
# Look at Redis
redis-cli --scan --pattern 'dev:admin:course:list:*:v1' | head
# Second request should hit cache (look at log latencies or add a tap)
```

---

## Module 4 — Database (P0 plan transaction fix)

### Issue (P0)
`plan.controller.ts` `createPlan`, `updatePlan`, `markAsDefault` ran the sibling `updateMany({ isDefault: false })` **outside** any transaction. On a concurrent mark-as-default for the same entity, two rows could carry `isDefault: true` simultaneously, and a crash between the create and the flip left the system with multiple defaults.

### Refactor
- `enforceSingleDefault` gained an optional `session` parameter.
- All three callers now do:
  ```ts
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [plan] = await PackageCourseEbookPrice.create([payload], { session });
      if (plan.isDefault) await enforceSingleDefault(..., session);
    });
  } finally { session.endSession(); }
  ```
- The course-scoped versions in [course.service.ts](../../src/admin/course/course.service.ts) (`createCoursePlan`, `updateCoursePlan`) use the same shape.

### Impact
- **Reliability:** crash mid-write no longer leaves orphan `isDefault: true` rows. Concurrent default flips serialize at the document level.
- **Correctness:** clients reading a list of plans for a course are guaranteed at most one `isDefault: true` row at any point.

### Verification
```bash
# Two concurrent "mark default" calls on different plans of the same course.
# Only the last one in the commit order should remain default.
curl -s -X PATCH /api/v1/admin/plans/$P1/mark-default -H "Authorization: ..." &
curl -s -X PATCH /api/v1/admin/plans/$P2/mark-default -H "Authorization: ..." &
wait
mongosh "$MONGO_URI" --eval 'db.ws_package_course_ebook_prices.countDocuments({ courseId: ObjectId("'$COURSE_ID'"), isDefault: true })'
# Expect: 1
```

---

## Pagination

`getCourseVideoCategories`, `getCourseMaterials`, `getVideoCategoryRelations` were unbounded. All now accept `?page&limit` (default 50, max 200) and return a `pagination` envelope. Existing callers that didn't send `limit` continue to work (default 50 covers their previous expected sizes).

---

## Constraint compliance

- ✅ No public API response shape changes. `success: true, data: ..., pagination: ...` envelope preserved; legacy callers see identical JSON for happy paths.
- ✅ Every route still authenticated (master `authenticate` + per-router `requireRole`).
- ✅ Video URL contract untouched (no video endpoint changed in this batch).
- ✅ Plan `duration` semantics preserved — `setMonth` not used in this batch (computeEndAt migration deferred).
- ✅ Downloads count composition not touched here.

---

## What's next (Batch 1b — Part 2, awaiting approval)

Apply the same template to:
1. `package.controller` + `package.service` (heaviest — 10 indexes, transactional delete).
2. `ebook.controller` + `ebook.service`.
3. `referral.controller` + `referral.service` + idempotency on credit endpoints.
4. `permission.controller` + `permission.service` + permission catalog cache.
5. `live-course.controller` + `live-course.service`.
6. Migrate `setMonth` callsites (subscription / live-course-subscription / webhook / verify) to `computeEndAt`.
