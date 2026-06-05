# Free Video — Resume Learning (Frontend Integration Guide)

How the app records watch-progress for **standalone free videos** (the
`/free-videos` catalog) and renders the **"Resume Learning"** card from the
design.

A "free video" is a `Video` with `priceType: "free"` shown by `GET /free-videos`.
It is played on its own — it has **no** course / package / live-course you bought,
so it can't use the subscription-gated course flows. This guide is the complete
free-video player + resume integration; you don't need any of the course
progress endpoints.

All endpoints require `Authorization: Bearer <accessToken>`. Base path:
`/api/v1/client`.

---

## TL;DR — the three calls

| Step | Call | When |
| --- | --- | --- |
| **Play** | `GET /video-categories/:categoryId/videos/:videoId` | When the user opens a free video. Returns the encrypted URLs **and** the `scope` to echo. |
| **Heartbeat** | `POST /free-videos/:videoId/progress` | Every ~10–15s while playing, on pause, and on exit. |
| **Resume feed** | `GET /free-videos/resume` | To build the "Resume Learning" list / hero card. |

> ⚠️ Do **not** use `GET /courses/lecture` for free videos. It validates the
> video against a `course`/`package` you pass and 403s for a standalone free
> video. The category endpoint below is the correct playback path — and the
> free-videos list already gives you the `categoryId` you need.

---

## 1. Get the catalog — `GET /free-videos`

You already use this for the free-videos grid. Each item carries the
`videoCategoryId` you'll need for playback:

```jsonc
// GET /api/v1/client/free-videos?page=1&limit=20
{
  "success": true,
  "data": [
    {
      "_id": "664...aaa",                 // <-- videoId
      "title": "UPSC Indian Politics",
      "priceType": "free",
      "videoCategoryId": {                 // populated
        "_id": "664...ccc",               // <-- categoryId (needed to play)
        "title": "Indian Polity",
        "image": "https://…"
      }
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Keep `videoId` **and** `videoCategoryId._id` on the FE model — you need both to
open the player.

---

## 2. Play a video — `GET /video-categories/:categoryId/videos/:videoId`

Returns the encrypted, multi-quality playback envelope. **No subscription
check** for free videos. It also returns `scope` (the owning container resolved
from the category) — keep it, you don't need it for free heartbeats but it's
there for parity.

```jsonc
// GET /api/v1/client/video-categories/664...ccc/videos/664...aaa
{
  "success": true,
  "data": {
    "_id": "664...aaa",
    "title": "UPSC Indian Politics",
    "topic": "Polity",
    "platform": "youtube",          // "youtube" | "aws" | "vimeo"
    "priceType": "free",
    "scope": { "kind": "course" | "package" | "live-course" | null, "id": "…" },
    "request": {
      "files": {
        "token": "8421760095317284",        // 16-digit key/IV seed
        "hls": {
          "default_cdn": "primary",
          "cdns": { "primary": { "url": "<AES-128-CBC base64>", "allow720": true } }
        },
        "progressive": [
          { "qualityLabel": "720p", "quality": "720p", "height": 720,
            "bitrate": 0, "hasAudio": true, "hasVideo": true,
            "url": "<AES-128-CBC base64>" }
        ]
      }
    }
  },
  "message": "Video fetched."
}
```

Decrypt `request.files.*.url` with `token` using your existing player
decryption (same scheme as every other lecture in the app — AES-128-CBC, key &
IV derived from the 16-digit token). Prefer `hls` when present; fall back to the
`progressive` list.

**Errors:** `404` video not in this category / disabled · `422` bad ids ·
`502` URL resolution failed.

---

## 3. Report progress — `POST /free-videos/:videoId/progress`

Heartbeat while playing. The **first** call is what makes the video appear in
the Resume feed — there is no separate "start" call. No `scope` in the body
(free *is* the entitlement).

```jsonc
// POST /api/v1/client/free-videos/664...aaa/progress
{
  "positionSec": 1480,   // current play position, whole seconds (0 .. 86400)
  "durationSec": 1900    // total duration, whole seconds (0 .. 86400)
}
```

- Send `positionSec` as an **integer** (round it). Floats fail validation (`400`).
- The backend marks the video **completed** once `positionSec / durationSec ≥ 95%`,
  and completion is sticky (re-watching the start won't un-complete it). You
  don't compute this — just keep sending position/duration.
- Suggested cadence: every 10–15s, plus on pause and on screen exit. Fire-and-forget;
  a dropped heartbeat just means a slightly stale resume position.

**Errors:** `400` invalid body · `403` the video is **not** free (a paid video
must use the course heartbeat) · `404` video not found/disabled.

```jsonc
// 200 — the stored progress row (you can ignore the body)
{ "success": true, "data": { "videoId": "…", "positionSec": 1480, "durationSec": 1900, "completed": false, "lastWatchedAt": "2026-06-05T10:12:00.000Z" } }
```

---

## 4. Build the Resume Learning UI — `GET /free-videos/resume`

Returns the user's started free videos, **newest first** (max 20). Videos that
have since been disabled or flipped to paid are dropped automatically.

```jsonc
// GET /api/v1/client/free-videos/resume
{
  "success": true,
  "data": {
    "resumeNext": {                       // the hero "Resume Now" card, or null
      "type": "free",
      "videoId": "664...aaa",
      "categoryId": "664...ccc",           // <-- pass to the player endpoint on tap
      "title": "UPSC Indian Politics",
      "topic": "Polity",
      "chapterTitle": "Indian Polity",     // from the video's category
      "thumbnail": "https://…",            // category image
      "daysLeft": null,                    // free videos never expire
      "completed": false,
      "percentCompleted": 78,
      "lastWatchedAt": "2026-06-05T10:12:00.000Z",
      "resume": {
        "videoId": "664...aaa",
        "positionSec": 1480,
        "durationSec": 1900,
        "remainingSec": 420
      }
    },
    "cards": [ /* same shape; full list incl. resumeNext as cards[0] */ ]
  }
}
```

**Mapping to the card in the design:**

| UI element | Field |
| --- | --- |
| Title ("Free - UPSC Indian Politics") | `title` (prefix "Free - " on the FE) |
| "78% Completed" + progress bar | `percentCompleted` |
| "50 min left" | `resume.remainingSec` → format as minutes |
| "Resume Now" tap | open player for `videoId` (see step 5) |
| Thumbnail / chapter label | `thumbnail`, `chapterTitle` |

Empty state: `{ "cards": [], "resumeNext": null }` → hide the Resume section.

---

## 5. "Resume Now" tap → seek

The resume card carries **no** video URL (kept light), but it includes
`videoId` and `categoryId` so it's self-contained. On tap:

1. `GET /video-categories/:categoryId/videos/:videoId` (step 2) → decrypt URL.
2. **Seek to `resume.positionSec`** on load.
3. Resume heartbeats (step 3).

---

## State, end to end

```
open free video
  └─ GET /video-categories/:cat/videos/:id     → decrypt & play
        └─ every 10–15s / pause / exit:
              POST /free-videos/:id/progress {positionSec,durationSec}

home / resume screen
  └─ GET /free-videos/resume                    → render cards + hero
        └─ tap "Resume Now":
              GET /video-categories/:cat/videos/:id  → play, seek positionSec
```

That's the whole feature — no course, package, or subscription calls involved.
