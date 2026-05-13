# Resume Learning — My Courses screen (Client)

Drives the **My Courses / Subject** screen: a list of in-progress course cards with `XX Days Left`, a progress bar, and one big "Resume Now" hero card pointing at the most recently watched lecture across all the user's courses.

This feature is two endpoints, not one. **You cannot build a Resume screen without first tracking what was watched.** The codebase had no playback-progress tracking at all before this — so this PR introduces:

1. A new **model** to track per-lecture playback state.
2. A **POST progress** endpoint the mobile player calls as a heartbeat while playing.
3. A **GET listing** endpoint the screen renders.

The two endpoints are coupled: the listing is empty until the heartbeat starts writing rows. **Wiring up the heartbeat in the mobile player is mandatory** for this screen to ever show data.

---

## When does a course first appear on this screen?

It appears the **first time the app posts a progress heartbeat for any lecture in that course**. Not at subscription time, not at first course-detail view — only when the user actually starts watching.

This matches the design (the user has many enrolled courses; only the 3 they've actually opened show up). It also means we don't need a separate "start course" endpoint — the heartbeat *is* the start signal.

If the user subscribes to a course but never watches anything, that course is invisible to this screen by design. It's still discoverable via the regular catalog endpoints; it just doesn't pollute the Resume screen.

---

## Data model

### `LectureProgress` (new) — `src/models/customer/LectureProgress.model.ts`

One row per `(customer, video)` pair. Collection: `ws_lecture_progress`.

| Field           | Type        | Notes                                                                                                      |
|-----------------|-------------|------------------------------------------------------------------------------------------------------------|
| `customerId`    | ObjectId    | Owner.                                                                                                     |
| `videoId`       | ObjectId    | The lecture (`Video`).                                                                                     |
| `courseId`      | ObjectId    | **Denormalised** from `VideoCategory.courseId` for fast per-course rollups. Set by the heartbeat. |
| `positionSec`   | number      | Last reported playback position.                                                                           |
| `durationSec`   | number      | Total length, as the player saw it. (We don't have a `duration` field on `Video`, so the app tells us.)    |
| `completed`     | boolean     | Sticky once true. Set when `positionSec / durationSec >= 0.95`.                                            |
| `completedAt`   | Date \| null | When it first flipped to completed.                                                                        |
| `lastWatchedAt` | Date        | Drives the `Last Watched 2 days ago` label and the per-course sort order on the Resume screen.             |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps.                                                                                       |

**Indexes**
- `{ customerId, videoId }` *unique* — heartbeat upsert needs it.
- `{ customerId, courseId, lastWatchedAt: -1 }` — `My Courses` listing's primary sort.
- `{ customerId, courseId, completed }` — counting completed lectures per course for the % bar.

### Why `courseId` is denormalised

Going from `videoId → VideoCategory → courseId` on every read for the listing endpoint would add a `$lookup` to every aggregation. Stamping `courseId` onto the progress row at heartbeat time makes the listing's grouping a one-step `$group` by `courseId`. The cost is a tiny extra read on the heartbeat path (resolve `Video → VideoCategory → courseId` once), which we have to do anyway to enforce the access-gate.

---

## 1) Heartbeat — `POST /api/v1/client/courses/lectures/:videoId/progress`

Called by the mobile player **periodically while the user is watching**. Recommended cadence:

- Every ~15 seconds during active playback.
- On `pause`.
- On `seek` (after the seek lands).
- On `exit` / app-background.

Each call is a full upsert of the `(customer, video)` row, so out-of-order or duplicate calls are safe — last-write-wins on `positionSec`/`durationSec`/`lastWatchedAt`. `completed` is sticky and never goes back to false.

### Auth

Required (`Authorization: Bearer <customerAccessToken>`). Customer role is enforced at the router level (`authenticate` + `requireRole("customer")`).

### Path params

| name      | type   | notes                            |
|-----------|--------|----------------------------------|
| `videoId` | string | `Video._id` of the lecture being watched. |

### Request body

```json
{ "positionSec": 1840, "durationSec": 3600 }
```

| field         | type   | required | range                    |
|---------------|--------|----------|--------------------------|
| `positionSec` | number | yes      | integer, 0 – 86400 (24h) |
| `durationSec` | number | yes      | integer, 0 – 86400 (24h) |

### Successful response (`200`)

The full `LectureProgress` row is returned so the player can sync any server-side updates (e.g. `completed: true` flipping on this heartbeat).

### Error responses

| Status | When                                                                                                |
|--------|-----------------------------------------------------------------------------------------------------|
| `400`  | Body validation failure (`positionSec` / `durationSec` out of range), or the lecture isn't attached to any course (data integrity issue). |
| `401`  | Missing / invalid bearer token.                                                                     |
| `403`  | The customer has no active, payment-verified, non-expired subscription to this course. Same predicate the lecture-fetch endpoint uses, so behaviour can't drift between play and progress. |
| `404`  | Lecture doesn't exist or `status: false`.                                                           |

### Behaviour notes

- **Completion threshold is 95%.** A user who skips the last 30 seconds of a lecture should still get the bar to fill. Configurable in code (`COMPLETION_THRESHOLD = 0.95`) — bump down to 0.90 if support tickets come in about students not getting credit on long videos.
- **`completed` is sticky.** Once true it stays true even if a later heartbeat reports a small `positionSec` (the user re-watched the start). That's intentional — you don't lose credit for re-watching.
- **No client-supplied "start" or "end" calls.** The first heartbeat upserts (creates the row); there's no separate session lifecycle. If the app crashes mid-playback, worst case the user loses ~15 seconds of progress — fine for the UX this is supporting.
- **Access gate matches the lecture fetch endpoint** exactly: `status: true && paymentStatus: "verified" && endAt > now`. We deliberately re-check it here because a user whose subscription expired during a session shouldn't be able to keep accruing progress. Same predicate also keeps subscribed-but-unpaid (pending) rows out — see `PAYMENT_CREATE_ORDER_CLIENT.md` for why pending exists.

---

## 2) Listing — `GET /api/v1/client/courses/my`

Drives the entire screen in one round-trip.

### Auth

Required.

### Successful response (`200`)

```json
{
  "success": true,
  "data": {
    "courses": [
      {
        "course": { "_id": "...", "name": "Gujarat Geography", "thumbnail": "...", "image": "...", "author": "Abhijitsinh Zala" },
        "daysLeft": 9,
        "percentCompleted": 18,
        "completedLectures": 4,
        "totalLectures": 22,
        "lastWatchedAt": "2026-05-06T11:42:00.000Z",
        "lastVideoId": "..."
      }
    ],
    "resumeNext": {
      "course":   { "_id": "...", "name": "UPSC - Indian Politics", "thumbnail": "..." },
      "lecture":  { "_id": "...", "title": "Chapter 5", "topic": "Fundamental Rights" },
      "lastWatchedAt": "2026-05-06T11:42:00.000Z",
      "positionSec": 1872,
      "durationSec": 3600,
      "remainingSec": 1728,
      "percent": 78
    }
  }
}
```

### Field-to-screen mapping

| UI element                                      | API field                                          |
|-------------------------------------------------|----------------------------------------------------|
| Card image                                      | `course.thumbnail` / `course.image`                |
| Card title (`Gujarat Geography`)                | `course.name`                                      |
| Subtitle (`By Abhijitsinh Zala`)                | `course.author`                                    |
| Top-right (`9 Days Left`)                       | `daysLeft`                                         |
| Card progress bar fill                          | `percentCompleted`                                 |
| (Optional) `4 / 22 lectures` hint               | `completedLectures` / `totalLectures`              |
| **Resume Now hero card — title**                | `resumeNext.course.name` + `resumeNext.lecture.title` |
| `Last Watched 2 days Ago`                       | computed from `resumeNext.lastWatchedAt`           |
| `78% Completed`                                 | `resumeNext.percent`                               |
| `50 min left`                                   | computed from `resumeNext.remainingSec`            |
| Big progress bar fill                           | `resumeNext.percent`                               |

### What's *not* in the response (and why)

- **"Next Class Tomorrow 05:00 PM"** — that's live-class scheduling, a separate feature. The Resume API has nothing to say about it.
- **Untouched courses.** Subscribed but never watched → they don't appear here. The catalog (`GET /courses`) is for browsing; this endpoint is for resuming.
- **Pagination.** Capped server-side at 20 most-recent courses. If a user has more than 20 in-progress courses simultaneously, we'll deal with it then. Until that's a real complaint, a hard cap is simpler than offset/cursor pagination.

### Behaviour notes

- **`daysLeft` is `null` if the subscription has expired or doesn't exist.** A course can be on this screen *with an expired subscription* if the user finished watching everything before expiry — the progress rows survive expiry. The app should hide the "Days Left" pill (or show "Expired") when `daysLeft === null`.
- **Course percent bar uses the count of `completed` rows / total active lectures in the course.** Watching a lecture to 80% does not contribute partial credit to the *course* bar (only the lecture bar in `resumeNext`). This is the simplest definition that's hard to game.
- **`resumeNext` is `null`** when the user has no progress rows at all (first-time install, or never watched anything). The hero card should be hidden in that state.
- **A deleted/disabled course is filtered out** of `courses` even if progress rows exist — we look up the Course with `status: true`. Stale progress rows for disabled courses are harmless and can be GC'd later if needed.

---

## End-to-end flow (mobile)

1. User taps a lecture → app calls `GET /courses/lecture` (existing endpoint) to get the playable URL.
2. Player starts. App schedules a 15-second timer to call **`POST /courses/lectures/:videoId/progress`** with the current `positionSec` + `durationSec` from the player.
3. Same call also fires on `pause`, `seek-end`, `exit`, and `app-background`.
4. User goes back to the home screen. The "My Courses / Subject" tab calls **`GET /courses/my`** → renders the cards + `resumeNext` hero.
5. User taps `Resume Now` → app uses `resumeNext.lecture._id` + `resumeNext.positionSec` to open the player at the right offset.

The first heartbeat in step 2 is what *creates* the progress row, which is what makes the course start showing on the screen in step 4. There is no separate "enroll" or "start" call.

---

## What's next (not in this PR)

- **Per-lecture progress endpoint** if the course-detail screen ever needs to show per-lecture % marks (`GET /courses/:id/progress` returning a flat list of `{ videoId, completed, positionSec }`). Trivial on top of this model.
- **Server-side aggregation cache** if the listing endpoint becomes hot — currently it does ~3 lookups per call, which is fine for the kind of traffic a "My Courses" tab generates.
- **Garbage-collect orphaned progress rows** for disabled/deleted videos on a schedule. Not urgent — they're invisible on read.
- **Live-class metadata** ("Next Class Tomorrow 05:00 PM") — separate feature; will likely live on a `LiveClass` model and join into this response when ready.
