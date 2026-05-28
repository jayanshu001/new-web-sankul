# Frontend Integration Guide — Livestreams & Recordings

Audience: Client (web/mobile) frontend developers integrating live courses, live sessions, in-stream chat/polls, and post-stream recordings.

All endpoints below are prefixed with `/api/v1/client`. Unless marked `Public`, every endpoint requires `Authorization: Bearer <token>`.

---

## 1. Concepts

### 1.1 Status lifecycle of a `LiveSession`

| Status | Meaning | What's available |
|---|---|---|
| `SCHEDULED` | On the timetable, stream not yet provisioned | Metadata only (title, scheduledAt) |
| `CREATED` | Stream is live on Streamos | `hlsUrl`, `hlsUrls`, `isLive=true`, `canJoin=true` |
| `ENDED` | Admin ended the stream, recording is being processed | `hlsUrl` may still resolve briefly; `recordings[]` not yet populated |
| `READY` | Streamos webhook fired, MP4 recordings stored | `recordings[]` populated with multi-quality MP4 URLs |

The frontend should always switch playback source based on `status`:

- `CREATED` → play `hlsUrl` (live HLS).
- `READY` → pick a quality from `recordings[]` and play the MP4.
- `ENDED` (transient) → show "Recording is being processed" placeholder; subscribe to the `recordings_ready` socket event to switch automatically.

### 1.2 Entitlement model

The session detail endpoint gates playback by purchase:

- Non-subscribers get a **3-minute preview** (`accessLevel: "preview"`, `previewSecondsRemaining`).
- After 3 minutes a non-subscriber gets `accessLevel: "preview_ended"` and `purchaseOptions[]` is returned for the upsell.
- Subscribers get `accessLevel: "full"` and full playback URLs.

---

## 2. Discovery — Listing Live Courses & Sessions

### `GET /live-courses`
List all active live courses (paginated). Hero card metadata, purchase counts.

### `GET /live-courses/my`
Customer's owned live-course subscriptions (verified payment, active, not expired). Includes `plan`, `daysLeft`.

### `GET /live-courses/:id`
Live course detail page. Plans with `discountPercent`, `subscribed` flag, `daysLeft`, `stats` (subjectsCount, materialsCount).

### `GET /live-courses/upcoming-sessions`
Cross-course discovery feed of all `SCHEDULED` sessions. Each row carries `subscribed` and `canJoin`.

### `GET /live-courses/live-now-sessions`
Cross-course feed of sessions currently airing (`status=CREATED`).

### `GET /live-courses/:id/sessions`
All sessions for a course. Playback URLs are intentionally **not** included — fetch them per-session via `/live-sessions/:id` when the user taps in.

Query params:
- `?upcoming=true` — only `SCHEDULED` with `scheduledAt >= now`.
- `?status=SCHEDULED|CREATED|ENDED|READY`.

Per-row fields: `hasRecordings`, `canJoin`.

---

## 3. Watching a Live Session

### `GET /live-sessions/:id`
Single source of truth for "what should I render right now?". `:id` accepts both the Mongo `_id` and the Streamos `streamId`.

Response (key fields):

```json
{
  "id": "...",
  "title": "...",
  "status": "CREATED",
  "streamId": "T_17787583234029",
  "liveClassId": "...",
  "isLive": true,
  "canJoin": true,
  "hlsUrl": "https://.../playlist.m3u8",
  "hlsUrls": { "240": "...", "360": "...", "480": "...", "720": "..." },
  "recordings": [],
  "accessLevel": "full",
  "previewSecondsRemaining": null,
  "purchaseOptions": [],
  "scheduledAt": "...",
  "liveCourseIds": ["..."]
}
```

Recommended flow when user opens a session:

1. Call this endpoint.
2. If `status === "CREATED"` and `canJoin`, mount the HLS player on `hlsUrl` (or pick a rung from `hlsUrls`).
3. Open the Socket.IO connection and join `liveClassId` (see §4).
4. If `status === "READY"`, switch to MP4 playback from `recordings[]` (see §5).
5. If `status === "ENDED"`, show "processing" and wait for the `recordings_ready` socket event (or re-fetch this endpoint when the user retries).
6. If `accessLevel !== "full"`, render the preview countdown using `previewSecondsRemaining` and the paywall using `purchaseOptions[]`.

---

## 4. Live Chat & Polls (Socket.IO)

Connect to the same origin with the customer Bearer token. Then `emit("join_live_chat", { liveClassId })`.

**Room:** `live_chat:{streamId}` — joined automatically via `join_live_chat`.

