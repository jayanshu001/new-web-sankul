# Live Course — Admin API Integration Guide

Front-end integration guide for the **live course** admin dashboard: managing
courses, plans, folders, videos, live sessions, recordings, the timetable, and
subscriptions.

---

## 1. Basics

**Base URL:** `{{URL}}/api/v1`

**Auth:** admin Bearer token. Live-course routes require role
`admin` / `super_admin`. Live-session routes also allow `editor`.

```
Authorization: Bearer <admin access token>
```

**Response envelope** — every endpoint returns:

```jsonc
{
  "success": true,
  "code": 201,
  "data": { /* payload */ },
  "message": "Live course created with default folder.",
  "messages": {}
}
```

On error: `success: false` + 4xx/5xx + a `message`. Validation errors come back
as `422` with `messages.errors: ["field: reason", ...]`.

---

## 2. The lifecycle

```
create live course ──▶ (root folder auto-created)
        │
        ├─▶ create pricing plans          (LiveCoursePlan)
        ├─▶ create folders + videos       (VideoCategory / Video)
        ├─▶ set timetable files
        ├─▶ schedule live sessions        (with subject / educator / endAt → feeds the Schedule tab)
        │        │
        │        ├─▶ start  ──▶ (live on Streamos) ──▶ end
        │        └─▶ recording webhook delivers recordings
        │                 └─▶ promote recording into any folder  ──▶ Video
        └─▶ subscriptions: list / grant (free) / extend / revoke
```

Two ID conventions on live-session routes: `:id` accepts the Mongo `_id`
**or** the numeric Streamos `streamId`.

---

## 3. Live courses

### `POST /admin/live-courses`  — create
`multipart/form-data` (upload `image` as a file) **or** JSON with an `image`
URL. Creating a course **auto-creates its root `VideoCategory` folder**.

Body fields: `name` (unique), `description`, `image`, `ordered` (int),
`level`, `status` (bool), `classType` (`live`|`live_offline`|`offline`,
default `live`), `isPaid?`, `isPopular?`, `shareableLink?`, `withMaterial?`,
`withoutMaterial?`, `courseEducatorId?`, `courseSubjectCategoryId?`.

`data`: `{ liveCourse, rootFolder }` — `201`. Duplicate name → `409`.

### `GET /admin/live-courses` — list
Query: `page`, `limit` (max 100), `search`, `status` (`true`/`false`).
`data`: `{ liveCourses, total, page, limit }`

### `GET /admin/live-courses/:id` — detail
`data`: `{ liveCourse }`

### `PUT /admin/live-courses/:id` — update
Same body fields as create, all optional (`multipart` or JSON). `data`: `{ liveCourse }`

### `DELETE /admin/live-courses/:id`
Refuses (`409`) if any live sessions are still attached. Cascades folders +
videos + relations. `data`: `{ id, deletedFolders, deletedVideos, deletedRelations }`

### `PATCH /admin/live-courses/:id/popular` — toggle
`data`: `{ id, isPopular }`

### `PATCH /admin/live-courses/:id/timetable-files` — set the "Time Table" files
Body: `{ "files": [ { "title": "...", "fileUrl": "https://...pdf", "order": 0 } ] }`
Replaces the whole list. Upload PDFs via the generic upload endpoint first,
then send the URLs here. `data`: `{ timetableFiles }`

### `GET /admin/live-courses/:id/sessions` — sessions under this course
Query: `status`, `upcoming=true`, `page`, `limit`. `data`: `{ sessions, total, page, limit }`

---

## 4. Pricing plans

`duration` is in **MONTHS**. One plan per course can be `isDefault`.

| Method | Path | Body / notes |
|---|---|---|
| GET | `/admin/live-courses/:id/plans` | → `{ plans, total }` |
| POST | `/admin/live-courses/:id/plans` | `{ name?, duration, price, originalPrice?, isDefault?, status? }` → `{ plan }` `201` |
| GET | `/admin/live-courses/plans/:planId` | → `{ plan }` |
| PUT | `/admin/live-courses/plans/:planId` | any subset of the above → `{ plan }` |
| DELETE | `/admin/live-courses/plans/:planId` | `409` if verified subscriptions reference it |

`originalPrice` is the MRP shown struck-through on the client; the client
computes `discountPercent` from it.

---

