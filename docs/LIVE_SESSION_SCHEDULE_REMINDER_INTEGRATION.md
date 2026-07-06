# Live Session, Upcoming Schedule & Reminders — Client API Integration Guide

Front-end integration guide for the **"upcoming live class"** experience: see what's
scheduled, set a *remind-me* on a class, get a push notification before it starts,
then open the session to join.

This doc is scoped to three things — **upcoming sessions / schedule**, the
**live-session detail** endpoint, and the **reminder** API. For the rest of the
live-course surface (browse, buy, recordings, the 3-minute preview gate, Socket.IO
chat/polls) see `LIVE_COURSE_CLIENT_INTEGRATION.md`.

---

## 1. Basics

**Base URL:** `{{URL}}/api/v1`

**Auth:** every endpoint here requires a **customer** Bearer token (from the OTP
login flow):

```
Authorization: Bearer <customer access token>
```

**Response envelope** — all of these endpoints return:

```jsonc
{
  "success": true,
  "code": 200,
  "data": { /* the payload described per-endpoint below */ },
  "message": "Reminders fetched.",
  "messages": {}
}
```

On error: `success: false`, an HTTP 4xx/5xx status, and a human `message`.

---

## 2. The flow

```
            ┌─ GET /client/live-courses/:id/schedule?upcoming=true   (timetable view)
 discover ──┤
            └─ GET /client/live-courses/:id/sessions?upcoming=true   (session list view)
                                │
                                ▼
 remind me ─── POST /client/live-reminders   { liveSessionId, minutesBefore }
                                │
                                ▼  (minutesBefore the class starts)
   push ────── FCM notification  type: "live_reminder"
                                │
                                ▼  (admin goes live → status CREATED)
   join ────── GET /client/live-sessions/:id   → hlsUrl / liveClassId
```

A **reminder** is the user's *intent* to be notified; the actual delivery is a
scheduled push notification fired `minutesBefore` the session's `scheduledAt`.
Reminders can only be set on **SCHEDULED** sessions that still have a future start
time.

---

## 3. Upcoming sessions & schedule

Two read endpoints surface what's coming up. They are **not** entitlement-gated —
both are course info shown to everyone — and neither returns playback URLs.

### `GET /client/live-courses/:id/sessions`  ← session list view

Metadata-only list of a course's sessions.

Query:
- `upcoming=true` → only `SCHEDULED` sessions with `scheduledAt >= now` (this is
  the "upcoming" filter — use it for the remind-me list).
- `status` = `SCHEDULED` | `CREATED` | `ENDED` | `READY` (ignored when `upcoming=true`).
- `page` (default 1), `limit` (default 50, max 100).

**Ordering:**
- `upcoming=true` → ascending `scheduledAt` — the next-to-start session is on top.
- otherwise → **future sessions first, nearest-to-start at the top**, then past
  sessions most-recent-first. Sessions with no `scheduledAt` sink to the bottom.
  This mirrors a calendar feed: opening the list always lands on "what's next".

`data`:
```jsonc
{
  "sessions": [
    {
      "_id": "6635...",
      "title": "Polity — Week 1",
      "status": "SCHEDULED",
      "scheduledAt": "2026-05-17T13:30:00.000Z",   // null for immediate sessions
      "streamId": null,                            // set only once live (CREATED+)
      "liveCourseIds": ["6630..."],
      "hasRecordings": false,
      "canJoin": false,                            // true only while status === "CREATED"
      "createdAt": "2026-05-14T...",
      "updatedAt": "2026-05-14T..."
    }
  ],
  "total": 7, "page": 1, "limit": 50
}
```

- **`canJoin`** → bind the **"Join"** button to this. `true` only while
  `status === "CREATED"` (admin has gone live, room exists). For `SCHEDULED`
  show a **"Remind me"** affordance instead; for `ENDED`/`READY` show
  **"Watch recording"**.
- To set a reminder on a row, use its **`_id`** as `liveSessionId`.

### `GET /client/live-courses/:id/schedule`  ← timetable view

The Schedule tab — the same scheduled sessions, shaped as a timetable, plus the
course's uploaded "Time Table" files.