### Client → Server events

| Event | Payload | Purpose |
|---|---|---|
| `join_live_chat` | `{ liveClassId }` | Join room, start attendance tracking |
| `send_message` | `{ liveClassId, message }` | Send a chat message |
| `submit_vote` | `{ pollId, optionIndex }` | Vote on the active poll |
| `leave_live_chat` | `{ liveClassId }` | Leave room |

### Server → Client events

| Event | Payload | When |
|---|---|---|
| `chat_history` | `{ liveClassId, messages[] }` | Sent on join (last 50) |
| `new_message` | `{ _id, liveClassId, customerId, userName, message, createdAt }` | Each new chat message |
| `user_joined` | `{ liveClassId, customerId, userName, joinedAt }` | Someone joined |
| `user_left` | `{ liveClassId, customerId, userName, leftAt }` | Someone left |
| `viewer_count` | `{ liveClassId, count }` | Distinct viewer count changed |
| `active_poll` | `{ poll, myVote }` | Sent on join if a poll is open |
| `poll_update` | `{ pollId, options[], totalVotes }` | Vote tally changed |
| `recordings_ready` | `{ streamId, liveClassId, status: "READY", recordings[] }` | **Recordings are available — switch to MP4** |
| `live_session_ended` | `{ streamId, liveClassId, status: "ENDED", endedAt }` | Admin ended the stream |
| `chat_banned` | `{ message, reason }` | This user was globally banned |
| `chat_unbanned` | `{ message, unbannedAt }` | Ban lifted |

### Supporting REST endpoints

- `GET /live-chat/:liveClassId/history?limit=50&before=<ISO>` — Paginated chat history.
- `GET /live-chat/ban-status` — `{ banned, reason }` for the current user.
- `GET /live-polls/:liveClassId/active` — Active poll (if any), with vote counts.

---

## 5. Recordings (After a Live Session Ends)

There are two flavors of "recording" the frontend cares about:

### 5.1 Raw recordings on the LiveSession

Once status is `READY`, `GET /live-sessions/:id` returns:

```json
"recordings": [
  { "quality": "720p", "file_size": null, "path": "https://stream-os-assets.classx.co.in/.../master-....m3u8" },
  { "quality": "480p", "file_size": null, "path": "https://stream-os-assets.classx.co.in/.../master-....m3u8" },
  { "quality": "360p", "file_size": null, "path": "https://.../master-....m3u8" },
  { "quality": "240p", "file_size": null, "path": "https://.../master-....m3u8" }
]
```

Notes on the real-world shape:

- **`path` is an HLS playlist (`.m3u8`) in practice.** The Streamos RTMP doc describes `path` as an MP4 URL, but the service actually delivers HLS master playlists. Use an HLS-capable player (hls.js, AVPlayer, ExoPlayer).
- **`quality` labels use the `"p"` suffix** — `"720p"`, `"480p"`, etc. (Match case-insensitively.)
- **`file_size` is frequently `null`** when the source is HLS — don't rely on it for UI.
- **Suggested quality preference order:** `1080p → 720p → 480p → 360p → 240p → 144p`. Pick the first one present and play `path` directly.
- **Known upstream quirk:** the `"720p"` entry may point to a 480p playlist (Streamos data issue, not ours). If you build a quality picker, label it from `quality` but don't assume the underlying rendition matches.

### 5.2 Promoted recordings (organized into the course library)

The admin pipeline can auto-promote a session's best recording into a folder under the live course. These appear as proper `Video` documents and use the encrypted playback envelope.

- `GET /live-courses/:id/recordings` — Folder tree + lectures. For each lecture: `recordings[]` (multi-quality MP4 list), `progress` (positionSec, durationSec, completed, lastWatchedAt). `videoUrl`/`recordings` are omitted for non-subscribers unless `priceType=free`.
- `GET /live-courses/:id/session-recordings?page=1&limit=50` — Live + upcoming sessions list (NOT past — those move into `/recordings`). Each row carries `isLive`.
- `GET /live-courses/:id/lecture/:videoId` — Single lecture playback. Returns the standard encrypted envelope:

```json
{
  "request": {
    "files": {
      "token": "...",
      "hls": { "default_cdn": "primary", "cdns": { "primary": { "url": "..." } } },
      "progressive": [
        { "qualityLabel": "720p", "quality": "720", "height": 720, "url": "...", "bitrate": 2500000, "hasAudio": true, "hasVideo": true }
      ]
    }
  }
}
```

Frontends should use the same player used elsewhere for `/v1/lecture` — the shape is identical.

---

## 6. Schedules

