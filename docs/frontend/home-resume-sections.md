# Home Screen — Resume Sections (3 modules)

This doc covers the data + integration flow for the three "Resume" surfaces on
the home screen:

1. **Purple card — "Resume Learning"** (most recent **Live Course** lecture)
2. **My Courses/Subject — recent Package card** (1 most-recent package)
3. **My Courses/Subject — recent Course card** (1 most-recent recorded course)

All three are served by a **single new endpoint**, so the home screen makes
one network round-trip.

---

## 0. What changed (per-scope split)

Each of the three cards is the user's most recent `LectureProgress`
row whose **parent pointer** matches the card's container kind:

- `resumeLecture` ← most recent row with `liveCourseId` set
- `recentCourse`  ← most recent row with `courseId` set
- `recentPackage` ← most recent row with `packageId` set

This matches `/learning/progress/my` exactly — if a row drives a card
under My Learning, it will drive the corresponding card here too.

Where the per-scope **write** split helps: the same video watched via a
Course and via a Package now produces two independent rows (different
positions, different completion). So `recentCourse` and `recentPackage`
can both populate with the same lecture but resume from different
positions. Without scoped writes, the two watches would have collapsed
onto one row and overwritten each other.

Pre-requisite for the cross-container case: the player must send
`scope` on every heartbeat — see `resume-sections-frontend-fixes.md`
§0. The reads themselves don't require it; legacy rows (no `scope`)
still drive cards just fine.

---

## 1. Endpoint

```
GET /api/v1/client/dashboard/resume
Authorization: Bearer <accessToken>      // required, customer role
```

No query params. The user is inferred from the token.

### Response shape

```jsonc
{
  "resumeLecture": ResumeCard | null,   // purple — live course lecture
  "recentPackage": ResumeCard | null,   // My Courses — package card
  "recentCourse":  ResumeCard | null    // My Courses — recorded course card
}
```

Any of the three may be `null` when the user has no activity in that scope
yet. Render the slot only when the value is non-null.

### `ResumeCard` (unified shape — same component renders all three)

```jsonc
{
  "type": "live" | "course" | "package",
  "id": "<container id>",                 // = liveCourseId / courseId / packageId
  "liveCourseId": "..." | null,
  "courseId":     "..." | null,
  "packageId":    "..." | null,

  "title":    "Gujarat Geography",        // container name
  "subtitle": "By Abhijitsinh Zala" | null,
  "educator": { "id", "name", "image" } | null,
  "thumbnail": "https://.../image.jpg" | null,

  "daysLeft":         9 | null,           // null = lifetime OR no subscription
  "subscriptionEndAt": "2026-08-30T..." | null,

  "percentCompleted":  78,                // 0..100
  "completedLectures": 12,
  "totalLectures":     16,
  "lastWatchedAt": "2026-05-23T10:14:00Z",

  "lecture": {                            // the actual lecture to resume
    "_id": "...",
    "title": "Chapter 5 — Indian Politics",
    "topic": "..." | null,
    "videoCategoryId": "..." | null,
    "chapterTitle": "..." | null
  } | null,

  "resume": {                             // tap target
    "videoId":       "..." | null,
    "liveSessionId": "..." | null,        // exactly one of videoId/liveSessionId is set
    "positionSec": 1850,
    "durationSec": 2400
  }
}
```

Notes:
- `percentCompleted` for **package** is computed over all lectures the user
  has touched inside that package (matches `/learning/progress/my` semantics).
  For **course** / **live course** it's `completedLectures / totalLectures`
  across the full container.
- `daysLeft = null` means either lifetime subscription or no active sub
  (e.g. the user was watching free content) — hide the days-left chip in
  both cases. The frontend should not distinguish.

---

## 2. How each UI section maps to the response

### 2.1 Purple "Resume Learning" card — `resumeLecture`

- Source: most recent `LectureProgress` row whose `liveCourseId` is set.
- Render:
  - Big title from `lecture.title` (e.g. *"UPSC — Indian Politics Chapter 5"*)
  - "Last Watched 2 days ago" → derived from `lastWatchedAt` (use a relative
    time formatter — do not show absolute date).
  - Progress bar → `percentCompleted`
  - "X min left" → `(durationSec - positionSec) / 60`, floor to int. If
    `durationSec === 0`, hide the "min left" label.
  - "Resume Now" button → see §3 (tap handling).
- Container metadata (`title`, `thumbnail`, `daysLeft`) is the parent
  **Live Course**, even though the visible label is the lecture title.

