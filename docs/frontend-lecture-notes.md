# Frontend Guide — Lecture Notes (text + audio)

**Audience:** App / frontend engineers
**Endpoints covered:** Save / list / update / delete **text notes** and **audio notes**
on a recorded video lecture or a recorded live-session.

> **Background:** Save-note was returning **"This lecture is not attached to a course"**
> for videos that *do* belong to a course. Root cause was the same as the progress /
> Resume-Learning issue: a video can sit under a **child video category** whose own
> `courseId` is null, while the actual Course/Package/Live-Course link lives on the
> **parent** category (managed in Admin → Video Categories → *Child Categories*). The
> backend now resolves the owning course robustly (leaf → ancestors →
> `Course.videoCategoryId`), so correctly-formed requests succeed. This doc tells you how
> to call the note APIs and how to read the error states.

---

## TL;DR

- Notes are **scoped to a course** (for videos) or a **live course** (for live-session
  recordings). The backend derives that container from the `videoId` /
  `liveSessionId` you pass — **you do not send a course/package id in the body** for
  notes (unlike the progress heartbeat).
- Send the required **`lectureType`** (`"recorded"` | `"live"`) plus the matching id
  (**`videoId`** for recorded, **`liveSessionId`** for live). The backend now finds the
  course even when the video is under a child category.
- **Free** videos: any logged-in user can take notes (no subscription needed).
- **Paid** videos: the user must hold an active, verified, non-expired subscription to the
  owning course / live course.

---

## Endpoints

### Text notes

```
POST   /api/v1/client/lecture-notes                 # create
GET    /api/v1/client/lecture-notes                 # list (filter by videoId / liveSessionId)
PATCH  /api/v1/client/lecture-notes/:noteId         # update
DELETE /api/v1/client/lecture-notes/:noteId         # delete
```

### Audio notes

```
POST   /api/v1/client/lecture-audio-notes           # create (multipart upload)
GET    /api/v1/client/lecture-audio-notes           # list
PATCH  /api/v1/client/lecture-audio-notes/:noteId   # update
DELETE /api/v1/client/lecture-audio-notes/:noteId   # delete
```

All require `Authorization: Bearer <customer token>`.

---

## Create a text note

```jsonc
POST /api/v1/client/lecture-notes
Authorization: Bearer <token>
Content-Type: application/json

{
  "lectureType": "recorded",                 // "recorded" | "live"  (REQUIRED discriminator)
  "videoId": "6a19736359f7f485f583a6e1",     // required when lectureType = "recorded"
  // "liveSessionId": "....",                // required when lectureType = "live" (instead of videoId)

  "content": "Newton's second law — F = ma. Revisit at 12:40.",
  "timestampSec": 760                         // playback timestamp in the lecture
}
```

### Body fields

| Field           | Type   | Required | Notes |
|-----------------|--------|----------|-------|
| `lectureType`   | enum   | **Yes**  | `"recorded"` (a Video) or `"live"` (a recorded LiveSession). Decides which id is required. |
| `videoId`       | string | if `recorded` | `_id` of the recorded Video. |
| `liveSessionId` | string | if `live` | `_id` of the recorded LiveSession. |
| `content`       | string | Yes      | The note text. Trimmed, 1–5000 chars. |
| `timestampSec`  | number | Yes      | Playback timestamp the note refers to (integer seconds, 0–86400). `Math.floor`. |

> ⚠️ `lectureType` drives validation: `recorded` requires `videoId`; `live` requires
> `liveSessionId`. Send the id that matches the type. The backend resolves the owning
> course (for `videoId`) or owning live course(s) (for `liveSessionId`) itself.

---

## Create an audio note (multipart)

```
POST /api/v1/client/lecture-audio-notes
Authorization: Bearer <token>
Content-Type: multipart/form-data

lectureType=recorded
videoId=6a19736359f7f485f583a6e1
timestampSec=760
title=My quick thought          # optional
durationSec=18                  # optional — length of the audio clip
audio=<file>                    # the recorded audio blob — multipart field name MUST be "audio"
```

### Audio note fields

| Field           | Type   | Required | Notes |
|-----------------|--------|----------|-------|
| `lectureType`   | enum   | **Yes**  | `"recorded"` or `"live"`. |
| `videoId`       | string | if `recorded` | `_id` of the Video. |
| `liveSessionId` | string | if `live` | `_id` of the LiveSession. |
| `timestampSec`  | number | Yes      | Playback timestamp (sent as a string in multipart; coerced server-side). |
| `title`         | string | No       | Optional label, ≤200 chars. |
| `durationSec`   | number | No       | Optional length of the recorded clip. |
| `audio`         | file   | Yes      | The audio blob. **Multipart field name must be exactly `audio`.** |

