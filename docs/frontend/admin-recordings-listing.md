# Admin — Recorded Sessions Listing

Mirrors the customer "Previous Live Session" panel, but for admins. **No new
endpoints needed** — everything required already exists. This doc explains
which existing routes to call and how to compose them into the admin
Recordings screen.

## Two complementary views

The admin UI typically wants two answers, and there's one endpoint for each:

| Admin question | Endpoint |
|---|---|
| **"Which past live sessions have produced a recording in this course?"** (raw, per-session view — useful for the live-tab "sessions that have ended" list and for spotting sessions stuck in transcoding) | `GET /api/v1/admin/live-sessions?liveCourseId=<id>&status=READY` (and `…&status=ENDED` for the in-progress ones) |
| **"What recorded lectures are filed under each subject folder in this course?"** (the customer-facing folder/subject grouping — what students actually see) | `GET /api/v1/admin/live-courses/:liveCourseId/folders` then `GET /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos` |

Build the screen with both — top section shows the raw session-by-session list with status pills, bottom (or a separate tab) shows the curated folder structure students see.

---

## A. Per-session listing (status-aware)

### `GET /api/v1/admin/live-sessions`

Handler: `listLiveSessions` ([src/admin/live/live.routes.ts:30](src/admin/live/live.routes.ts#L30))
Auth: `requireRole("admin", "super_admin", "editor")`

Query params:

| Param | Values | Purpose |
|---|---|---|
| `liveCourseId` | ObjectId | Scope to one live course (recommended) |
| `status` | `SCHEDULED` \| `CREATED` \| `ENDED` \| `READY` | Filter by lifecycle state |
| `upcoming` | `true` | Only SCHEDULED with `scheduledAt >= now` |
| `page` | int (default 1) | |
| `limit` | int (default 50, max 100) | |

For the **Recordings tab** you want sessions that have produced (or are producing) a recording:

- **`?status=READY`** → recording available, auto-promoted to subject folder.
- **`?status=ENDED`** → stream ended, Streamos still transcoding. Show as **"Processing…"**.

Make two calls (or call once with no status filter and group client-side). Two calls is cleaner.

Response shape (per session):

```jsonc
{
  "id": "…",
  "title": "Day 03 — વર્ગ & ઘન",
  "subject": "Maths",                        // ← drives the auto-folder
  "status": "READY",                          // or "ENDED" while processing
  "liveCourseIds": ["…"],
  "liveCourseId": "…",                        // legacy single-id field
  "educatorId": "…",
  "scheduledAt": "2026-05-20T09:00:00.000Z",
  "endAt": "2026-05-20T10:00:00.000Z",
  "streamId": "T_…",
  "rtmpUrl": null,
  "hlsUrl": null,
  "hlsUrls": null,
  "recordings": [                             // populated when READY
    { "quality": "720p", "file_size": 12345, "path": "https://…720.mp4" },
    { "quality": "480p", "file_size": 8765,  "path": "https://…480.mp4" }
  ],
  "createdAt": "…",
  "updatedAt": "…"
}
```

### How to render each row

| UI element | Source |
|---|---|
| Session title | `title` |
| Subject pill | `subject` |
| Status pill | `status` → `READY` = "Recording available", `ENDED` = "Processing…", `CREATED` = "Live now", `SCHEDULED` = "Scheduled" |
| Date/time | `scheduledAt` / `endAt` |
| Recording count | `recordings.length` |
| **"View recording"** button | enabled when `status === "READY" && recordings.length > 0`; opens the session detail (see §C) |
| **"Where did it land?"** | Call `GET /api/v1/admin/live-sessions/:id` and read `promotedVideos[]` (see §C) |

### Polling for in-progress sessions

For sessions with `status === "ENDED"`, periodically refetch the per-session
endpoint (§C) — it transparently polls Streamos and flips to `READY` the
moment Streamos is done. Alternatively, listen on the Socket.IO room (same
room used for live chat) for the **`recordings_ready`** event — payload
includes `streamId` so you can match it to the row and refresh.

---

## B. Subject-grouped folders (what students see)

### `GET /api/v1/admin/live-courses/:liveCourseId/folders`

Handler in [src/admin/live-course/live-course.folder.controller.ts](src/admin/live-course/live-course.folder.controller.ts).
Auth: `requireRole("admin", "super_admin")`.

Returns the list of `VideoCategory` folders under the course. After the
subject-grouping migration each auto-created folder has:

```jsonc
{
  "_id": "…",
  "title": "Maths",                  // ← admin's typed subject (first writer)
  "subjectKey": "maths",             // ← internal lookup key (lower, trimmed)
  "image": null,                     // null for auto-created — admin can set later
  "order_by": 3,
  "liveCourseId": "…",
  "status": true,
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `GET /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos`

Returns the `Video` documents in that folder — including the auto-promoted
recordings. Each Video carries `liveSessionId` pointing back to its source
session (useful for "open source session" link).

Typical fields per Video:

```jsonc
{
  "_id": "…",
  "title": "Day 03 — વર્ગ & ઘન (720p)",   // auto-titled from session + quality
  "videoCategoryId": "…",
  "liveSessionId": "…",                    // ← source live session
  "platform": "aws",
  "aws_id": "https://…720.mp4",            // the Streamos MP4 url
  "priceType": "paid",
  "order": 0,
  "status": true,
  "createdAt": "…"
}
```

### How to render

A two-level list: folder cards with `title` as header, `image` (with
placeholder when null), then each Video inside. Reuse the existing folder
management UI — these auto-created folders behave identically to manually
created ones (admin can rename, set image, reorder, delete).

Where the customer endpoint adds `progress` per lecture, the admin endpoint
deliberately doesn't (admin doesn't need a personal resume sliver). If you
want aggregate watch stats, that's a separate analytics endpoint and is out
of scope for this listing.

---

## C. Session detail (the deep dive)

### `GET /api/v1/admin/live-sessions/:id`

Handler: `getLiveSessionStatus` ([src/admin/live/live.controller.ts:374](src/admin/live/live.controller.ts#L374))

This is the **single most useful admin endpoint** for the Recordings screen.
It does two helpful things automatically:

1. **Refreshes from Streamos** for `CREATED`/`ENDED` sessions — polls
   `streamDetails` to get fresh HLS URLs and an up-to-date `isLive` flag.
2. **Recovers missed recordings** — if `status === "ENDED"` and our DB has
   `recordings: []` but Streamos has them ready, it back-fills `recordings`,
   flips status to `READY`, emits the socket event, and runs the auto-promote
   into the subject folder. So even if the webhook was lost, opening this
   endpoint repairs the session.

Response:

```jsonc
{
  "session": { /* same shape as listLiveSessions row, refreshed */ },
  "isLive": false,
  "promotedVideos": [                       // ← where the recording was filed
    {
      "_id": "…",
      "title": "Day 03 — વર્ગ & ઘન (720p)",
      "videoCategoryId": "…",               // ← the subject folder
      "aws_id": "https://…720.mp4",
      "priceType": "paid",
      "order": 0,
      "status": true,
      "createdAt": "…"
    }
  ]
}
```

`promotedVideos` is `Video.find({ liveSessionId })` across **all folders and
courses** — so if the same recording was filed into multiple subject folders
(one per linked live course), you'll see all of them.

### How to use it

| Admin task | What to do |
|---|---|
| Open a recording for review | `data.session.recordings[]` → pick a quality → play `path` |
| "Where did this recording end up?" | Show `promotedVideos[]` — each row has `videoCategoryId` → look up folder title |
| Force-refresh a "stuck ENDED" session | Just open this endpoint; it triggers Streamos recovery |
| Inspect raw HLS URLs | `data.session.hlsUrl` / `hlsUrls` |

---

## D. Manual promotion (rare — for filing into a different folder)

The auto-promote handles 95% of cases (every recording auto-lands in the
subject folder). For the few times an admin wants to file the recording into
a different folder, or pick a different quality:

### `POST /api/v1/admin/live-sessions/:id/promote-recording`

Body:
```jsonc
{
  "folderId": "…",          // any VideoCategory under any course
  "quality": "480p",        // OR
  "recordingIndex": 1,      // 0-based into recordings[]
  "title": "Optional override",
  "priceType": "paid" | "free",
  "order": 0
}
```

Idempotent per folder — re-promoting into the same folder returns the
existing Video (`alreadyExisted: true`), not a duplicate.

---

## E. Status semantics (the only "progress" Streamos exposes)

There is **no transcoding-progress percentage**. Use `status` as a 4-value
state machine:

| `status` | Meaning | Recordings visible? |
|---|---|---|
| `SCHEDULED` | On the timetable, stream not started | No |
| `CREATED` | Stream is live right now | No |
| `ENDED` | `/end` was called, **Streamos is transcoding** | Not yet — show "Processing…" |
| `READY` | Webhook landed (or recovery ran). Auto-promote done | Yes — in `/recordings` listing AND on session detail |

Transition `ENDED → READY` is fully automatic. Typical wait: a few minutes (no SLA from Streamos).

---

## F. Recommended admin UI layout

```
┌──────────────────────────────────────────────────────────────┐
│  Live Course: <Course Name>                                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Tabs: [Live Now] [Scheduled] [Recordings] [Folders]     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                              │
│  RECORDINGS TAB                                              │
│  ────────────────                                            │
│  ● Processing                                                │
│    GET /admin/live-sessions?liveCourseId=…&status=ENDED      │
│    Show as cards with "Processing…" pill + auto-refresh      │
│                                                              │
│  ● Ready                                                     │
│    GET /admin/live-sessions?liveCourseId=…&status=READY      │
│    Each row →                                                │
│      • title, subject pill, date                             │
│      • [View] → GET /admin/live-sessions/:id                 │
│           shows recordings[], promotedVideos[] (folder)      │
│      • [Re-promote] → POST /admin/live-sessions/:id/promote- │
│                       recording (only if admin wants to file │
│                       elsewhere)                             │
│                                                              │
│  FOLDERS TAB (subject view — what students see)              │
│  ─────────────                                               │
│  GET /admin/live-courses/:id/folders                         │
│  For each folder card:                                       │
│    • title, image (placeholder if null), edit/delete/reorder │
│    • [Open] → GET …/folders/:folderId/videos                 │
└──────────────────────────────────────────────────────────────┘
```

---

## G. Socket.IO (optional real-time refresh)

If the admin dashboard already opens a socket connection, listen for the
**`recordings_ready`** event on `roomKey(streamId)` to push-refresh rows
without polling. The same room is used by the live chat; the event payload:

```jsonc
{
  "streamId": "T_…",
  "liveClassId": "T_…",
  "status": "READY",
  "recordings": [ /* full array */ ]
}
```

Note (from the existing admin integration doc): the socket server currently
authenticates **customer** tokens on connect. Until an admin auth branch is
added, you can either (a) poll the REST endpoints (recommended for the admin
Recordings tab — it's not a high-churn screen), or (b) connect with a
customer token reserved for the dashboard.

---

## H. What to tell QA

- [ ] Open the Recordings tab on a course with ≥1 `READY` session — the
      session appears with its recording quality count.
- [ ] End a live session via `/end`. The session immediately moves to the
      "Processing" group with status `ENDED`. After a few minutes (Streamos
      transcoding), refetch — it moves to "Ready" and shows recordings.
- [ ] Open a `READY` session's detail. `promotedVideos[]` lists at least one
      entry pointing to the subject folder named after `session.subject`.
- [ ] Visit the Folders tab — the same recording shows up inside the
      folder whose `title` matches the session's subject (auto-created if it
      didn't exist before).
- [ ] Re-promote the same recording into a different folder (via §D). The
      original auto-promoted Video is unaffected; a new Video appears in
      the new folder.

---

## TL;DR for the admin FE team

You need **zero new endpoints**. The admin recording listing is composed of:

1. `GET /api/v1/admin/live-sessions?liveCourseId=…&status=READY` — list ready recordings.
2. `GET /api/v1/admin/live-sessions?liveCourseId=…&status=ENDED` — list "processing" ones.
3. `GET /api/v1/admin/live-sessions/:id` — open a session, see recordings + which folder(s) they were filed into.
4. `GET /api/v1/admin/live-courses/:liveCourseId/folders` + `…/folders/:folderId/videos` — folder/subject view (mirrors the student listing).
5. (rare) `POST /api/v1/admin/live-sessions/:id/promote-recording` — file the recording into a different folder.

For "is transcoding done?" — there is no percentage. Read `status`:
`ENDED` = in progress, `READY` = done. Refetching `GET /admin/live-sessions/:id` also self-heals stuck sessions.
