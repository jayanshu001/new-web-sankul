# Live Course — Admin (Live Streaming) API Integration Guide

Admin-side integration for the **live streaming** experience: schedule a class,
go live (RTMP or browser camera), moderate chat, run polls, watch attendance &
viewer count, end the stream, and file recordings into folders.

> Companion to [LIVE_COURSE_CLIENT_INTEGRATION.md](LIVE_COURSE_CLIENT_INTEGRATION.md).
> The customer-facing endpoints, the Socket.IO room contract, and the
> per-viewer 3-minute preview gate are documented there — this doc only covers
> what the admin UI needs.

---

## 1. Basics

**Base URL:** `{{URL}}/api/v1`

**Auth:** every endpoint here requires an **admin** Bearer token with role
`admin`, `super_admin`, or `editor`:

```
Authorization: Bearer <admin access token>
```

**Response envelope** — all `live-sessions` / `live-chat` / `live-polls`
endpoints use the standard wrapper:

```jsonc
{
  "success": true,
  "code": 200,
  "data": { /* the payload described per-endpoint below */ },
  "message": "Live session fetched.",
  "messages": {}
}
```

On error: `success: false`, a 4xx/5xx HTTP status, and a human `message`.

**The `liveClassId` everywhere = `String(streamId)`.** Once a session is
`CREATED`, its `streamId` (e.g. `"T_17787590328754"`) becomes the room id
for chat / polls / presence / camera ingest. Everything wires off the same
value.

---

## 2. Screen → endpoint map

| Admin screen | Endpoints |
|---|---|
| **Sessions list** (Scheduled / Live now / Ended / Ready) | `GET /admin/live-sessions` |
| **Create / schedule a session** | `POST /admin/live-sessions` |
| **Session detail page** (status + RTMP/HLS + promotedVideos) | `GET /admin/live-sessions/:id` |
| **"Start" button** on a scheduled session | `POST /admin/live-sessions/:id/start` |
| **Edit a scheduled session** | `PATCH /admin/live-sessions/:id` |
| **"End live" button** | `POST /admin/live-sessions/end` |
| **Delete a session** | `DELETE /admin/live-sessions/:id` |
| **Live Camera Overview** (browser → RTMP) | `WS /ws/camera-ingest?token=<adminToken>` |
| **Live Chat panel** (history + send as admin) | `GET /admin/live-chat/:liveClassId/history`, `POST /admin/live-chat/message` |
| **Polls panel** (create / close / edit / delete / results) | `/admin/live-polls/*` |
| **Attendance / viewers** | `GET /admin/live-sessions/:id/attendance` + socket `viewer_count` |
| **Recordings → promote to folder** | `POST /admin/live-sessions/:id/promote-recording` |
| **Streamos config** (org + webhook) | `/admin/live-sessions/streamos/*` |

---

## 3. Session lifecycle (read this first)

A `LiveSession` walks through four statuses:

```
SCHEDULED ──(start, within 2 min of scheduledAt)──▶ CREATED
                                                       │
   (admin creates immediately, no scheduledAt) ───────▶│
                                                       │
                                                       ▼
                                                     ENDED ──(Streamos webhook)──▶ READY
```

- **SCHEDULED** — row exists in our DB, no Streamos stream yet. Editable
  (`PATCH`), deletable, reminders fire client-side. **Cannot** be joined.
- **CREATED** — Streamos stream exists. `streamId`, `rtmpUrl`, `hlsUrl`,
  `hlsUrls` are populated. Customers can join, chat, vote on polls. Admin can
  push video (RTMP or `/ws/camera-ingest`). `canJoin` on the client is `true`.
- **ENDED** — admin called `POST /live-sessions/end` (or Streamos auto-ended).
  Player closes for viewers (via `live_session_ended` socket event). No
  recordings yet.
- **READY** — recording webhook from Streamos delivered `recordings[]`. The
  customer "previous live session" view starts showing the recording. If the
  webhook is missed, polling `GET /live-sessions/:id` performs recovery.