## 5. Folders & videos

Folders are `VideoCategory` rows under the course; videos are `Video` rows
inside a folder.

### Folders
| Method | Path | Body / notes |
|---|---|---|
| GET | `/admin/live-courses/:liveCourseId/folders` | → `{ folders, relations }` (flat list + parent/child relation rows for the tree) |
| POST | `/admin/live-courses/:liveCourseId/folders` | `{ title, image?, parentFolderId?, order_by?, educatorId?, status? }` → `{ folder }` `201` |
| PATCH | `/admin/live-courses/:liveCourseId/folders/:folderId` | `{ title?, image?, order_by?, educatorId?, status? }` → `{ folder }` |
| DELETE | `/admin/live-courses/:liveCourseId/folders/:folderId` | refuses to delete the root folder; cascades videos + relations → `{ id, deletedVideos, deletedRelations }` |

### Videos
| Method | Path | Body / notes |
|---|---|---|
| GET | `.../folders/:folderId/videos` | → `{ videos, total }` |
| GET | `.../folders/:folderId/videos/:videoId` | → `{ video }` |
| POST | `.../folders/:folderId/videos` | `{ title, topic?, platform, priceType?, youtube_id?/aws_id?/vimeo_id?, order?, status? }` → `{ video }` `201` |
| POST | `.../folders/:folderId/videos/from-recording` | `{ liveSessionId, recordingIndex?/quality?, title?, priceType?, order? }` → `{ video, alreadyExisted }` |
| PUT | `.../folders/:folderId/videos/:videoId` | any subset of video fields → `{ video }` |
| POST | `.../folders/:folderId/videos/reorder` | `{ orders: [ { id, order } ] }` → `{ matched, modified }` |
| DELETE | `.../folders/:folderId/videos/:videoId` | → `{ id }` |

`platform` is `youtube` | `aws` | `vimeo` — supply the matching id field.
Recordings promoted from a live session land as `platform: "aws"` with the
mp4 URL in `aws_id`, and carry a `liveSessionId` back-link.

---

## 6. Live sessions (Streamos)

Lifecycle: `SCHEDULED` → `CREATED` → `ENDED` → `READY`.
- `SCHEDULED` — stored in DB only, no Streamos call yet.
- `CREATED` — Streamos stream exists (`streamId`/`rtmpUrl`/`hlsUrl` populated).
- `ENDED` — admin called `/end`.
- `READY` — Streamos posted recordings to the webhook.

### Going live — the admin front-end flow
1. **Go live now:** `POST /admin/live-sessions` with `{ title, liveCourseIds: [...] }`
   and **no `scheduledAt`** → Streamos is called immediately, the session comes
   back `status: CREATED` with `streamId` / `rtmpUrl` / `hlsUrl`.
   *(Or: pre-create with a future `scheduledAt` → `SCHEDULED`, then
   `POST /admin/live-sessions/:id/start` within 2 min of the scheduled time.)*
2. Show the admin the **`rtmpUrl`** — they point an encoder (OBS, a mobile
   streaming app, etc.) at it to actually broadcast video.
3. The moment the session is `CREATED`, customers' **Join** button enables —
   the client session endpoints return `canJoin: true` (status === CREATED).
   Anyone can join; the per-viewer 3-minute preview gate applies inside.
4. **End:** `POST /admin/live-sessions/end` `{ streamId }` → stops the Streamos
   stream, flips status to `ENDED`, emits `live_session_ended` to the room, and
   closes attendance. `canJoin` flips to `false`.

### Testing it locally
- **`docs/live-course-demo.html`** (served at `GET /demo/live-course`, dev only)
  — a ready-to-run admin↔customer harness; section 6 ("Admin — Go Live") drives
  the flow above against a running server.
- **`scripts/go-live-from-camera.ts`** — one command to go live *and* broadcast
  your laptop camera to the Streamos RTMP endpoint via `ffmpeg` (so there's real
  video to watch). `npx tsx scripts/go-live-from-camera.ts [liveCourseId]`;
  Ctrl+C ends the stream. Requires `ffmpeg` (`brew install ffmpeg`) + camera
  permission for the terminal.
- **`scripts/start-live-lecture.ts`** / **`scripts/end-live-lecture.ts`** —
  start/end a real Streamos lecture from the CLI without an encoder (useful for
  verifying the Streamos API itself).

