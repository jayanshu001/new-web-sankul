# Lecture Notes & Audio Notes — Client integration

In-player notes (text + audio) attached to a specific moment inside a lecture.
Works for **recorded** lectures (`Video`) and **live** sessions (`LiveSession`).
Only available to **subscribed** users — every read, create, edit and delete
re-checks the entitlement.

Two parallel modules:

| Feature      | Base path                                      | Persists |
|--------------|------------------------------------------------|----------|
| Text notes   | `/api/v1/client/lecture-notes`                 | `content` string |
| Audio notes  | `/api/v1/client/lecture-audio-notes`           | uploaded audio file (S3) |

Both share the same lecture-binding fields, same auth, same subscription
predicate, and the same multiple-rows-per-lecture semantics. Wire them up the
same way in the player UI; the only difference is how you create them
(`application/json` vs `multipart/form-data`).

---

## Auth

All endpoints require:

```
Authorization: Bearer <customerAccessToken>
```

Customer role is enforced at the router level. A non-customer token returns
`403 Access denied. Insufficient permissions.`

---

## Subscription rules

The same predicate the lecture/playback endpoints use:

- **Recorded lectures** — the caller must have a `PackageCourseSubscription`
  for the lecture's parent course with `status: true`, `paymentStatus: "verified"`,
  `endAt > now`.
- **Live sessions** — the caller must have a `LiveCourseSubscription` for at
  least one of the session's `liveCourseIds`, with `status: true`,
  `paymentStatus: "verified"`, and `endAt` either `null` or `>= now`.
- Open live sessions (no `liveCourseIds`) **don't support notes** — there's no
  subscriber gate to scope the feature, so the API returns `403`.