**`:id` accepts either the Mongo `_id` or the Streamos `streamId`** across
every detail/start/patch/delete/attendance/promote endpoint. Use whichever you
have on hand.

---

## 4. Sessions — CRUD & lifecycle

All under `/api/v1/admin/live-sessions`. Controller:
[src/admin/live/live.controller.ts](src/admin/live/live.controller.ts).

### `POST /admin/live-sessions` — create or schedule
Two modes — chosen by whether `scheduledAt` is in the future.

Body:
```jsonc
{
  "title": "Day 03 — વર્ગ & ઘન",
  "scheduledAt": "2026-05-20T09:00:00.000Z",   // optional; future = schedule, past/null = go live NOW
  "liveCourseIds": ["6a058c63ea69f98d3d42f382"],   // or "liveCourseId" (single)
  "subject": "Maths",                                // optional — timetable label
  "endAt": "2026-05-20T10:00:00.000Z",               // optional — for Schedule tab
  "educatorId": "6a05a8d8c818602bfbbe0ef5",          // optional
  "recordingTargetFolderId": "6a06..."               // optional — auto-promote on READY
}
```

`data` (201):
```jsonc
{
  "session": {
    "id": "...", "title": "...", "status": "SCHEDULED",   // or "CREATED" for immediate mode
    "liveCourseIds": [...],
    "subject": "...", "educatorId": "...", "endAt": "...",
    "recordingTargetFolderId": "...",
    "scheduledAt": "2026-05-20T09:00:00.000Z",            // null in immediate mode
    "streamId": null,                                      // string when CREATED
    "rtmpUrl": null, "hlsUrl": null, "hlsUrls": null,     // populated only when CREATED
    "recordings": [],
    "createdAt": "...", "updatedAt": "..."
  }
}
```

> **Rule:** `recordingTargetFolderId` is only valid when the folder belongs to
> one of the `liveCourseIds` you're attaching. A 422 is returned otherwise.

---

### `GET /admin/live-sessions` — list
Query: `status` (`SCHEDULED`|`CREATED`|`ENDED`|`READY`), `upcoming=true`
(SCHEDULED with `scheduledAt >= now`), `page`, `limit` (default 50, max 100).

`data`: `{ sessions: [Session], total, page, limit }`

Tabs in the admin sessions screen:
- **Scheduled** → `?status=SCHEDULED&upcoming=true`
- **Live now** → `?status=CREATED`
- **Ended (awaiting recording)** → `?status=ENDED`
- **Ready (with recordings)** → `?status=READY`

---

### `GET /admin/live-sessions/:id` — detail / status
This is the **Live Camera Overview** loader. For `CREATED` and `ENDED` sessions
the controller calls Streamos `streamDetails` to get a fresh `isLive` flag and
refresh HLS URLs. For `ENDED` sessions it also recovers recordings if the
webhook was missed.

`data`:
```jsonc
{
  "session": { /* same shape as POST */ },
  "isLive": true,                                    // Streamos live-ingest indicator
  "promotedVideos": [                                // every folder this session's recordings landed in
    { "_id": "...", "title": "...", "videoCategoryId": "...", "aws_id": "...",
      "priceType": "paid", "order": 0, "status": true, "createdAt": "..." }
  ]
}
```

**Build the overview from this payload:**
- Status pill ← `session.status` + `isLive`
- "Push from OBS / external encoder" panel ← `session.rtmpUrl` (split into URL + stream key as Streamos returns them — most encoders accept the full URL)
- Player preview ← `session.hlsUrl` (HLS.js)
- Quality switcher ← `session.hlsUrls` (`{ "240": ..., "480": ..., "720": ... }`)
- Recordings strip ← `session.recordings` (READY only)
- "Where did this recording end up?" badges ← `promotedVideos`

---

### `POST /admin/live-sessions/:id/start` — start a scheduled session
Promotes `SCHEDULED → CREATED` by calling Streamos. Allowed only within
**2 minutes** of `scheduledAt` (late starts always allowed; early starts are
blocked with `409` and `secondsRemaining` in the message).