- `GET /live-courses/:id/schedule?upcoming=true` — Timetable for the course (derived from `LiveSession`s + admin schedule folders). Not gated — used on the public detail page.
- `GET /live-courses/my/schedule` — Home-screen grouped schedule across the user's owned courses.
- `GET /live-courses/:id/schedule-folders/:folderId` — Folder entries (date/subject/time). Requires active subscription.

---

## 7. Reminders

- `POST /live-reminders` — body `{ liveSessionId }`.
- `GET /live-reminders` — list current user's reminders.
- `GET /live-reminders/session/:liveSessionId` — is a reminder set?
- `DELETE /live-reminders/:liveSessionId` — remove.

---

## 8. Webhook (informational only — NOT called by frontend)

`POST /api/v1/client/webhook/recording` is the Streamos → backend callback. It is secret-authenticated (`x-webhook-secret` header / `?key=`) and only Streamos ever calls it. When it fires, the backend:

1. Strips trailing-quote artifacts (`"`, `%22`, `%2522`) from each `recordings[].path` — Streamos has been known to ship paths with a stray trailing quote that would otherwise 404 in the player.
2. Saves `recordings[]` to the LiveSession and sets `status = READY`.
3. Emits `recordings_ready` to `live_chat:{streamId}` over Socket.IO.
4. Optionally promotes the best recording into a course folder.

Frontend implication: **subscribe to `recordings_ready` to switch from "processing" to MP4 playback without polling.**

---

## 9. Putting It All Together — Recommended UX Flows

### A. User taps an upcoming session
1. `GET /live-sessions/:id` → expect `status: "SCHEDULED"`, `canJoin: false`.
2. Show countdown to `scheduledAt`. Offer reminder via `POST /live-reminders`.

### B. User joins a live session
1. `GET /live-sessions/:id` → `status: "CREATED"`, `canJoin: true`, `hlsUrl` present.
2. Mount HLS player on `hlsUrl`.
3. Connect Socket.IO, `emit("join_live_chat", { liveClassId })`.
4. Render chat from `chat_history` + `new_message` stream, viewer count from `viewer_count`, polls from `active_poll` / `poll_update`.
5. On `live_session_ended` event → swap to "Recording is being processed" placeholder.
6. On `recordings_ready` event → swap player source to the best MP4 from `recordings[]`.

### C. User taps a past session
1. `GET /live-sessions/:id`.
2. If `status: "READY"` → play best MP4 from `recordings[]`.
3. If the session was promoted into the course library, the same recording is also available via `GET /live-courses/:id/recordings` → `GET /live-courses/:id/lecture/:videoId` (encrypted envelope, with progress tracking).

### D. Course library / "My Courses"
1. `GET /live-courses/my` for the user's purchased courses.
2. Per course: `GET /live-courses/:id/recordings` for the folder/lecture tree.
3. For each lecture played: `GET /live-courses/:id/lecture/:videoId` and feed the encrypted envelope into the standard player.

---

## 10. Quick Reference — Endpoint Index

| Method | Path | Purpose |
|---|---|---|
| GET | `/live-courses` | List active live courses |
| GET | `/live-courses/my` | My subscriptions |
| GET | `/live-courses/:id` | Course detail |
| GET | `/live-courses/upcoming-sessions` | All upcoming sessions |
| GET | `/live-courses/live-now-sessions` | Currently-live sessions |
| GET | `/live-courses/:id/sessions` | Sessions of a course |
| GET | `/live-courses/:id/recordings` | Promoted recordings (folder tree) |
| GET | `/live-courses/:id/session-recordings` | Live/upcoming sessions for course |
| GET | `/live-courses/:id/lecture/:videoId` | Encrypted playback envelope |
| GET | `/live-courses/:id/schedule` | Course timetable |
| GET | `/live-courses/my/schedule` | Home-screen schedule |
| GET | `/live-courses/:id/schedule-folders/:folderId` | Schedule folder entries |
| GET | `/live-sessions/:id` | **Session detail + playback URLs** |
| GET | `/live-chat/:liveClassId/history` | Chat history (paginated) |
| GET | `/live-chat/ban-status` | Am I chat-banned? |
| GET | `/live-polls/:liveClassId/active` | Active poll |
| POST | `/live-reminders` | Create reminder |
| GET | `/live-reminders` | List my reminders |
| GET | `/live-reminders/session/:liveSessionId` | Reminder set? |
| DELETE | `/live-reminders/:liveSessionId` | Delete reminder |

All require `Authorization: Bearer <token>` unless explicitly marked otherwise on the route.