If the subscription lapses, the customer can still **read** their old notes via
the list endpoints (they're gated too, so the answer becomes `403`). Mirror
that in the UI: hide the notes pane when the player itself is locked.

---

## Lecture targeting (shared by both modules)

Every create / list request takes:

| field           | required for                | notes                                            |
|-----------------|-----------------------------|--------------------------------------------------|
| `lectureType`   | always                      | `"recorded"` or `"live"`.                        |
| `videoId`       | `lectureType: "recorded"`   | 24-char ObjectId. The `Video._id` being played.  |
| `liveSessionId` | `lectureType: "live"`       | 24-char ObjectId. The `LiveSession._id` being watched. |
| `timestampSec`  | create (both)               | integer ≥ 0, ≤ 86400. Player position at note time. |

`timestampSec` is the **lecture playback position when the note was taken**,
not a wall-clock time. The player should pass `currentTime` (in seconds,
floored to an int).

---

## Standard response envelope

All endpoints use the project envelope:

```json
{
  "success": true,
  "code": 200,
  "data":   { ... },
  "message": "Note created.",
  "messages": {}
}
```

`success: false` responses fill `message` with the reason and an empty `data`.

---

# 1) Text notes — `/api/v1/client/lecture-notes`

## 1.1 Create — `POST /api/v1/client/lecture-notes`

Request:

```json
{
  "lectureType":   "recorded",
  "videoId":       "65f3b6d8a8f3e9b2c1d4e7a0",
  "timestampSec":  742,
  "content":       "Newton's second law starts here."
}
```

Or, for a live session:

```json
{
  "lectureType":    "live",
  "liveSessionId":  "66012a7e9b3c2d4e5f6a7b8c",
  "timestampSec":   312,
  "content":        "Doubt: clarify the derivation step at 5:12."
}
```

| field          | type   | rules                                |
|----------------|--------|--------------------------------------|
| `lectureType`  | enum   | `"recorded"` \| `"live"`             |
| `videoId`      | string | required when `lectureType=recorded` |
| `liveSessionId`| string | required when `lectureType=live`     |
| `timestampSec` | number | int, `0 ≤ n ≤ 86400`                 |
| `content`      | string | non-empty, trimmed, max `5000` chars |

**201 response**

```json
{
  "success": true,
  "code": 201,
  "data": {
    "note": {
      "_id": "…",
      "customerId": "…",
      "lectureType": "recorded",
      "videoId": "…",
      "courseId": "…",
      "liveCourseIds": [],
      "timestampSec": 742,
      "content": "Newton's second law starts here.",
      "createdAt": "2026-05-15T10:32:11.000Z",
      "updatedAt": "2026-05-15T10:32:11.000Z"
    }
  },
  "message": "Note created.",
  "messages": {}
}
```

## 1.2 List — `GET /api/v1/client/lecture-notes`

Returns **only the caller's** notes for the lecture, sorted ascending by
`timestampSec` then `createdAt` (so the player can render them along the
scrubber in playback order).

| query param     | required when                |
|-----------------|------------------------------|
| `lectureType`   | always                       |
| `videoId`       | `lectureType=recorded`       |
| `liveSessionId` | `lectureType=live`           |

Examples:

```
GET /api/v1/client/lecture-notes?lectureType=recorded&videoId=65f3b6d8a8f3e9b2c1d4e7a0
GET /api/v1/client/lecture-notes?lectureType=live&liveSessionId=66012a7e9b3c2d4e5f6a7b8c
```

**200 response**

```json
{
  "success": true,
  "code": 200,
  "data": {
    "notes": [
      { "_id": "…", "timestampSec": 12,  "content": "…", "…": "…" },
      { "_id": "…", "timestampSec": 742, "content": "…", "…": "…" }
    ]
  },
  "message": "Notes fetched.",
  "messages": {}
}
```

## 1.3 Update — `PATCH /api/v1/client/lecture-notes/:id`

Edit the text and/or move the pin. At least one field is required.

```json
{ "content": "Cleaner phrasing.", "timestampSec": 745 }
```

Subscription is re-checked on edit — a lapsed user cannot keep editing.

## 1.4 Delete — `DELETE /api/v1/client/lecture-notes/:id`

Hard-delete. The handler scopes the query to `customerId`, so one customer
can never delete another's note. Returns `200` with empty data on success,
`404` if the note doesn't exist or doesn't belong to the caller.

---

# 2) Audio notes — `/api/v1/client/lecture-audio-notes`

Same surface as text notes, but `content` is replaced with an uploaded audio
file persisted to DigitalOcean Spaces and served via its public CDN URL.

## 2.1 Create — `POST /api/v1/client/lecture-audio-notes`

**Content-Type: `multipart/form-data`**

| field name      | type     | required | notes                                       |
|-----------------|----------|----------|---------------------------------------------|
| `audio`         | file     | yes      | The recording. See limits below.            |
| `lectureType`   | text     | yes      | `"recorded"` or `"live"`                    |
| `videoId`       | text     | conditional | for `lectureType=recorded`               |
| `liveSessionId` | text     | conditional | for `lectureType=live`                   |
| `timestampSec`  | text     | yes      | integer seconds (string-encoded is fine; the server coerces) |
| `title`         | text     | no       | optional label, max 200 chars               |
| `durationSec`   | text     | no       | client-known duration, max 86400            |

**File limits**

- **Max size**: 20 MB.
- **Accepted ext / mime**: `mp3`, `m4a`, `aac`, `wav`, `webm`, `ogg`, `opus`
  (mime must start with `audio/` or match the above tokens).
- Bigger than 20 MB → multer returns `413 Payload Too Large` (or the generic
  multer error wrapped by Express). Reject in the client before upload.

**201 response**

```json
{
  "success": true,
  "code": 201,
  "data": {
    "note": {
      "_id": "…",
      "customerId": "…",
      "lectureType": "recorded",
      "videoId": "…",
      "courseId": "…",
      "timestampSec": 742,
      "title": "",
      "audioUrl": "https://websankul-staging.blr1.digitaloceanspaces.com/customer/audio-notes/<customerId>/<ts>-<rand>.webm",
      "audioKey": "customer/audio-notes/<customerId>/<ts>-<rand>.webm",
      "mimeType": "audio/webm",
      "sizeBytes": 184320,
      "durationSec": 18,
      "createdAt": "…",
      "updatedAt": "…"
    }
  },
  "message": "Audio note created.",
  "messages": {}
}
```

`audioUrl` is a public, directly playable URL — use it as the `<audio>` `src`
on the client. `audioKey` is internal bookkeeping (used by the delete handler
to clean up the S3 object); the client can ignore it.

**Cleanup behaviour**

If the entitlement check or DB write fails *after* the file has already
uploaded to S3, the controller best-effort deletes the orphaned object before
returning the error. The client doesn't need to issue a follow-up cleanup.

## 2.2 List — `GET /api/v1/client/lecture-audio-notes`

Same query params as text notes. Returns the caller's audio notes for the
lecture, sorted by `timestampSec` ascending.

## 2.3 Update — `PATCH /api/v1/client/lecture-audio-notes/:id`

Only **metadata** is editable; the audio file itself is immutable. To
"replace" a recording, delete the row and create a new one.

```json
{ "title": "Doubt #3 — proof step", "timestampSec": 745 }
```

At least one of `title` / `timestampSec` is required.

## 2.4 Delete — `DELETE /api/v1/client/lecture-audio-notes/:id`

Removes the row **and** issues a DigitalOcean Spaces `DeleteObject` for the
audio file. The S3 delete is best-effort: if it fails the row is already gone
and the orphan is acceptable (a periodic sweep can reclaim it).

---

## Error codes (both modules)

| Status | When                                                                              |
|--------|-----------------------------------------------------------------------------------|
| `400`  | Body / query validation failure. `message` carries the first Zod issue.           |
| `401`  | Missing or invalid bearer token.                                                  |
| `403`  | Caller is not a customer **or** has no active verified subscription for the lecture / live session. Also returned when a live session has no attached courses (open session — feature disabled). |
| `404`  | Lecture / session / note id not found, or note doesn't belong to the caller.      |
| `500`  | Unhandled server error.                                                           |

`400` for audio-note create can also fire **after** the file has uploaded
(validation runs after multer). The orphaned file is auto-deleted; the client
just needs to handle the error.

---

## Data model (for context)

### `LectureNote` — collection `ws_lecture_notes`

| field           | type            | notes                                                   |
|-----------------|-----------------|---------------------------------------------------------|
| `customerId`    | ObjectId        | Owner. Reads/writes filter on this.                     |
| `lectureType`   | enum            | `recorded` \| `live`                                    |
| `videoId`       | ObjectId \| null| set when `lectureType=recorded`                         |
| `liveSessionId` | ObjectId \| null| set when `lectureType=live`                             |
| `courseId`      | ObjectId \| null| denormalised — the parent course (recorded only)        |
| `liveCourseIds` | ObjectId[]      | denormalised — the session's live courses (live only)   |
| `timestampSec`  | int             | playback position, `0..86400`                           |
| `content`       | string          | 1..5000 chars                                           |
| `createdAt` / `updatedAt` | Date  | Mongoose timestamps                                     |

Indexes:
- `{ customerId: 1, videoId: 1, timestampSec: 1 }`
- `{ customerId: 1, liveSessionId: 1, timestampSec: 1 }`

Neither index is unique → a customer can pin **many** notes to the same
lecture. That's intentional.

### `LectureAudioNote` — collection `ws_lecture_audio_notes`

Same shape as `LectureNote` minus `content`, plus:

| field           | type            | notes                                                  |
|-----------------|-----------------|--------------------------------------------------------|
| `title`         | string          | optional label, max 200 chars (default `""`)           |
| `audioUrl`      | string          | public CDN URL — what the player plays                 |
| `audioKey`      | string          | bucket-relative key — used for `DeleteObject`          |
| `mimeType`      | string \| null  | from the upload                                        |
| `sizeBytes`     | int \| null     | from the upload                                        |
| `durationSec`   | int \| null     | client-supplied if known, else null                    |

Indexes mirror text notes.

---

## UI integration sketch

**Notes timeline along the scrubber**

1. On lecture open, fire both list endpoints in parallel with the same
   `lectureType` + lecture id.
2. Merge & sort by `timestampSec`; render markers at each `timestampSec / durationSec`
   position on the scrubber.
3. Tapping a marker:
   - text note → show the `content` in a side panel.
   - audio note → set `<audio>.src = note.audioUrl` and play.

**Create flow**

- "Add note at 12:22" → POST with the current player `currentTime`.
- "Record" button → MediaRecorder → upload as `multipart/form-data` with
  `audio` + `timestampSec`.

**Edit / delete**

- Editing only mutates `content` / `title` / `timestampSec`. To re-record an
  audio note, delete the existing one and create a new one — the API never
  swaps the underlying file in place.

---

## Curl quickstart

```bash
# Text note (recorded lecture)
curl -X POST "$BASE/api/v1/client/lecture-notes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lectureType": "recorded",
    "videoId": "65f3b6d8a8f3e9b2c1d4e7a0",
    "timestampSec": 742,
    "content": "Newton'\''s second law starts here."
  }'

# Audio note (live session)
curl -X POST "$BASE/api/v1/client/lecture-audio-notes" \
  -H "Authorization: Bearer $TOKEN" \
  -F "lectureType=live" \
  -F "liveSessionId=66012a7e9b3c2d4e5f6a7b8c" \
  -F "timestampSec=312" \
  -F "title=Doubt #3" \
  -F "audio=@./recording.webm"

# List my text notes for a recorded lecture
curl "$BASE/api/v1/client/lecture-notes?lectureType=recorded&videoId=65f3b6d8a8f3e9b2c1d4e7a0" \
  -H "Authorization: Bearer $TOKEN"

# Update a note
curl -X PATCH "$BASE/api/v1/client/lecture-notes/$NOTE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Cleaner phrasing." }'

# Delete a note
curl -X DELETE "$BASE/api/v1/client/lecture-notes/$NOTE_ID" \
  -H "Authorization: Bearer $TOKEN"
```