`data`: `{ "session": Session }` — now with `streamId` / `rtmpUrl` / `hlsUrl(s)`.

---

### `PATCH /admin/live-sessions/:id` — edit (SCHEDULED only)
Editable: `title`, `scheduledAt`, `liveCourseIds` / `liveCourseId`,
`recordingTargetFolderId`, `subject`, `endAt`, `educatorId`.

`409` if the session isn't `SCHEDULED`. A `scheduledAt` change automatically
re-syncs every customer reminder (`syncRemindersForSession`).

---

### `POST /admin/live-sessions/end` — end the live stream
Body: `{ "streamId": "T_17787590328754" }`

Side-effects:
- Streamos `endStream` is called.
- Session status → `ENDED`.
- Socket event **`live_session_ended`** is broadcast to the room — viewer
  players auto-close and chat/poll input is disabled.
- Any still-open `LiveSessionAttendance` rows are closed with `durationSec` set.

`data`: `{ "streamId": "...", "status": "ENDED" }`

---

### `DELETE /admin/live-sessions/:id`
`409` if `status === "CREATED"` (end it first). On success, cancels every
reminder + pending notification job for the session.

---

### `GET /admin/live-sessions/:id/attendance` — who watched
One row per join → leave stint. Rows with `leftAt: null` are still in the room.

`data`:
```jsonc
{
  "attendance": [
    {
      "_id": "...",
      "customerId": { "_id": "...", "firstName": "...", "middleName": "", "lastName": "...", "phoneNumber": "..." },
      "streamId": "T_177...",
      "joinedAt": "...", "leftAt": "...", "durationSec": 1432
    }
  ],
  "summary": { "totalJoins": 142, "uniqueViewers": 88, "currentlyActive": 37 }
}
```

For **realtime** viewer count during the live class, don't poll this endpoint
— subscribe to the socket `viewer_count` event (§7).

---

## 5. Going live from the browser camera

When the admin doesn't want to set up OBS, they can broadcast directly from
the laptop camera. The flow is: `getUserMedia` → `MediaRecorder` (WebM) →
binary WebSocket frames → server runs **ffmpeg** → RTMP to Streamos.

Source: [src/socket/camera-ingest.ts](src/socket/camera-ingest.ts).

### Connecting

```
WSS {{API origin}}/ws/camera-ingest?token=<adminAccessToken>
```

- Admin JWT must be valid AND match the active session in Redis (one-device
  rule, same as REST `authenticate` middleware).
- Server responds with a JSON text frame on connect:
  `{ "type": "ready", "ffmpeg": true, "message": "..." }`.
  If `ffmpeg: false`, the server host is missing the binary — show an error
  and abort.

### Control protocol

| Direction | Frame | Payload |
|---|---|---|
| client → server | text JSON | `{ "type": "start", "streamId": "T_177..." }` |
| client → server | text JSON | `{ "type": "stop" }` |
| client → server | binary | a `MediaRecorder` chunk (WebM/VP8+Opus, ~1s slices) |
| server → client | text JSON | `{ "type": "ready", "ffmpeg": true }` (on connect) |
| server → client | text JSON | `{ "type": "started", "streamId": "..." }` |
| server → client | text JSON | `{ "type": "stopped", "code": 0 }` |
| server → client | text JSON | `{ "type": "error", "message": "..." }` |

**Pre-requisites the server enforces on `start`:**
- A session with that `streamId` must exist.
- `status` must be `CREATED` (not SCHEDULED, ENDED, or READY).
- The session must have a non-empty `rtmpUrl`.

### Minimal browser snippet

```js
const ws = new WebSocket(
  `wss://api.websankul.com/ws/camera-ingest?token=${adminToken}`
);
ws.binaryType = "arraybuffer";

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return;
  const msg = JSON.parse(ev.data);
  if (msg.type === "ready" && msg.ffmpeg) {
    ws.send(JSON.stringify({ type: "start", streamId }));
  } else if (msg.type === "error") {
    console.error(msg.message);
  }
};

