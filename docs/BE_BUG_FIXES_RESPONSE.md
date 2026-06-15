# BE Response — Video Playback Bug Fixes

**Verdict: all three are confirmed BACKEND bugs. All three are now fixed on the BE.
No frontend changes are required** — your existing request shapes are correct and
unchanged. Deploy the BE and the errors stop.

> Diagnosed against the actual code + live DB, not assumptions. Notes on each below.

---

## Bug 1 — Lecture Note: "This lecture is not attached to a course"

**Confirmed BE bug.** `POST /client/lecture-notes` resolved the video's owning course
and **rejected the note with 400 if no course resolved**. But:
- `LectureNote.courseId` is optional metadata, not required.
- A video reached via a **package** or the **free catalog** legitimately resolves to no
  single course.

So accessible videos were being blocked from note creation.

**Fix (BE):** course is now best-effort metadata, not a gate.
- **Free video** → note saved (with the course if we can resolve one, else `courseId: null`).
- **Paid video, course resolves** → still requires an active subscription to that course
  (unchanged — security preserved).
- **Paid video, no course resolves** → note saved scoped to `videoId` (`courseId: null`)
  instead of 400.

**FE impact:** none. Same request, same response. Notes now save where they used to fail.
`note.courseId` may be `null` in the response — treat it as optional.

> **Also fixed: `lecture-audio-notes` (same bug, separate module).** The audio-note
> controller (`POST` + `GET /client/lecture-audio-notes`) had its own copy of the same
> course gate, so recording AND **listing** audio notes 400'd "This lecture is not attached
> to a course." for free / package / current-affairs videos with no owning course (e.g.
> video `6a1ec311…`, a free "Lecture 01 January (2025)" with no course). Same fix applied:
> course is optional metadata; free videos and no-course paid videos are allowed.
> **FE impact:** none.

---

## Bug 2 — Save Video Progress: `containerId` not in schema  ⚠️ CRITICAL

**Confirmed BE bug — this broke EVERY paid course/package/liveCourse heartbeat.**

Root cause (verified in git): the `LectureProgress` model was reverted to
"one row per (customer, video)" (commit `bcfad2d`), but the progress controller was left
on the older "per-container" design — it upserted using `containerType` / `containerId`,
fields that no longer exist in the schema. With Mongoose `strict: true` + `upsert: true`,
that throws `Path "containerId" is not in schema`.

**Fix (BE):** the upsert now keys on `(customerId, videoId)` to match the model, and the
container you send in `scope` is recorded on the row (`courseId`/`packageId`/`liveCourseId`)
for the dashboard/Resume rollups. Watching the same video from multiple products keeps a
single shared progress row (consistent watched/completed everywhere), with each product's
pointer accumulated on it.

**FE impact:** none. Keep sending exactly what you already send:
```json
POST /client/courses/lectures/:videoId/progress
{ "positionSec": 142, "durationSec": 3600, "scope": { "kind": "course", "id": "<id>" } }
```
`scope.kind` ∈ `course | package | liveCourse`; `scope.id` = the product the video was
opened from. This is required and correct as-is.

---

## Bug 3 — Save Video Progress: "Video is not part of the scoped package"

**Confirmed BE bug (for free content).** The scope **reachability** check ("is this video
inside the scoped package/course/liveCourse?") ran for every video, including free ones.
Free package/course content is often surfaced through the free catalog rather than the
package's `specificSubjects` / relation tree, so the linkage check failed and returned 400
even though the user has legitimate access.

**Fix (BE):** a **free video** (`priceType === "free"`) now bypasses the strict
reachability check (we still confirm the scoped container exists). Applied to all three
scopes (`course`, `package`, `liveCourse`) so the same false-400 can't appear from any
route. **Paid videos are unchanged** — they must still be reachable under the scoped
container.

> We chose "exempt the free *video*" over the doc's "exempt the free *package*": it's
> tighter (a free package whose videos genuinely aren't in it can't have unrelated
> progress filed against it) and matches how the standalone free-videos endpoint already
> behaves.

**FE impact:** none. Keep using `POST /client/courses/lectures/:videoId/progress` with
`scope` for free package/course videos — it now succeeds. (You do **not** need to switch
to `/client/free-videos/:videoId/progress`; that endpoint still exists for standalone
free videos, but the scoped endpoint now handles free-in-container correctly.)

---

## Summary

| # | Endpoint | Was it our bug? | Fix | FE change needed? |
|---|----------|-----------------|-----|-------------------|
| 1 | `POST /client/lecture-notes` | ✅ Yes | Course is optional metadata; don't 400 when unresolved | **No** |
| 2 | `POST /client/courses/lectures/:id/progress` | ✅ Yes (critical) | Upsert on `(customer, video)` to match model; drop `containerId`/`containerType` | **No** |
| 3 | `POST /client/courses/lectures/:id/progress` | ✅ Yes (free content) | Free video bypasses scope reachability check | **No** |

**Deployment note:** these are code-only fixes (no FE change, no required data migration).
Separately, the production `ws_lecture_progress` collection still has orphaned indexes from
the old per-container design (partial indexes on a defunct `scopeKind` field) — harmless to
runtime, but BE should drop them in a follow-up cleanup. They do **not** block this fix.