The backend uploads the audio to storage and returns the playable URL in the response.
(Note: audio notes carry a `title`, not `content`.)

---

## List notes

`lectureType` is **required** on the list query too, alongside the matching id:

```
GET /api/v1/client/lecture-notes?lectureType=recorded&videoId=6a19736359f7f485f583a6e1
GET /api/v1/client/lecture-notes?lectureType=live&liveSessionId=...
GET /api/v1/client/lecture-audio-notes?lectureType=recorded&videoId=...
```

Filter by the lecture the user is viewing so the notes panel shows only that lecture's
notes.

---

## Update a note

```
PATCH /api/v1/client/lecture-notes/:id          # text:  { content?, timestampSec? }  (at least one)
PATCH /api/v1/client/lecture-audio-notes/:id     # audio: { title?, timestampSec? }    (at least one)
DELETE /api/v1/client/lecture-notes/:id
DELETE /api/v1/client/lecture-audio-notes/:id
```

`:id` is the note's own `_id` (from create/list responses). Text-note updates accept
`content` and/or `timestampSec`; audio-note updates accept `title` and/or `timestampSec`.

---

## What you must get right (the one rule)

➡️ **Send `lectureType` plus the matching id** — `videoId` for `recorded`,
`liveSessionId` for `live` — **of the lecture the user is actually watching.**

That's it. Unlike the progress heartbeat, notes do **not** take a `scope` / container id —
the backend now walks the category hierarchy and the `Course.videoCategoryId` pointer to
find the owning course on its own. As long as the `videoId` is right, a note on a video
nested under a child category will save correctly.

> If you were previously sending a *category id* where a *video id* was expected, that
> would also produce "not attached to a course". Double-check you're sending the **video's**
> `_id`, not its category's.

---

## Error states & how to handle them

| HTTP | `error` message | Meaning | FE handling |
|------|-----------------|---------|-------------|
| 400  | `This lecture is not attached to a course.` | The video genuinely resolves to no course (even after the ancestor + `Course.videoCategoryId` checks). Usually a real **admin data gap** — the video's category tree is wired to no course at all. | Show a soft message ("Notes aren't available for this lecture"). **Report the `videoId` to backend/admin** — this now means the content truly has no course, not a resolution bug. |
| 400  | (validation) | Missing `lectureType`, missing the id required by that type (`videoId` for `recorded`, `liveSessionId` for `live`), empty `content`, missing `timestampSec`, or a malformed id. | Fix the payload: send `lectureType` + matching id + required fields. |
| 403  | `Active subscription required to take notes.` (or `record audio notes`) | Paid lecture, user has no active verified sub for the owning course. | Expected — gate the note UI behind subscription, or prompt to subscribe. |
| 403  | `Notes are only available for subscribed live courses.` | Live session has no attached live course (open/free session). | Hide notes UI for open sessions. |
| 404  | `Lecture not found.` / `Live session not found.` | Bad id or disabled content. | Check the id. |

> **Important nuance about the 400 "not attached to a course":** *before* this fix it fired
> for videos that DID belong to a course (the bug). *After* this fix it should only fire for
> videos that genuinely have no course wired in Admin. So if you still see it for a video you
> believe is in a course, capture the `videoId` and send it to the backend team — it's an
> admin-data issue (the video's category isn't linked to any course/package/live course),
> not a frontend payload problem.

---

## Self-verification checklist

1. Open a paid course you're subscribed to, drill into a **child category**, open a video.
2. `POST /lecture-notes` with `lectureType: "recorded"`, that video's `videoId`,
   `content`, and `timestampSec`.
   - ✅ Expect `200` and the saved note in the response.
   - ❌ If `400 not attached to a course` → confirm you sent the **video** id (not category
     id); if correct, the video has no course wired (escalate to admin).
3. `GET /lecture-notes?lectureType=recorded&videoId=<same>` → your note is listed.
4. Repeat with a **free** video (no subscription) → should also `200`.
5. Repeat the same with `/lecture-audio-notes` (multipart, field name `audio`) for audio
   notes.

---

## Relationship to the progress doc

This is the **same underlying data situation** described in
[`frontend-video-progress-heartbeat.md`](./frontend-video-progress-heartbeat.md):
videos nested under child categories whose course link lives on a parent. The two flows
differ in how the container is supplied:

| Flow | How the container is determined |
|------|----------------------------------|
| **Progress heartbeat** (`/courses/lectures/:videoId/progress`) | FE sends `scope` (course/package/live id) — required, because progress can attach to package/live too. |
| **Lecture notes** (`/lecture-notes`, `/lecture-audio-notes`) | Backend derives the course from `videoId` automatically — **no `scope` needed**. |

So for notes you only need a correct `videoId`; for progress you also need a correct
`scope`.
