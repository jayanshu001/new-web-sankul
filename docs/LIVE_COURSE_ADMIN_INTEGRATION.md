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

**Required:** `name` (unique), `description`, `image`, `ordered` (int),
`level`, `status` (bool — must be present, no default in schema).
**Optional:** `classType` (`live`|`live_offline`|`offline`, default `live`),
`isPaid?` (model default `true`), `isPopular?` (model default `false`),
`shareableLink?`, `withMaterial?`, `withoutMaterial?`, `courseEducatorId?`,
`courseSubjectCategoryId?`, `materialCategories?: [{ id, name? }]`,
`examCategories?: [{ id, name? }]`.

> `materialCategories` and `examCategories` are arrays of `{ id, name? }` refs
> kept for parity with the regular `Course` model. They appear on
> `liveCourse` responses even when empty.

`data`: `{ liveCourse, rootFolder }` — `201`. Duplicate name → `409`.

### `GET /admin/live-courses` — list
Query: `page`, `limit` (max 100), `search`, `status` (`true`/`false` — filters by `status` flag).
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

`duration` is in **MONTHS**. One plan per course can be `isDefault` — when
you set `isDefault: true` on any plan, the server transactionally unsets it
on all other plans for that course. `name` is optional; if omitted, persists
as `null`.

| Method | Path | Body / notes |
|---|---|---|
| GET | `/admin/live-courses/:id/plans` | → `{ plans, total }` — sorted `isDefault desc, price asc, createdAt asc` |
| POST | `/admin/live-courses/:id/plans` | `{ name?, duration, price, originalPrice?, isDefault?, status? }` → `{ plan }` `201` |
| GET | `/admin/live-courses/plans/:planId` | → `{ plan }` |
| PUT | `/admin/live-courses/plans/:planId` | any subset of the above → `{ plan }` |
| DELETE | `/admin/live-courses/plans/:planId` | `409` if any `paymentStatus: verified` subscription references it — `pending` / `failed` subs do **not** block deletion |

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

> Folder responses also include a server-generated `slug` (`<slugified-title>-<base36-timestamp>` — **not deterministic**, do not try to predict it client-side) and a `childCategoryId` legacy field (deprecated; the live tree uses `VideoCategoryRelation` rows in the `relations` array from the list endpoint).

### Videos
| Method | Path | Body / notes |
|---|---|---|
| GET | `.../folders/:folderId/videos` | → `{ videos, total }` — `total` is the **length of the returned array**, not a paginated count. Endpoint is not paginated today. |
| GET | `.../folders/:folderId/videos/:videoId` | → `{ video }` |
| POST | `.../folders/:folderId/videos` | `{ title, topic?, platform, priceType?, youtube_id?/aws_id?/vimeo_id?, order?, status? }` → `{ video }` `201` |
| POST | `.../folders/:folderId/videos/from-recording` | `{ liveSessionId, recordingIndex?/quality?, title?, priceType?, order? }` → `{ video, alreadyExisted }` |
| PUT | `.../folders/:folderId/videos/:videoId` | any subset of video fields → `{ video }` |
| POST | `.../folders/:folderId/videos/reorder` | `{ orders: [ { id, order } ] }` → `{ matched, modified }` (orders for videos not in this folder are silently ignored) |
| DELETE | `.../folders/:folderId/videos/:videoId` | → `{ id }` |

`platform` is `youtube` | `aws` | `vimeo` — supply the matching id field.
`priceType` defaults to `"paid"` when omitted. **Create-time** the schema
enforces `platform` ↔ `<platform>_id` pairing; **update-time** it does not,
so you can `PUT` `{ title }` without re-sending the platform/id.
Recordings promoted from a live session land as `platform: "aws"` with the
mp4 URL in `aws_id`, and carry a `liveSessionId` back-link on the Video doc
for traceability (visible in the response).

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
Body: `{ title, subject, liveCourseIds?: [...] | liveCourseId?: "...", educatorId?, endAt?, scheduledAt? }`
- Pass either `liveCourseIds` (array, preferred) **or** the single-string convenience `liveCourseId` — the controller accepts both.
- `scheduledAt` in the **future** → stored `SCHEDULED`, **no Streamos call** (`streamId` / `rtmpUrl` / `hlsUrl` all `null`).
- omitted / past → created on Streamos immediately, status `CREATED` (URLs populated).
- **`subject` is REQUIRED.** It's both the timetable label AND the auto-grouping key for recordings: when the Streamos webhook lands, the best-quality MP4 is filed into the `VideoCategory` folder whose `subjectKey` matches `normalize(subject)` under each linked live course. If no such folder exists yet, **one is auto-created** (title = the admin's subject as typed, `image: null` — admin can set the image later). Folders dedupe across casing/whitespace ("Maths" / "maths" / " Maths " → same folder).
- `educatorId` / `endAt` are optional timetable metadata.

