# Learning Progress — Frontend (Client) Integration Guide

This document covers the APIs that power the **"Resume Learning"** screen across **Course**, **Package**, and **Live Course** flows — exactly the card shown in the design (thumbnail • title • "By Author" • Days Left • progress bar • Resume Learning CTA).

All endpoints below are authenticated customer routes. Send `Authorization: Bearer <accessToken>` on every call.

Base URL: `/api/v1/client`

---

## 1. Read — Unified Resume-Learning Feed

One call returns every started Course / Package / Live Course in a single, time-sorted list. The shape is identical for all three types so you can render a single `<ResumeCard />` component and switch only on `type`.

### `GET /learning/progress/my`

**Response**
```json
{
  "success": true,
  "data": {
    "cards": [
      {
        "type": "course",                         // "course" | "package" | "live"
        "id": "68f7…",                            // courseId | packageId | liveCourseId (same as the *Id field for the card's type)

        // Navigation IDs — exactly the container ids the FE needs to deep-link.
        // Only the one(s) relevant to the card's type are set; the rest are null.
        "courseId":     "68f7…",                  // set on type=course and on type=package (the specific course inside the package the resume lecture belongs to)
        "packageId":    null,                     // set on type=package
        "liveCourseId": null,                     // set on type=live

        "title": "Gujarat Geography",
        "subtitle": "By Abhijitsinh Zala",        // legacy display string — null if no educator
        "educator": {                             // structured — null if no educator
          "id":    "68a1…",
          "name":  "Abhijitsinh Zala",
          "image": "https://cdn…/educator.jpg"
        },
        "thumbnail": "https://cdn…/cover.jpg",

        "daysLeft": 9,                            // null if no active sub on record
        "subscriptionEndAt": "2026-05-31T23:59:59.000Z",  // raw ISO — null if no sub

        "percentCompleted": 35,                   // 0–100, integer — based on completed lectures vs total published lectures in the container
        "completedLectures": 7,
        "totalLectures": 20,

        "lastWatchedAt": "2026-05-21T08:14:22.000Z",

        // The specific lecture the "Resume Learning" button should open.
        // Populated on EVERY card now (not just the hero).
        "lecture": {
          "_id":             "68aa…",
          "title":           "Climate of Gujarat",
          "topic":           "Physical Geography",  // optional, may be null
          "videoCategoryId": "68bb…",               // the chapter this lecture sits in — needed to scroll/highlight inside the Course screen; null for live-session recordings
          "chapterTitle":    "Unit 3 — Climate"     // resolved title of that chapter; null for live-session recordings
        },

        "resume": {
          "videoId":       "68aa…",               // set for course/package & live folder-recording playback
          "liveSessionId": null,                  // set for raw live-session recordings
          "positionSec":   412,                   // seek-to on tap
          "durationSec":   1800
        }
      }
    ],
    "resumeNext": { /* same shape — equal to cards[0] when present, else null */ }
  }
}
```

### Rendering rules (match the design)

| UI element        | Field                                                                |
|-------------------|----------------------------------------------------------------------|
| Thumbnail         | `card.thumbnail`                                                     |
| Title             | `card.title`                                                         |
| Educator avatar   | `card.educator.image` (fallback initials from `card.educator.name`)  |
| "By …" subtitle   | `card.subtitle` (or compose from `card.educator.name`)               |
| "X Days Left"     | `card.daysLeft` (hide if `null`; format `subscriptionEndAt` if preferred) |
| Progress bar      | `card.percentCompleted` (0–100)                                      |
| Resume Learning   | tap → deep-link based on `card.type` (see below)                     |

### Deep-link from "Resume Learning" tap

Every card now carries enough context to navigate without a follow-up call. The lecture to open is in `card.lecture._id` (and `card.resume.videoId` / `card.resume.liveSessionId`), and the container to open into is in the navigation IDs.

| `card.type` | Container to open                          | Lecture to seek                                                    |
|-------------|--------------------------------------------|--------------------------------------------------------------------|
| `"course"`  | Course screen for `card.courseId` — scroll/expand to `card.lecture.videoCategoryId` (chapter) and highlight `card.lecture._id` | `GET /courses/lecture?id={resume.videoId}&type=course&course={card.courseId}` → seek `positionSec` |
| `"package"` | Package screen for `card.packageId`, then drill into `card.courseId` — scroll to `card.lecture.videoCategoryId` and highlight `card.lecture._id` | `GET /courses/lecture?id={resume.videoId}&type=package&package={card.packageId}` → seek `positionSec` |
| `"live"`    | Live-course screen for `card.liveCourseId` | If `resume.liveSessionId` set → live-session recording player; else `resume.videoId` (folder recording) under `GET /live-courses/{id}/lecture/{videoId}` |