Query: `upcoming=true` limits the `timetable` to classes from now onward.

**Ordering** (same rule as the sessions list):
- `upcoming=true` → ascending `scheduledAt` — the next-to-start class is on top.
- otherwise → future classes first (nearest at the top), then past classes
  most-recent-first. Opening the timetable always lands on "what's next".

`data`:
```jsonc
{
  "liveCourse": { "_id": "6630...", "name": "Constable Foundation" },
  "files": [
    { "title": "Batch Time Table", "fileUrl": "https://...pdf", "order": 0 }
  ],
  "timetable": [
    {
      "sessionId": "6635...",                  // use as liveSessionId for a reminder
      "subject": "Polity",                     // falls back to session title if unset
      "title": "Polity — Week 1",
      "educator": { "_id": "...", "name": "Dr. R. Kumar", "image": "..." }, // or null
      "date": "2026-05-17T13:30:00.000Z",
      "startAt": "2026-05-17T13:30:00.000Z",
      "endAt": "2026-05-17T14:30:00.000Z",      // null if not set
      "status": "SCHEDULED",
      "streamId": null
    }
  ],
  "total": 5
}
```

Group `timetable` by `date` for the Date / Subject / Time layout; render `files`
as the downloadable list.

---

## 4. Live-session detail

### `GET /client/live-sessions/:id`  ← the "Watch / Join" endpoint

`:id` accepts the Mongo session `_id` **or** the numeric `streamId`.

This is the endpoint you open when the user taps **Join** (or **Watch recording**).
It applies the per-viewer entitlement gate — full payload, the 3-minute preview
rules, and Socket.IO usage are documented in
`LIVE_COURSE_CLIENT_INTEGRATION.md` §5–§6. The fields that matter for the
schedule/reminder flow:

```jsonc
{
  "id": "6635...",
  "title": "Polity — Week 1",
  "status": "SCHEDULED",                  // SCHEDULED | CREATED | ENDED | READY
  "canJoin": false,                       // true only while status === "CREATED"
  "scheduledAt": "2026-05-17T13:30:00.000Z",
  "streamId": null,
  "liveClassId": null,                    // Socket.IO room id — set once CREATED
  "isLive": false,
  "accessLevel": "full"                   // see the live-course guide for the gate
  // ...hlsUrl / hlsUrls / recordings / preview* / purchaseOptions — see live-course guide
}
```

While `status` is `SCHEDULED` there is nothing to play yet — show the countdown to
`scheduledAt` and the **Remind me** toggle.

---

## 5. Reminders

All under `/api/v1/client/live-reminders`. **One reminder per customer per session.**
A reminder is backed by a scheduled push notification (see §6); setting / removing a
reminder schedules / cancels that push.

> A reminder can only be set on a session whose `status` is **SCHEDULED** and whose
> `scheduledAt` is still in the future. Anything else returns `409`.

### `POST /client/live-reminders`  ← set / replace a reminder

Body:
```jsonc
{
  "liveSessionId": "6635...",   // required — the session's Mongo _id
  "minutesBefore": 30           // optional — default 30, integer 0..10080 (1 week)
}
```

`minutesBefore` is how long *before* `scheduledAt` the push fires. If the class is
sooner than `minutesBefore`, the reminder fires almost immediately rather than in
the past.

**Upsert semantics:** calling this again for the same session just moves the fire
time — there's no "already set" error, so it's safe to bind directly to a toggle.

`data` (201):
```jsonc
{
  "reminder": {
    "id": "6640...",
    "liveSessionId": "6635...",
    "liveCourseId": "6630...",                  // first course of the session, or null
    "minutesBefore": 30,
    "remindAt": "2026-05-17T13:00:00.000Z",     // computed fire time
    "sessionScheduledAt": "2026-05-17T13:30:00.000Z",
    "status": "scheduled",                      // "scheduled" | "cancelled"
    "fired": false,                             // derived: remindAt <= now
    "session": {
      "id": "6635...",
      "title": "Polity — Week 1",
      "status": "SCHEDULED",
      "scheduledAt": "2026-05-17T13:30:00.000Z",
      "subject": "Polity",
      "streamId": null,
      "liveCourseIds": ["6630..."]
    },
    "createdAt": "2026-05-14T...",
    "updatedAt": "2026-05-14T..."
  }
}
```

