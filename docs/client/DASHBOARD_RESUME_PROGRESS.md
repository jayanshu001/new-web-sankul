# Dashboard Resume — Progress Semantics

**Endpoints:** `GET /api/v1/client/dashboard/resume` and
`GET /api/v1/client/learning/progress/my` · Bearer required.
**Last updated:** 2026-07-01

Drives the Home **My Courses/Subject** cards (`recentCourse`, `recentPackage`) + the
**Resume Learning** banner (`resumeLecture`), and the **Progress screen** feed.

## What changed

`percentCompleted` on `recentCourse`, `recentPackage`, and `resumeLecture` is now
**video-centric** — it reflects how far through the **current / last-watched lecture** the
user is, not overall course/package completion:

```
percentCompleted = round(resume.positionSec / resume.durationSec * 100)   // 0 when durationSec is 0/missing
```

Before, it was course-wide (`completedLectures / totalLectures`), so a user halfway through
one long lecture in a 50-lecture course saw ~2%. Now that same card shows ~50%.

## Field semantics

| Field | Meaning now |
|---|---|
| `percentCompleted` | **Current video** watch % (`positionSec / durationSec`), 0–100. Drives the progress bar. |
| `minutesLeft` | `floor((durationSec - positionSec) / 60)` for the current video. |
| `resume.positionSec` / `resume.durationSec` | Last-watched lecture position + duration (unchanged; also used for player resume). |
| `resume.videoId` / `resume.liveSessionId` | The lecture to resume (unchanged). |
| `completedLectures` / `totalLectures` | Course/package-wide counts — **preserved** for analytics / the Progress screen. **Not** what drives `percentCompleted` here anymore. |

A video is considered complete at **≥ 95%** watched (matches the rest of the app), so a
finished lecture reads 95–100 until the user starts a different one.

## Where this applies

Both endpoints now use the same **video-centric** `percentCompleted`:

- `GET /client/dashboard/resume` — the Home `recentCourse` / `recentPackage` / `resumeLecture` cards.
- `GET /client/learning/progress/my` — the Progress screen feed (`cards[]` and `resumeNext`).

Response shapes are **identical** (same fields); only the **value** of `percentCompleted`
changed. `completedLectures` / `totalLectures` are still the container-wide counts on both.
No client code change is required to consume it.

## Client mapping (reference)

```typescript
const percent = Math.max(0, Math.min(100, card.percentCompleted ?? 0)); // progress bar
// card.resume.videoId + card.resume.positionSec → open player at last position
```
