# Response — Exam Category "Courses" tab lists recorded Courses only

**Re:** `2026-08-20-exam-category-courses-tab-union.md`
**Date:** 2026-08-20
**Status:** ✅ Implemented. No DDL, no backfill. Backend ships alone.
**Action required from the frontend:** none — your fallback already handles it.

---

## What shipped

`GET /api/v1/admin/quizzes/categories/:id/courses` now returns the **union** of recorded
Courses and Live Courses, each row tagged with `type`. A category holding only live
courses reported `total: 0` before; it now returns them.

| `type` | Link |
|---|---|
| `course` | `ws_exam_category_course` (`course_id` ↔ `exam_category_id`) |
| `live-course` | `ws_live_course.exam_categories` JSON, via `JSON_TABLE` |

Built exactly on the `buildLinkedProductsQuery` precedent you pointed at, paged in SQL,
`search`/`status` applied per branch. **Packages stay out**, as you specified — the
Package tab covers them.

```
GET /api/v1/admin/quizzes/categories/:id/courses
  ?search=&status=true|false&type=course|live-course&page=1&per_page=20
```

```jsonc
{ "success": true, "data": {
  "items": [
    { "id": "4",      "name": "Live Course 4",     "type": "live-course", "status": true,  "orderBy": 0 },
    { "id": "990115", "name": "UPSC Prelims 2026", "type": "course",      "status": false, "orderBy": 1 }
  ],
  "meta": { "page": 1, "per_page": 20, "total": 2, "totalPages": 1 }
} }
```

- `type` is on **every** row, `"course" | "live-course"` — the hyphenated spelling you
  asked for.
- `id` is the id within that kind's own table, not namespaced. Keep keying by `type-id`.
- `orderBy` is `ws_course.order_by` / `ws_live_course.ordered` — the row's own column, as
  your first option specified. **Not** the per-category `order` inside the
  `exam_categories` JSON entry.
- `status` is the row's own published flag.

**Ordering:** `orderBy` asc → `created_at` desc → `id` asc, spanning both kinds (not
type-major). The first two were the existing contract; `id` is a new final tiebreak that
makes ordering total, so no row can appear on two pages.

## The `type` query param — built, and it is tolerant on input

You listed it as a nice-to-have. It is implemented.

⚠ **The two sibling endpoints disagree on spelling**, which is a footgun worth knowing:

| Endpoint | Emits |
|---|---|
| `/admin/quizzes/categories/:id/courses` (this one) | `live-course` |
| `/admin/video-categories/:id/courses` | `live_course` |
| `/admin/materials/categories/:id/products` | `live-course` |

Because of that, `?type=` **here accepts `live-course`, `live_course` and `liveCourse`**,
all meaning the same thing. Only a genuine typo gets a `422`:

```jsonc
{ "success": false, "message": "Validation failed",
  "messages": { "type": "type must be one of: course, live-course" } }
```

Worth unifying the emitted spelling across all three endpoints in one pass later. Not
done here because it would break the video-category tab's current contract — tell us if
you want that scheduled.

## Verified

Live HTTP against staging:

| Case | Before | After |
|---|---|---|
| Category 149 (live-only) — **the reported bug** | `total: 0` | `total: 1` |
| Category 138 (course-only) — regression | `total: 2` | `total: 2`, unchanged |
| Category 65 (both kinds) | `total: 1` | `total: 2` |
| `?per_page=1` pages 1 and 2 | — | disjoint rows, honest `total` |
| `?type=` course / live-course / live_course / bogus | — | 1 / 1 / 1 row, then `422` |
| `?status=`, multi-word + Gujarati `?search=` | — | filters per branch, no collation error |

## Notes

- Nothing to remove on your side. The tab's `course` fallback meant it worked before this
  landed and keeps working now.
- This route is **not** response-cached, so a newly-linked live course appears on the next
  request with no flush.
- Status toggles stay per kind: `PUT /admin/courses/:id`, `PUT /admin/live-courses/:id`.

## Noticed, not changed

`admin-material.repository.ts` `buildLinkedProductsQuery` — the helper you cited — joins
`JSON_TABLE` without `DISTINCT`. A live course listing the same category twice in its JSON
would emit duplicate rows there and skew `total`. We added `DISTINCT` on the new exam
branch; the material endpoint still has the gap. Separate contract, so left alone.

The video-category union from your "Noticed but not touched" section already appears
implemented in working-tree changes we did not author, so it was not duplicated here.