const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
rec.ondataavailable = (e) => { if (e.data.size > 0) ws.send(e.data); };
rec.start(1000);                                       // 1s timeslice

// Later, to stop:
rec.stop();
ws.send(JSON.stringify({ type: "stop" }));
ws.close();
```

> Closing the socket also stops the broadcast — ffmpeg's stdin closes and it
> exits cleanly within a 2s flush window. You don't strictly need to send
> `stop` if you're tearing the page down.

---

## 6. Live Chat — admin panel

REST controller: [src/admin/livechat/livechat.controller.ts](src/admin/livechat/livechat.controller.ts).

### `POST /admin/live-chat/message` — send as admin
Body: `{ "liveClassId": "T_177...", "message": "..." }` (≤ 2000 chars)

The message is persisted with `isAdmin: true` and **broadcast as the
`new_message` socket event** to every viewer in the room. The admin's display
name is `firstName + lastName` (falling back to email, then `"Admin"`).

`data`:
```jsonc
{
  "message": {
    "_id": "...", "liveClassId": "T_177...", "adminId": "...",
    "isAdmin": true, "userName": "Pratik Z.", "message": "Welcome 👋",
    "createdAt": "..."
  }
}
```

`404` if no session exists for that `liveClassId`.

### `GET /admin/live-chat/:liveClassId/history` — paginated history
Query: `limit` (default 50, max 100), `before` (ISO date — fetch older).

Returned in chronological order (oldest → newest, ready to append-render):

```jsonc
{
  "messages": [
    { "_id": "...", "customerId": "...", "isAdmin": false, "userName": "Riya P.", "message": "Hi", "createdAt": "..." },
    { "_id": "...", "adminId": "...",    "isAdmin": true,  "userName": "Admin",   "message": "Welcome",   "createdAt": "..." }
  ],
  "total": 50
}
```

> **Realtime updates during the class:** the admin REST channel only sends
> messages — it doesn't *receive* new ones. To see student messages live,
> the admin UI should also open a Socket.IO connection to the same room (see
> §7). There's currently no admin socket namespace — connect with a customer
> Socket.IO client using the **customer JWT for the admin's linked customer
> account**, or just refresh the history endpoint on a timer. (See "Gaps" in §10.)

> **Moderation:** there's no delete-message / mute-user endpoint today. If you
> need it for the admin UI, flag it and we'll add it.

---

## 7. Polls — admin panel

REST controller: [src/admin/livepoll/livepoll.controller.ts](src/admin/livepoll/livepoll.controller.ts).

Every mutation also broadcasts a Socket.IO event to the room so the student UI
updates without polling.

### `POST /admin/live-polls` — create
Body: `{ "liveClassId": "T_177...", "question": "...", "options": ["A","B","C"] }`
(2–6 options, each non-empty)

Side-effect: if a poll is already active in the same room, it's auto-closed
first (emits `poll_closed` for the old one). The new poll emits **`poll_created`**.

`data`:
```jsonc
{
  "poll": {
    "_id": "...", "liveClassId": "T_177...",
    "question": "Did you understand 변/ઘન?",
    "options": [{ "text": "Yes", "votes": 0 }, { "text": "Need revision", "votes": 0 }],
    "totalVotes": 0,
    "createdByName": "Pratik Z.", "createdAt": "..."
  }
}
```

### `GET /admin/live-polls/:liveClassId` — list polls for a class
Query: `page`, `limit` (default 20, max 50). Sorted newest-first.

`data`: `{ polls: [...], total, page, limit }` — each row includes
`question`, `options` (with vote counts), `totalVotes`, `isActive`,
`createdByName`, `createdAt`, `closedAt`.

### `PATCH /admin/live-polls/:pollId` — edit
Body: `{ "question"?, "options"? }`. Allowed **only if `totalVotes === 0`**
(otherwise `400`). Resets options' vote counts to 0 if `options` is supplied.
Emits **`poll_updated`** so the student card re-renders.

### `PATCH /admin/live-polls/:pollId/close`
Marks the poll inactive, sets `closedAt`, emits **`poll_closed`**. Students
stop accepting votes.

### `DELETE /admin/live-polls/:pollId`
Deletes the poll and every `LivePollVote` for it. Emits **`poll_deleted`** so
the student card disappears. (Use this — not close — when a poll was created
by mistake.)

### `GET /admin/live-polls/:pollId/results`
`data`:
```jsonc
{
  "poll": {
    "_id": "...", "liveClassId": "T_177...", "question": "...",
    "options": [{ "text": "Yes", "votes": 42 }, ...],
    "totalVotes": 88, "isActive": false,
    "createdByName": "...", "createdAt": "...", "closedAt": "..."
  },
  "voterCount": 88                       // distinct voters (matches totalVotes today; defensive)
}
```

---

## 8. Socket.IO — admin live dashboard

The chat/poll/presence room runs on the **same** Socket.IO server documented
in §6 of the client guide. There's no admin-specific namespace today — admin
REST controllers do the broadcasting; admins who want to *see* the live feed
join the room as a Socket.IO client.

### What admin broadcasts emit (server → room)

| Trigger | Event | Payload |
|---|---|---|
| `POST /admin/live-chat/message` | `new_message` | `{ _id, liveClassId, adminId, isAdmin: true, userName, message, createdAt }` |
| `POST /admin/live-polls` | `poll_created` | `{ poll }` |
| `PATCH /admin/live-polls/:pollId` | `poll_updated` | `{ poll }` |
| `PATCH /admin/live-polls/:pollId/close` | `poll_closed` | `{ pollId }` |
| `DELETE /admin/live-polls/:pollId` | `poll_deleted` | `{ pollId }` |
| `POST /admin/live-sessions/end` | `live_session_ended` | `{ streamId, liveClassId, status: "ENDED", endedAt }` |
| Recording webhook from Streamos | `recordings_ready` | `{ streamId, liveClassId, status: "READY", recordings }` |

### Events the admin dashboard should subscribe to
Connect to the room as documented in §6 of the client guide (`join_live_chat`
with `liveClassId`) and bind:

- `chat_history` on join — seed the chat pane (last 50 messages).
- `new_message` — append every student/admin message in realtime.
- `viewer_count` — live "👀 N watching" badge in the dashboard header.
- `user_joined` / `user_left` — optional toast feed of who's joining/leaving.
- `poll_update` — bump vote counts on the active poll card without refetching.
- `active_poll` on join — re-display a poll that's already running.
- `live_session_ended` / `recordings_ready` — flip the dashboard from "live"
  to "ended" to "recording ready" states.

> Current limitation: the Socket.IO server only accepts **customer** tokens
> on connect. Until an admin auth branch is added there, the admin dashboard
> either (a) polls REST history + attendance, or (b) connects with a customer
> token. See §10.

---

## 9. Recordings — promote into folders

When Streamos finishes processing the recording it POSTs to our public
webhook (`POST /api/v1/client/webhook/recording`, secured by
`STREAMOS_WEBHOOK_SECRET`). That handler:
1. Saves `recordings[]` on the session and flips status to `READY`.
2. Emits `recordings_ready` to the room.
3. If `recordingTargetFolderId` was set when the session was created/edited,
   auto-promotes the best-quality recording into that folder as a `Video`.

For everything else, the admin promotes manually:

### `POST /admin/live-sessions/:id/promote-recording`
Body:
```jsonc
{
  "folderId": "6a06...",          // any VideoCategory — live OR recorded course
  "recordingIndex": 0,             // OR
  "quality": "720p",               // (omit both → best quality is picked)
  "title": "...",                  // optional override
  "priceType": "paid",            // "free" | "paid" — defaults follow folder/course
  "order": 0                       // optional sort key
}
```

`data` (201 on create, 200 on re-promote):
```jsonc
{
  "video": { /* full Video doc — includes liveSessionId back-link */ },
  "alreadyExisted": false
}
```

Idempotent per folder — re-calling for the same `(session, folder, recording)`
returns the existing Video. The created Video carries
`liveSessionId: session._id` so it stays traceable from the
`GET /admin/live-sessions/:id` → `promotedVideos[]` panel.

---

## 10. Streamos org & webhook

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/live-sessions/streamos/org` | Verify connected Streamos org (returns `name`, `accessKey`, `recordingWebhook`). `accessSecret` is intentionally stripped. |
| `POST` | `/admin/live-sessions/streamos/webhook` | Register / update the recording webhook URL (body: `{ "webhook": "https://your-host/api/v1/client/webhook/recording?key=<STREAMOS_WEBHOOK_SECRET>" }`). |
| `GET` | `/admin/live-sessions/streamos/recordings/:recordingId` | Look up a single past recording's details from Streamos (used to inspect a recording from the Streamos dashboard). |