Errors:
| Status | When |
|---|---|
| `422` | `liveSessionId` missing / not a valid id, or `minutesBefore` out of range |
| `404` | live session not found |
| `409` | session is not `SCHEDULED`, or has no upcoming `scheduledAt` |

### `GET /client/live-reminders`  ← my reminders

The caller's reminders, **soonest first**. With `upcoming=true` the list is
sorted by **`session.scheduledAt` ascending** (the class that starts next is on
top); without it, the list is sorted by `remindAt` ascending.

Query:
- `upcoming=true` → keep only `status: "scheduled"` reminders whose
  `session.scheduledAt` is still in the future. Omit it to get **all** reminders,
  including fired and cancelled ones (e.g. for a history view).
- `limit=N` → cap the list to the first `N` rows after sort/filter. Positive
  integer, max **100**. When `upcoming=true` and no `limit` is sent the response
  is capped to **50**; without `upcoming` it's uncapped by default. Use
  `?upcoming=true&limit=2` to mirror the home-screen "next 2 classes" card.

`data`:
```jsonc
{
  "reminders": [ /* same shape as POST's `reminder`, each with `session` populated */ ],
  "total": 3,        // count BEFORE limit is applied — useful for "+N more" labels
  "limit": 2         // the cap that was applied, or null when uncapped
}
```

Errors: `422` if `limit` is not a positive number.

### `GET /client/live-reminders/session/:liveSessionId`  ← per-session toggle state

Whether the caller already has a reminder on this one session — use this to render
the **on / off** state of the per-session "Remind me" toggle.

`data`:
```jsonc
{ "reminder": { /* the reminder object */ } }   // or: { "reminder": null } when none is set
```

`422` if `:liveSessionId` is not a valid id.

### `DELETE /client/live-reminders/:liveSessionId`  ← remove a reminder

Removes the caller's reminder for the session and cancels its pending push.

> The path id is the **`liveSessionId`**, not the reminder's `id`.

`data` on success: `{ "removed": true, "liveSessionId": "6635..." }`

Errors: `422` invalid id, `404` no reminder set for this session.

---

## 6. The reminder push notification

When `remindAt` is reached, the customer gets a push via the normal FCM pipeline:

```jsonc
{
  "title": "Live class reminder",
  "body": "Your live class \"Polity — Week 1\" is starting soon.",
  "type": "live_reminder",
  "data": {
    "kind": "live_reminder",
    "liveSessionId": "6635...",
    "liveCourseId": "6630...",     // or null
    "streamId": null,              // null if the class hadn't started when set
    "scheduledAt": "2026-05-17T13:30:00.000Z"
  }
}
```

On tap, route the user to the live-session screen using `data.liveSessionId` and
open `GET /client/live-sessions/:id`. By the time the reminder fires the admin has
usually gone live (`status: "CREATED"`), so `canJoin` will be `true`.

**If the admin reschedules or deletes the class:** the server re-points (or cancels)
the reminder automatically — the customer doesn't need to re-set it. A reminder
whose session was cancelled / un-scheduled flips to `status: "cancelled"`. The
`sessionScheduledAt` snapshot on the reminder lets the client detect this drift if
it caches reminders locally.

---

## 7. Quick reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/client/live-courses/:id/sessions?upcoming=true` | upcoming session list (use `_id` as `liveSessionId`) |
| GET | `/client/live-courses/:id/schedule?upcoming=true` | upcoming timetable + files |
| GET | `/client/live-sessions/:id` | open / join a session (entitlement gate) |
| POST | `/client/live-reminders` | set / replace a reminder |
| GET | `/client/live-reminders?upcoming=true&limit=N` | my reminders, soonest-starting first (limit ≤ 100) |
| GET | `/client/live-reminders/session/:liveSessionId` | is a reminder set? (toggle state) |
| DELETE | `/client/live-reminders/:liveSessionId` | remove a reminder |

**Postman:** Customer APIs → **12 Live Courses** → **05 Schedule** / **06 Reminders**.