### 2.2 My Courses — recent **Package** card (`recentPackage`)

- Source: most recent `LectureProgress` row whose `packageId` is set, joined
  back to the Package.
- Render in the **GCERT-style** card layout:
  - Thumbnail = `thumbnail`
  - Title = `title` (package name)
  - Subtitle = `lecture.title` if present, else hide subtitle
  - `daysLeft` chip top-right ("120 Days Left")
  - "Next Class Tomorrow 05:00 PM" — this lives outside this endpoint; pull
    it from your existing live-class schedule source if you already render it.
- Tap → see §3.

### 2.3 My Courses — recent **Course** card (`recentCourse`)

- Source: most recent `LectureProgress` row whose `courseId` is set.
- Render same card layout as the package card, with:
  - "Resume Learning" CTA button (instead of "Next Class…")
  - Progress bar = `percentCompleted`
- Tap → see §3.

---

## 3. Tap handling (deep-link into the right screen)

A single helper in the frontend should be enough for all three cards:

```ts
function openResumeCard(card: ResumeCard) {
  // The card represents one of three containers. Open the lecture screen
  // for `resume.videoId` or `resume.liveSessionId`, scoped to the right
  // parent container so the back stack lands the user where they expect.
  if (card.resume.liveSessionId) {
    return navigate("LiveSessionPlayer", {
      liveSessionId: card.resume.liveSessionId,
      liveCourseId: card.liveCourseId ?? undefined,
      packageId:    card.packageId    ?? undefined,
      positionSec:  card.resume.positionSec,
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
  // No lecture row yet (e.g. user opened the package but never played) —
  // fall back to the container's landing page.
  if (card.type === "package")  return navigate("PackageDetail",  { packageId:    card.packageId! });
  if (card.type === "live")     return navigate("LiveCourseDetail", { liveCourseId: card.liveCourseId! });
  return navigate("CourseDetail", { courseId: card.courseId! });
}
```

Why these params: the player screens use the parent container to set the
"back" target and to keep the in-player chapter list scoped — passing
`packageId` keeps the user inside the package context after they finish the
lecture; omitting it would land them on the bare course.

---

## 4. Integration recipe (home screen)

```ts
// On home-screen mount / focus
const { resumeLecture, recentPackage, recentCourse } =
  await api.get("/api/v1/client/dashboard/resume");

// In the JSX, render in this order to match the screenshot:
<MyCoursesRow>
  {recentCourse  && <ResumeCardSmall card={recentCourse} onTap={openResumeCard}/>}
  {recentPackage && <ResumeCardSmall card={recentPackage} onTap={openResumeCard}/>}
</MyCoursesRow>

{resumeLecture && (
  <ResumeCardLarge card={resumeLecture} onTap={openResumeCard}/>
)}
```

Refresh policy:
- Call once on home-screen mount.
- Re-call on screen **focus** (when returning from a player screen) so the
  progress bar and `lastWatchedAt` reflect the lecture the user just watched.
- No need to call after a heartbeat — the player already writes
  `LectureProgress` and this endpoint reads the latest row on next focus.

Empty states:
- All three `null` → hide the whole "Resume" block entirely. Do not show
  empty placeholders. The home dashboard (`GET /client/dashboard`) covers
  discovery for new users.

---

## 5. Why this is a new endpoint (not added to `/dashboard`)

`/client/dashboard` is cached-friendly and largely user-agnostic
(banners, recently-added packages, course catalog). The resume payload
is user-specific and changes after **every** lecture heartbeat, so we
keep it on a separate route to:
- avoid cache-busting the marketing dashboard on every heartbeat
- let the frontend refresh just this strip on screen focus

---

## 6. Quick reference

| UI element                          | Field                                         |
|-------------------------------------|-----------------------------------------------|
| Purple card big title               | `resumeLecture.lecture.title`                 |
| Purple card "X% Completed"          | `resumeLecture.percentCompleted`              |
| Purple card "X min left"            | `(durationSec - positionSec) / 60`            |
| Purple card "Last Watched … ago"    | relative-time of `resumeLecture.lastWatchedAt`|
| Course/Package card title           | `card.title`                                  |
| Course/Package card thumbnail       | `card.thumbnail`                              |
| "X Days Left" chip                  | `card.daysLeft` (hide when `null`)            |
| Progress bar                        | `card.percentCompleted`                       |
| "Resume Now" tap                    | `openResumeCard(card)`                        |