> **Free courses:** `daysLeft` will be `null` (no paid subscription row), but `percentCompleted` and `resume` still populate normally. Heartbeats on free lectures are accepted without a subscription check.

Untouched purchases (subscribed but never opened) are **not** in this list by design — the screen is "Resume Learning", not "All Purchases". For the full list use `/my-subscriptions`.

---

## 2. Write — Progress Heartbeat

The player should `POST` a heartbeat **every 10–15 seconds while playing** and once on pause / close. The first heartbeat for a given (customer, lecture) row is what makes the item appear on the Resume-Learning screen — there is no separate "enroll" or "start" call.

A lecture is auto-marked **completed** once `positionSec / durationSec ≥ 0.95`. Completion is sticky — replaying from the start will not un-complete it.

### 2a. Recorded videos (Course / Package / Live Course folder recordings)

### `POST /courses/lectures/:videoId/progress`

**Body**
```json
{ "positionSec": 412, "durationSec": 1800 }
```

Use this for any `Video` playback — covers Course, Package and Live Course **folder recordings**.

### 2b. Live session recordings (raw Streamos recordings)

### `POST /learning/progress/live-sessions/:liveSessionId`

**Body**
```json
{ "positionSec": 412, "durationSec": 1800 }
```

Use this only when the user is playing a **`LiveSession` recording directly** (e.g. from `GET /live-courses/{id}/session-recordings`) instead of a promoted `Video`.

### Response (both endpoints)
```json
{
  "success": true,
  "data": {
    "_id": "…",
    "customerId": "…",
    "videoId": "…",                // or liveSessionId on 2b
    "courseId": "…",               // denormalised parent pointers
    "liveCourseId": null,
    "packageId": null,
    "positionSec": 412,
    "durationSec": 1800,
    "completed": false,
    "completedAt": null,
    "lastWatchedAt": "…"
  }
}
```

### Error codes

| Status | Meaning                                                                       |
|--------|-------------------------------------------------------------------------------|
| 400    | Bad body (positionSec/durationSec missing or out of range)                    |
| 401    | Missing / invalid Bearer token                                                |
| 403    | No active, verified, non-expired subscription that covers this lecture (skipped for `priceType: "free"` videos) |
| 404    | Lecture/session not found or disabled                                         |

---

## 3. Suggested FE flow

1. **App open / pull-to-refresh on Home → "Continue Learning":**
   `GET /learning/progress/my` → render `resumeNext` as the big hero card, then `cards[]` as the vertical list. No per-card follow-up fetch is needed — `lecture`, `educator`, and all navigation IDs are inlined.
2. **User taps Resume Learning on a card:** use the navigation IDs on the card (`courseId` / `packageId` / `liveCourseId`) + `card.lecture._id` + `card.resume.positionSec` to push the player route directly. No intermediate API call required to resolve "which course does this lecture belong to".
3. **Player playing:** every 10–15 s, fire the matching heartbeat (`POST /courses/lectures/:videoId/progress` or `POST /learning/progress/live-sessions/:liveSessionId`).
4. **Player paused / closed / app backgrounded:** one final heartbeat with the latest position.
5. **Throttle** heartbeats on the client — do not fire faster than once every 10 s; the server will tolerate it but it's wasted traffic.

---

## 4. Field reference (model)

The progress row is owned by the backend, but for debugging it looks like:

```ts
LectureProgress {
  customerId      ObjectId
  videoId?        ObjectId    // exactly one of videoId/liveSessionId is set
  liveSessionId?  ObjectId
  courseId?       ObjectId    // denormalised parent — for course rollups
  liveCourseId?   ObjectId    // denormalised parent — for live-course rollups
  packageId?      ObjectId    // denormalised parent — for package rollups
  positionSec     number
  durationSec     number
  completed       boolean     // sticky once true (≥ 95% watched)
  completedAt     Date | null
  lastWatchedAt   Date
}
```

You should **not** read this directly — always go through `/learning/progress/my`. The fields above are listed only so the response payload is interpretable.