### `POST /admin/live-sessions` — create or schedule
Body: `{ title, liveCourseIds?: [...], subject?, educatorId?, endAt?, scheduledAt?, recordingTargetFolderId? }`
- `scheduledAt` in the **future** → stored `SCHEDULED`, **no Streamos call**.
- omitted / past → created on Streamos immediately, status `CREATED`.
- `subject` / `educatorId` / `endAt` are **timetable metadata** — they feed the
  customer **Schedule tab** (which is derived from scheduled sessions).
- `recordingTargetFolderId` — when set, the recording webhook auto-promotes the
  best-quality recording into that folder. Must belong to one of `liveCourseIds`.

`data`: `{ session }` `201`.

### `GET /admin/live-sessions` — list
Query: `status`, `upcoming=true`, `page`, `limit`. `data`: `{ sessions, total, page, limit }`

### `GET /admin/live-sessions/:id` — detail + status
Polls Streamos for `CREATED`/`ENDED` sessions (refreshes URLs, recovers missed
recordings). `data`: `{ session, isLive, promotedVideos }` — `promotedVideos`
lists every Video filed from this session's recordings (the "manage well" view).

### `POST /admin/live-sessions/:id/start` — promote SCHEDULED → live
Only allowed within 2 minutes of `scheduledAt` (late starts always allowed).
Calls Streamos. `data`: `{ session }`.

### `PATCH /admin/live-sessions/:id` — edit a SCHEDULED session
Body (any subset): `{ title?, scheduledAt?, liveCourseIds?, recordingTargetFolderId?, subject?, endAt?, educatorId? }`.
Only `SCHEDULED` sessions are editable. `data`: `{ session }`.

### `DELETE /admin/live-sessions/:id`
Refuses (`409`) a currently-live `CREATED` session — end it first. `data`: `{ id }`

### `POST /admin/live-sessions/end`
Body: `{ streamId }`. Ends the Streamos stream, flips status to `ENDED`,
notifies the live room. `data`: `{ streamId, status }`

### `POST /admin/live-sessions/:id/promote-recording`  — file a recording into any folder
Body: `{ folderId, recordingIndex?/quality?, title?, priceType?, order? }`
- The folder may belong to **any** live course OR recorded course.
- Pick the recording by `recordingIndex` (0-based) or `quality` ("720p"); omit
  both for best quality.
- **Idempotent per folder** — re-promoting returns the existing Video (`200`,
  `alreadyExisted: true`) instead of duplicating.

`data`: `{ video, alreadyExisted }` — `201` (new) or `200` (existing).

### `GET /admin/live-sessions/:id/attendance`  — who watched
One row per customer **join → leave** stint on the live class (rejoins produce
multiple rows). `data`:
```jsonc
{
  "attendance": [
    {
      "_id": "...", "streamId": "T_...", "liveSessionId": "...",
      "customerId": { "firstName": "...", "lastName": "...", "phoneNumber": "..." },
      "userName": "...",
      "joinedAt": "2026-05-14T...", "leftAt": "2026-05-14T...",  // leftAt null = still watching
      "durationSec": 540
    }
  ],
  "summary": { "totalJoins": 12, "uniqueViewers": 8, "currentlyActive": 3 }
}
```
Rows are written by the Socket.IO layer (open on join, closed on leave /
disconnect) and bulk-closed when the stream is ended via `POST /live-sessions/end`.

### Real-time events (Socket.IO)
Ending a stream and viewer presence are pushed over Socket.IO to the live class
room (`roomKey = live_chat:<streamId>`):
- `live_session_ended` `{ streamId, liveClassId, status, endedAt }` — emitted by
  `POST /live-sessions/end`; the client should close the player.
- `user_joined` / `user_left` `{ liveClassId, customerId, userName, joinedAt|leftAt }`
- `viewer_count` `{ liveClassId, count }` — distinct customers currently watching.

