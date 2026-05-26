# Dashboard Resume — Per-Scope Cards (Client Guide)

Companion to:
- [`home-resume-sections.md`](./home-resume-sections.md) — base contract for
  `GET /api/v1/client/dashboard/resume`
- [`resume-sections-frontend-fixes.md`](./resume-sections-frontend-fixes.md)
  — heartbeat `scope` payload (mandatory prerequisite)

Audience: mobile app team.
Goal: one card per category — Live Course, Package, Course — each
showing the **most recent thing the user watched while inside that
container**.

---

## TL;DR

- `GET /api/v1/client/dashboard/resume` returns exactly **one** of each:
  `resumeLecture` (live), `recentPackage`, `recentCourse`.
- Each card is the user's most recent activity that points at that
  container kind (live course / course / package).
- The endpoint is **filter-compatible with `progress/my`** — if a row
  shows up under My Learning, it will also drive the matching dashboard
  card. No "data shows in one but not the other" gaps.
- **No new API.** No payload changes for this endpoint.
- Render any card you receive; if a card is `null`, hide that slot.

## Read semantics

`dashboard/resume` filters rows by the **parent pointer** (`liveCourseId`
/ `courseId` / `packageId`) — not by `scopeKind`. This means:

- Legacy rows written before the per-scope split still drive cards.
- Rows written by older app builds that don't send `scope` still drive
  cards.
- Rows written by new app builds (with `scope`) also drive cards.

The per-scope rows the new heartbeat writes are still useful: they let
the **same video** under two containers produce two independent rows
(different positions, different completion), so each card resumes from
the right place. But the reads themselves don't require `scopeKind` to
be set — they accept any row with the right parent pointer.

---

## 1. Request

```
GET /api/v1/client/dashboard/resume
Authorization: Bearer <accessToken>
```

No query params. No body. Customer role required.

---

## 2. Response shape (unchanged from before — just stricter semantics)

```jsonc
{
  "resumeLecture": ResumeCard | null,   // scopeKind = "liveCourse"
  "recentPackage": ResumeCard | null,   // scopeKind = "package"
  "recentCourse":  ResumeCard | null    // scopeKind = "course"
}
```

Each `ResumeCard`:

```jsonc
{
  "type": "live" | "course" | "package",
  "id": "<container id>",
  "liveCourseId": "..." | null,
  "courseId":     "..." | null,
  "packageId":    "..." | null,

  "title": "Gujarat Geography",
  "subtitle": "By Abhijitsinh Zala" | null,
  "educator": { "id", "name", "image" } | null,
  "thumbnail": "https://.../image.jpg" | null,

  "daysLeft":          9 | null,
  "subscriptionEndAt": "2026-08-30T..." | null,

  "percentCompleted":  78,    // resumeLecture & recentCourse: % of CURRENT lecture (positionSec/durationSec)
                              // recentPackage: % of package (completed lectures / total lectures)
  "minutesLeft":       8,     // (durationSec - positionSec) / 60, floored — for the current lecture
  "completedLectures": 12,    // course-wide rollup (always)
  "totalLectures":     16,    // course-wide rollup (always)
  "lastWatchedAt":     "2026-05-23T10:14:00Z",

  "lecture": {
    "_id": "...",
    "title": "Chapter 5 — Indian Politics",
    "topic": "..." | null,
    "videoCategoryId": "..." | null,
    "chapterTitle": "..." | null
  } | null,

  "resume": {
    "videoId":       "..." | null,
    "liveSessionId": "..." | null,
    "positionSec": 1850,
    "durationSec": 2400
  }
}
```

---

## 3. Per-card behavior

### 3.1 `resumeLecture` — purple "Resume Learning" (Live Course)

- Driven by the user's most recent **live-course-scoped** heartbeat
  (i.e. a heartbeat the player sent with `scope: { kind: "liveCourse", id }`).
- Lights up only after the live player starts writing heartbeats with
  scope — until then, expect `null`. (This is the gap the fixes doc
  closes.)
- Render fields:
  - Lecture title → `lecture.title`
  - "X% Completed" → `percentCompleted`
  - "X min left" → `(durationSec - positionSec) / 60`, floored. Hide
    when `durationSec === 0`.
  - "Last Watched … ago" → relative time of `lastWatchedAt`.
  - "Resume Now" → see §5 (tap handling).

### 3.2 `recentCourse` — My Courses/Subject (Recorded Course)

- Driven by the user's most recent **course-scoped** heartbeat
  (`scope: { kind: "course", id: <courseId> }`).
- A user who watches the same video inside a Package will NOT
  contribute to this card from that watch — that goes to
  `recentPackage` instead. This is the whole point of scoping.
- Render fields: same as 3.1, but the CTA is "Resume Learning".

### 3.3 `recentPackage` — My Courses/Subject (Package)

- Driven by the user's most recent **package-scoped** heartbeat
  (`scope: { kind: "package", id: <packageId> }`).
- Title is the **package name**, subtitle is the lecture title (if any),
  thumbnail is the package image, `daysLeft` is the package
  subscription's days remaining.
- "Next Class Tomorrow 05:00 PM" overlay (if you render it) still
  comes from your existing live-schedule source — not from this endpoint.

---

## 4. The cross-container case (worked example)

User journey:

1. Opens **Course A** (direct course sub) → watches Video X to 40%.
2. Later opens **Package P** (which also contains Course A) → opens
   Video X again from the Package context → watches to 70%.

**Player must send:**