> The webhook URL **must** include the `?key=<STREAMOS_WEBHOOK_SECRET>` query
> param in production — without it the handler would either reject (when the
> secret is set) or accept-with-warning (when unset). Keep it set in prod.

---

## 11. Suggested Admin UI — screen blueprint

A reference layout for the admin "Live Console" — every panel here is wired
to one or more of the endpoints/events above. Modelled on the working test
harness in [docs/live-course-demo.html](live-course-demo.html) (sections
**6, 6b, 6c, 6d, 6e**), which is the ground truth — open it for a working
implementation of the camera preview, chat, polls, and session create flow.

### 11.1 Page layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Live Console            [● LIVE | ⏸ SCHEDULED | ◼ ENDED | ✓ READY]       │ ← session header
│ "Day 03 — વર્ગ & ઘન"           👤 37 watching    🕒 23:14 elapsed         │
├──────────────────────────────┬───────────────────────────────────────────┤
│ A. Camera preview / player   │ C. Live Chat                              │
│  ┌──────────────────────┐    │  ┌───────────────────────────────────┐    │
│  │  <video> 16:9        │    │  │  Riya P.   Hi sir 👋               │    │
│  │  (getUserMedia OR    │    │  │  Admin     Welcome everyone        │    │
│  │   HLS playback)      │    │  │  Karan T.  Audio is low           │    │
│  └──────────────────────┘    │  └───────────────────────────────────┘    │
│  [Enable camera] [▶ Start    │  [type as admin…………………] [Send] [↻]      │
│   broadcast] [■ Stop]        │  ☐ auto-refresh 3s                        │
│  RTMP URL: rtmp://…  📋      │                                           │
│  Stream key: …       📋      │                                           │
├──────────────────────────────┤ D. Polls                                  │
│ B. Session controls          │  ┌───────────────────────────────────┐    │
│  Status: CREATED · isLive ✓  │  │ ACTIVE · "Did you understand?"    │    │
│  Scheduled: 09:00            │  │   Yes ████████░░ 42               │    │
│  Course(s): GPSC Maths       │  │   No  ███░░░░░░░ 12   [Close]     │    │
│  Recording target: Subjects/ │  └───────────────────────────────────┘    │
│   Maths/Day 03               │  ┌ New poll ───────────────────────┐      │
│  [▶ Start] [■ End] [✎ Edit]  │  │ Q: …………                          │     │
│  [🗑 Delete]                  │  │ Opt 1 … Opt 2 … Opt 3 … Opt 4 … │     │
│                              │  │              [＋ Create poll]    │     │
│ E. Viewers                   │  └─────────────────────────────────┘     │
│  37 active · 88 unique       │ F. Recordings (READY only)                │
│  142 total joins             │  ┌ 720p · 412 MB ────── [Promote ▾]┐      │
│  [📋 Full attendance →]      │  │ 480p · 268 MB ────── [Promote ▾]│      │
│                              │  └ Filed → "Subjects / Maths / D3" ┘      │
└──────────────────────────────┴───────────────────────────────────────────┘
```

### 11.2 Panel → endpoints / events

| Panel | What it shows | REST | Socket events |
|---|---|---|---|
| **Header** | title, status pill, viewer badge, elapsed timer | `GET /admin/live-sessions/:id` (status + isLive) | `viewer_count`, `live_session_ended`, `recordings_ready` |
| **A. Camera preview / player** | local camera (or HLS preview when ingesting from OBS), RTMP URL + stream key, ffmpeg state | `GET /admin/live-sessions/:id` (rtmpUrl, hlsUrl, hlsUrls) | `WS /ws/camera-ingest` — `ready` / `started` / `stopped` / `error` |
| **B. Session controls** | create / schedule / start / patch / end / delete | `POST` `/admin/live-sessions`, `POST :id/start`, `POST /end`, `PATCH :id`, `DELETE :id` | — |
| **C. Live Chat** | rolling message list + "send as admin" composer | `GET /admin/live-chat/:liveClassId/history`, `POST /admin/live-chat/message` | `new_message` (subscribe for student messages) |
| **D. Polls** | active poll card + create form + history list | `POST /admin/live-polls`, `PATCH :pollId/close`, `PATCH :pollId`, `DELETE :pollId`, `GET /admin/live-polls/:liveClassId`, `GET /admin/live-polls/:pollId/results` | `poll_update` (live vote counts) |
| **E. Viewers** | live counter + summary + "open attendance" drawer | `GET /admin/live-sessions/:id/attendance` | `viewer_count`, `user_joined`, `user_left` |
| **F. Recordings** | recording list (READY) + per-row "Promote to folder" + landed-in badges | `POST /admin/live-sessions/:id/promote-recording`; landed videos via `promotedVideos[]` on `GET /admin/live-sessions/:id` | `recordings_ready` (flip from ENDED → READY) |

### 11.3 Suggested component breakdown

- `<SessionHeader sessionId>` — status pill (binds to `session.status` +
  `isLive`), viewer badge (`viewer_count`), elapsed timer (counts from
  `session.updatedAt` when `status === "CREATED"`).
- `<CameraPanel sessionId>` — three modes:
  - **Browser camera**: `getUserMedia` → `MediaRecorder(timeslice=1000)` →
    binary frames on the `/ws/camera-ingest` socket. State machine:
    `idle → connecting → ready → broadcasting → stopped|error`. The
    "Enable camera" / "Start broadcast" / "Stop broadcast" buttons in
    [live-course-demo.html](live-course-demo.html) §6e are the working
    reference.
  - **External encoder (OBS)**: show `rtmpUrl` with a 📋 copy button + a
    "View preview" HLS player loading `session.hlsUrl`.
  - **Player preview** (when ENDED/READY): HLS.js on `session.hlsUrl` with a
    quality switcher built from `session.hlsUrls`.
- `<SessionControls sessionId>` — wraps create/schedule/start/patch/end/
  delete. The "Start" button must respect the 2-minute window (the API will
  `409` outside it; pre-disable client-side and show a countdown).
- `<LiveChatPanel liveClassId>` — message list (virtualized if long),
  composer with 2000-char limit, optional 3s polling toggle (since the admin
  side isn't on the socket yet — see §10).
- `<PollPanel liveClassId>` — active poll card (with **Close** + **Delete**
  + per-option live bars), poll-creation form (2–6 options), history list
  with results.
- `<ViewerPanel sessionId>` — live counter from `viewer_count`, summary
  numbers from attendance, a "Full attendance" drawer that opens the
  paginated table.
- `<RecordingsPanel sessionId>` — only renders when `status === "READY"`.
  Each row has a **Promote to folder** picker (folder dropdown scoped to the
  session's `liveCourseIds`) → `POST /:id/promote-recording`. Show the
  `promotedVideos[]` as "✓ Filed into …" chips so the admin can see at a
  glance where each recording landed.

### 11.4 State machine for the page

```
SCHEDULED   → show B (controls) + D-poll-history; hide A/C/E/F.
              [▶ Start] visible only inside 2-min window.