> **Removed:** `recordingTargetFolderId` is gone. Admins no longer pick a folder id; the system resolves the folder from `subject`.

`data`: `{ session }` `201`.

### `GET /admin/live-sessions` — list
Query: `status`, `upcoming=true`, `page`, `limit`. `data`: `{ sessions, total, page, limit }`

### `GET /admin/live-sessions/:id` — detail + status
Polls Streamos for `CREATED`/`ENDED` sessions (refreshes URLs, recovers missed
recordings). `data`: `{ session, isLive, promotedVideos }` — `promotedVideos`
is `Video.find({ liveSessionId: <session._id> })` across **all folders and
courses**, sorted by creation (not scoped to any single folder).

### `POST /admin/live-sessions/:id/start` — promote SCHEDULED → live
Only allowed within 2 minutes of `scheduledAt` (late starts always allowed).
Calls Streamos. `data`: `{ session }`.

### `PATCH /admin/live-sessions/:id` — edit a SCHEDULED session
Body (any subset): `{ title?, scheduledAt?, liveCourseIds?, subject?, endAt?, educatorId? }`.
`subject` cannot be cleared (it's the recording grouping key) but can be changed.
Only `SCHEDULED` sessions are editable. `data`: `{ session }`.

### `DELETE /admin/live-sessions/:id`
Refuses (`409`) a currently-live `CREATED` session — end it first. `SCHEDULED`, `ENDED`, and `READY` sessions can be deleted without restriction. `data`: `{ id }`

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
| GET | `/admin/live-sessions/streamos/org` | connected org info — returns `{ name, accessKey, recordingWebhook }` (the `accessSecret` is intentionally **not** leaked) |
| GET | `/admin/live-sessions/streamos/recordings/:recordingId` | passthrough — returns the raw Streamos uploaded-video response |
| POST | `/admin/live-sessions/streamos/webhook` | register the recording webhook URL — body `{ webhook: "https://..." }` |

> **Recording webhook security:** Streamos doesn't sign callbacks. Register the
> webhook URL with `?key=<STREAMOS_WEBHOOK_SECRET>` appended; the public
> `POST /client/webhook/recording` endpoint validates that secret.

---

## 7. Subscriptions

### `GET /admin/live-courses/subscriptions` — list (all)
Query (all optional): `customerId`, `liveCourseId`, `planId`,
`paymentStatus` (`pending`|`verified`|`failed`), `status` (`true`/`false`),
`page`, `limit`.
`data`: `{ subscriptions, total, page, limit }` with populated relations:
- `customerId` → `{ firstName, middleName, lastName, phoneNumber, emailAddress }`
- `liveCourseId` → `{ name, image }`
- `planId` → `{ name, duration, price }`

### `GET /admin/live-courses/:id/subscriptions` — list for one course
Same handler, pre-scoped by the path id.

### `GET /admin/live-courses/subscriptions/:subscriptionId` — detail
`data`: `{ subscription }`

### `POST /admin/live-courses/:id/grant` — free-grant (no payment)
Hand a customer an active, verified subscription with `paidAmount: 0`.

Body: `{ customerId, planId, durationMonths?, startAt?, endAt? }`
- `durationMonths` must be a **positive** integer when provided.
- `startAt` / `endAt` accept ISO date strings (parsed by `new Date(...)`).
- Window precedence (highest wins):
  1. explicit `endAt` →
  2. `startAt` + `durationMonths` →
  3. `startAt` + plan's `duration` →
  4. `now` + plan's `duration` (default).
- `409` if the customer already has an active subscription to this course —
  the existing `subscriptionId` is returned in the error envelope at
  **`messages.subscriptionId`** (not `data`). Use the update endpoint to
  extend instead.

The model also carries fields populated by other flows (not the grant endpoint):
`promocodeId`, `originalAmount`, `discountAmount`, `paidAmount`,
`razorpayOrderId`, `razorpayPaymentId`, `paidAt`. The grant endpoint sets
`paidAmount: 0` and leaves the Razorpay/promo fields empty.

`data`: `{ subscription }` `201`.

### `PUT /admin/live-courses/subscriptions/:subscriptionId` — extend / revoke
Body (≥1 field): `{ status?, paymentStatus?, startAt?, endAt? }`.
- Extend → set a later `endAt`.
- Revoke → `status: false` (keeps the audit trail — preferred over delete).
- `startAt` / `endAt` must be valid date strings; invalid input → `422 "must be a valid date"`.

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