- Step 1 heartbeats:
  `POST /courses/lectures/X/progress` with
  `{ positionSec, durationSec, scope: { kind: "course", id: "<A>" } }`

- Step 2 heartbeats:
  `POST /courses/lectures/X/progress` with
  `{ positionSec, durationSec, scope: { kind: "package", id: "<P>" } }`

**After step 2, `GET /dashboard/resume` returns:**

```jsonc
{
  "resumeLecture": null,
  "recentCourse": {
    "type": "course",
    "id": "<A>",
    "title": "Course A",
    "percentCompleted": 40,
    "lecture": { "title": "Video X", ... },
    "resume": { "videoId": "X", "positionSec": <40% mark>, ... }
  },
  "recentPackage": {
    "type": "package",
    "id": "<P>",
    "title": "Package P",
    "percentCompleted": 70,    // computed within the package scope
    "lecture": { "title": "Video X", ... },
    "resume": { "videoId": "X", "positionSec": <70% mark>, ... }
  }
}
```

Both cards point at the same video, but each card resumes at the
position the user watched **inside that container**. Tapping the
Course card resumes at 40%; tapping the Package card resumes at 70%.

If the player had sent the wrong scope (or no scope at all), the two
watches would have collapsed onto one row and overwritten each other.
The whole feature depends on the player sending the right `scope`.

---

## 5. Tap handling (unchanged — repeated here for completeness)

```ts
function openResumeCard(card: ResumeCard) {
  if (card.resume.liveSessionId) {
    return navigate("LiveSessionPlayer", {
      liveSessionId: card.resume.liveSessionId,
      liveCourseId:  card.liveCourseId ?? undefined,
      packageId:     card.packageId    ?? undefined,
      positionSec:   card.resume.positionSec,
    });
  }
  if (card.resume.videoId) {
    return navigate("VideoPlayer", {
      videoId:      card.resume.videoId,
      courseId:     card.courseId     ?? undefined,
      liveCourseId: card.liveCourseId ?? undefined,
      packageId:    card.packageId    ?? undefined,
      positionSec:  card.resume.positionSec,
    });
  }
  // Container exists but no lecture played yet — go to container landing.
  if (card.type === "package")  return navigate("PackageDetail",    { packageId:    card.packageId! });
  if (card.type === "live")     return navigate("LiveCourseDetail", { liveCourseId: card.liveCourseId! });
  return                              navigate("CourseDetail",      { courseId:     card.courseId!   });
}
```

**Important:** when the player resumes from a card, the NEXT heartbeat
it sends must use the SAME scope as the card.

- Tapped `recentCourse`?    → next heartbeat: `scope.kind = "course"`,    `id = card.courseId`.
- Tapped `recentPackage`?   → next heartbeat: `scope.kind = "package"`,   `id = card.packageId`.
- Tapped `resumeLecture`?   → next heartbeat: `scope.kind = "liveCourse"`,`id = card.liveCourseId`.

Treat the card's container as the user's active context until they
navigate away. Don't fall back to a generic "use whichever id is
non-null" — that re-introduces the collapse bug.

---

## 6. Refresh policy

- Fetch once on home-screen **mount**.
- Re-fetch on screen **focus** (returning from any player).
- Do not poll on a timer — data only changes when the user watches
  something, and the player flushes on pause / back / unmount.

```ts
useFocusEffect(useCallback(() => { fetchResumeDashboard(); }, []));
```

---

## 7. Empty states

| Scenario                                          | What to render                  |
|---------------------------------------------------|---------------------------------|
| All three `null`                                  | Hide the whole "Resume" block.  |
| Only `resumeLecture` is null                      | Hide the purple card; show the My Courses row. |
| Only one of `recentPackage` / `recentCourse` is null | Show the My Courses row with the one card you have. |
| User logged out                                   | Backend returns all three `null` — see above. |

Do not show placeholder cards. The marketing dashboard
(`GET /client/dashboard`) covers discovery for new users.

---

## 8. Verification matrix

After the scope fix lands end-to-end:

| User action                                              | Expected populated cards            |
|----------------------------------------------------------|-------------------------------------|
| Watches a recorded video via Course flow                 | `recentCourse`                      |
| Watches the same video via Package flow                  | `recentPackage` (separate from above) |
| Watches a live session via Live Course flow              | `resumeLecture`                     |
| Watches a live session via Package flow                  | `recentPackage` (live-session row)  |
| Brand-new user with no plays                             | all three `null`                    |
| Sends heartbeat without `scope` (legacy build)           | row is written as legacy; will NOT appear in any card |

The last row is the only failure mode. If a card is unexpectedly
`null`, check the heartbeat payload first — 9 times out of 10 the
`scope` field is missing or has the wrong `kind`.

---

## 9. Quick reference — field → UI

| UI element                          | Field                                         |
|-------------------------------------|-----------------------------------------------|
| Purple big title                    | `resumeLecture.lecture.title`                 |
| Purple "X% Completed"               | `resumeLecture.percentCompleted`              |
| Purple "X min left"                 | `minutesLeft`                                 |
| Purple "Last Watched … ago"         | relative-time of `resumeLecture.lastWatchedAt`|
| Course/Package card title           | `card.title`                                  |
| Course/Package card thumbnail       | `card.thumbnail`                              |
| "X Days Left" chip                  | `card.daysLeft` (hide when `null`)            |
| Progress bar                        | `card.percentCompleted`                       |
| "Resume Now" tap                    | `openResumeCard(card)`                        |