CREATED     → all panels live. A shows camera/RTMP. C/D/E poll/socket-driven.
              [■ End] is the primary action.
ENDED       → A becomes "Stream ended" placeholder. C/D switch to read-only
              history. E shows final summary. F: spinner "waiting for
              recording…" (driven by `recordings_ready` socket event).
READY       → F lights up with recordings. A switches to HLS playback of the
              promoted recording. C/D stay read-only.
```

### 11.5 What the demo HTML already does (reuse it!)

[docs/live-course-demo.html](live-course-demo.html) is a single-file working
harness that already implements every admin flow:

| Demo section | What it implements | Mirror to |
|---|---|---|
| **6 — Admin login & create session** | admin OTP-less login + course picker + create/schedule | `<SessionControls>` create mode |
| **6b — Admin Sessions** | session list with `▶ Start` / `■ End` | `<SessionControls>` + sessions list page |
| **6c — Admin Chat** | post as admin, paginated history, 3s auto-refresh toggle | `<LiveChatPanel>` |
| **6d — Admin Polls** | create / refresh / close, per-poll counts | `<PollPanel>` |
| **6e — Go live from camera** | full `getUserMedia` → MediaRecorder → `/ws/camera-ingest` flow with preview `<video>` and start/stop buttons | `<CameraPanel>` browser-camera mode |

When in doubt about wiring, open that file and copy the handler verbatim —
it's the canonical client of every endpoint and socket event listed above.

---

## 12. Gaps to be aware of

The client doc and this admin doc cover everything that exists today, but a
production admin UI will probably want:

1. **Admin Socket.IO auth path** — the live-chat socket today only accepts
   customer JWTs. Until it accepts admin tokens, the admin chat panel either
   polls REST history or piggy-backs on a customer connection.
2. **Chat moderation endpoints** — no delete-message, edit-message, mute-user,
   or shadow-ban. Easy adds when needed.
3. **Realtime viewer-count REST endpoint** — only available as the
   `viewer_count` socket event; attendance API is post-hoc.
4. **Stream health** (bitrate / dropped frames / encoder warnings) is not
   exposed — Streamos has it on their dashboard.
5. **Delete a Streamos recording** — not exposed; happens upstream only.

---

## 13. Quick reference

| Method | Path | Purpose |
|---|---|---|
| POST   | `/admin/live-sessions` | Create or schedule a session |
| GET    | `/admin/live-sessions` | List (filter by `status` / `upcoming`) |
| GET    | `/admin/live-sessions/:id` | Detail + isLive + promotedVideos |
| POST   | `/admin/live-sessions/:id/start` | Start a SCHEDULED session |
| PATCH  | `/admin/live-sessions/:id` | Edit (SCHEDULED only) |
| DELETE | `/admin/live-sessions/:id` | Delete (not while CREATED) |
| POST   | `/admin/live-sessions/end` | End the active live stream |
| GET    | `/admin/live-sessions/:id/attendance` | Per-stint join/leave + summary |
| POST   | `/admin/live-sessions/:id/promote-recording` | File a recording into a folder |
| GET    | `/admin/live-sessions/streamos/org` | Verify Streamos org |
| POST   | `/admin/live-sessions/streamos/webhook` | Register recording webhook |
| GET    | `/admin/live-sessions/streamos/recordings/:recordingId` | Inspect a past recording |
| POST   | `/admin/live-chat/message` | Send a message as admin |
| GET    | `/admin/live-chat/:liveClassId/history` | Paginated chat history |
| POST   | `/admin/live-polls` | Create poll (auto-closes prior active) |
| GET    | `/admin/live-polls/:liveClassId` | List polls for a class |
| PATCH  | `/admin/live-polls/:pollId` | Edit poll (only if 0 votes) |
| PATCH  | `/admin/live-polls/:pollId/close` | Close poll |
| DELETE | `/admin/live-polls/:pollId` | Delete poll + its votes |
| GET    | `/admin/live-polls/:pollId/results` | Poll results + voter count |
| WS     | `/ws/camera-ingest?token=<adminToken>` | Browser-camera → RTMP bridge |