### Streamos passthrough
| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/live-sessions/streamos/org` | connected org + registered webhook URL |
| GET | `/admin/live-sessions/streamos/recordings/:recordingId` | look up a past recording by id |
| POST | `/admin/live-sessions/streamos/webhook` | register the recording webhook URL — body `{ webhook }` |

> **Recording webhook security:** Streamos doesn't sign callbacks. Register the
> webhook URL with `?key=<STREAMOS_WEBHOOK_SECRET>` appended; the public
> `POST /client/webhook/recording` endpoint validates that secret.

---

## 7. Subscriptions

### `GET /admin/live-courses/subscriptions` — list (all)
Query (all optional): `customerId`, `liveCourseId`, `planId`,
`paymentStatus` (`pending`|`verified`|`failed`), `status` (`true`/`false`),
`page`, `limit`.
`data`: `{ subscriptions, total, page, limit }` — customer / live course / plan populated.

### `GET /admin/live-courses/:id/subscriptions` — list for one course
Same handler, pre-scoped by the path id.

### `GET /admin/live-courses/subscriptions/:subscriptionId` — detail
`data`: `{ subscription }`

### `POST /admin/live-courses/:id/grant` — free-grant (no payment)
Hand a customer an active, verified subscription with `paidAmount: 0`.

Body: `{ customerId, planId, durationMonths?, startAt?, endAt? }`
- Window comes from the plan's `duration` unless overridden by
  `durationMonths` / `startAt` / `endAt`.
- `409` if the customer already has an active subscription to this course —
  the response `data` carries the existing `subscriptionId` so you can extend
  it via the update endpoint instead.

`data`: `{ subscription }` `201`.

### `PUT /admin/live-courses/subscriptions/:subscriptionId` — extend / revoke
Body (≥1 field): `{ status?, paymentStatus?, startAt?, endAt? }`.
- Extend → set a later `endAt`.
- Revoke → `status: false` (keeps the audit trail — preferred over delete).

`data`: `{ subscription }`

### `DELETE /admin/live-courses/subscriptions/:subscriptionId`
Hard delete — for test / erroneous rows only. `data`: `{ id }`

---

## 8. Quick reference

**Live courses**
```
GET    /admin/live-courses
POST   /admin/live-courses
GET    /admin/live-courses/:id
PUT    /admin/live-courses/:id
DELETE /admin/live-courses/:id
PATCH  /admin/live-courses/:id/popular
PATCH  /admin/live-courses/:id/timetable-files
GET    /admin/live-courses/:id/sessions
```
**Plans**
```
GET    /admin/live-courses/:id/plans
POST   /admin/live-courses/:id/plans
GET    /admin/live-courses/plans/:planId
PUT    /admin/live-courses/plans/:planId
DELETE /admin/live-courses/plans/:planId
```
**Folders & videos**
```
GET    /admin/live-courses/:liveCourseId/folders
POST   /admin/live-courses/:liveCourseId/folders
PATCH  /admin/live-courses/:liveCourseId/folders/:folderId
DELETE /admin/live-courses/:liveCourseId/folders/:folderId
GET    /admin/live-courses/:liveCourseId/folders/:folderId/videos
GET    /admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
POST   /admin/live-courses/:liveCourseId/folders/:folderId/videos
POST   /admin/live-courses/:liveCourseId/folders/:folderId/videos/from-recording
POST   /admin/live-courses/:liveCourseId/folders/:folderId/videos/reorder
PUT    /admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
DELETE /admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
```
**Subscriptions**
```
GET    /admin/live-courses/subscriptions
GET    /admin/live-courses/:id/subscriptions
GET    /admin/live-courses/subscriptions/:subscriptionId
POST   /admin/live-courses/:id/grant
PUT    /admin/live-courses/subscriptions/:subscriptionId
DELETE /admin/live-courses/subscriptions/:subscriptionId
```
**Live sessions**
```
POST   /admin/live-sessions
GET    /admin/live-sessions
GET    /admin/live-sessions/:id
POST   /admin/live-sessions/:id/start
PATCH  /admin/live-sessions/:id
DELETE /admin/live-sessions/:id
POST   /admin/live-sessions/end
POST   /admin/live-sessions/:id/promote-recording
GET    /admin/live-sessions/:id/attendance
GET    /admin/live-sessions/streamos/org
GET    /admin/live-sessions/streamos/recordings/:recordingId
POST   /admin/live-sessions/streamos/webhook
```

> A runnable Postman collection with every endpoint above (organised
> folder-wise, with example bodies) lives at
> `docs/Web-Sankul-API.postman_collection.json` →
> *Admin APIs → 16 Live Courses* and *15 Live Class — Sessions*.
