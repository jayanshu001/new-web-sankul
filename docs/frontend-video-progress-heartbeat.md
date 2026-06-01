# Frontend Guide — Video Progress Heartbeat → showing up in `/learning/progress/my`

**Audience:** App / frontend engineers
**Goal:** Make sure that when a user watches a video, the heartbeat call results in a card appearing in the unified **Resume Learning** feed (`GET /api/v1/client/learning/progress/my`).

---

## TL;DR — what changed and what you must do

The Resume-Learning feed (`/learning/progress/my`) only shows a watched video if its
saved progress row is attributed to a **container** — a Course, a Package, or a Live Course.

Because admin can nest videos under **child video categories** (e.g. a video lives in
`January(2025)`, whose parent `2025(Lecture)` is the one actually linked to the course),
the backend cannot always derive that container from the category tree alone. **The
frontend must tell the backend which container the user is watching from, via the
`scope` field on the heartbeat.**

> ✅ **The one rule:** always send `scope` on every heartbeat, set to the **top-level
> product the user opened** (the Course / Package / Live Course), **not** the child
> category and **not** the video.

If you send `scope` correctly, the row will appear in `/learning/progress/my`. If you
omit it, videos that sit under child categories (and all free videos) may silently fail
to appear — the heartbeat still returns `200`, but the card never shows.

---

## Endpoint

```
POST /api/v1/client/courses/lectures/:videoId/progress
Authorization: Bearer <customer token>
Content-Type: application/json
```

> For **recorded live-session** playback (not a normal Video) use the sibling endpoint
> `POST /api/v1/client/learning/progress/live-sessions/:liveSessionId` — same body shape,
> same `scope` rules.

---

## Request body

```jsonc
{
  "positionSec": 142,        // Math.floor(currentTime), integer ≥ 0
  "durationSec": 3600,       // Math.floor(totalDuration), integer ≥ 0
  "scope": {                 // ⚠️ REQUIRED in practice — see rules below
    "kind": "course",        // "course" | "package" | "liveCourse"
    "id": "6a1d586590405a483d47e1e6"   // _id of the TOP-LEVEL container
  }
}
```

### Field reference

| Field         | Type   | Required | Notes |
|---------------|--------|----------|-------|
| `positionSec` | number | Yes      | Current position in seconds. `Math.floor`. |
| `durationSec` | number | Yes      | Total duration in seconds. `Math.floor`. |
| `scope`       | object | **Strongly required** | The container the user is watching from. Omitting it is the #1 cause of "video not in Resume feed". |
| `scope.kind`  | enum   | Yes if `scope` sent | `"course"`, `"package"`, or `"liveCourse"`. |
| `scope.id`    | string | Yes if `scope` sent | `_id` of the **course / package / live course** — the product the user opened. |

---

## ⚠️ The critical rule: what goes in `scope.id`

`scope.id` must be the **product container the user navigated into**, i.e. the same id
you used to open the detail screen — **never** the video category / child category id.

```
Course detail screen opened with courseId = C
   └─ Subject / chapter (video category)        ← NOT this
        └─ Child category "January(2025)"        ← NOT this
             └─ Video the user is playing        ← NOT this
```

➡️ For every video under that tree, send:

```jsonc
"scope": { "kind": "course", "id": "C" }
```

### `kind` ⇄ screen mapping

| Screen the user opened     | `scope.kind`   | `scope.id` is the `_id` of… |
|----------------------------|----------------|------------------------------|
| Recorded **course** detail | `"course"`     | the Course                   |
| **Package** detail         | `"package"`    | the Package                  |
| **Live course** detail     | `"liveCourse"` | the Live Course              |

You already have this id in the route params of the detail screen — thread it down to
the video player and into the heartbeat. (Per the existing FE wiring this is the
`progressScope` passed from route params into `useVideoScreenProgress`.)

---

## Why this is required (the short version)

- Progress is stored one row per `(customer, video)`.
- `/learning/progress/my` groups rows by `courseId` / `packageId` / `liveCourseId`.
- A row with **none** of those set is invisible to the feed.
- When a video sits under a **child** video category, the parent category (the one
  linked to the course/package) is several hops away, and that hierarchy is not always
  walkable on the backend. The `scope` you send is the **authoritative, reliable** signal
  of which container to attribute the row to.

The backend validates `scope` before trusting it:

- **Paid container** → it confirms the user holds an active, verified, non-expired
  subscription for that exact `scope.id`, then stamps the pointer. A spoofed `scope`
  cannot attach progress to something the user hasn't bought.
- **Free video** → it confirms the scoped course exists and is active, then stamps it
  (free content is ungated, so this just attributes the row correctly).

So: send the honest `scope` for the screen the user is on, and the row shows up.

---

## When to call (triggers — unchanged)

| Trigger        | Condition |
|----------------|-----------|
| **First**      | Playback position ≥ 5 s for the first time on this video |
| **Completion** | `positionSec / durationSec ≥ 0.95` (once per video) |
| **Interval**   | Every 10 minutes of continuous playback |
| **Pause**      | Player playing → paused |
| **Unmount**    | Video screen closed / navigated away |

> YouTube-hosted videos remain excluded (the embedded player owns its own progress UX).

---

## Worked examples

### 1. Video under a child category of a Course (the case that was failing)

User opened **Course** `English Grammer` (`_id 6a1d586590405a483d47e1e6`), drilled into
child category `January(2025)`, and is playing video `6a19736359f7f485f583a6e1`:

```jsonc
POST /api/v1/client/courses/lectures/6a19736359f7f485f583a6e1/progress
{
  "positionSec": 114,
  "durationSec": 1706,
  "scope": { "kind": "course", "id": "6a1d586590405a483d47e1e6" }
}
```

➡️ Row stamped with `courseId = 6a1d586590405a483d47e1e6` → appears as a **course** card
in `/learning/progress/my`.

### 2. Same video reached through a Package

```jsonc
"scope": { "kind": "package", "id": "<packageId the user opened>" }
```

➡️ Appears as a **package** card.

### 3. Live course recording

```jsonc
"scope": { "kind": "liveCourse", "id": "<liveCourseId the user opened>" }
```

---

## How to self-verify (do this once after wiring)

1. **Inspect the heartbeat response.** It returns the saved row as `data`. Confirm the
   relevant pointer is now non-null:

   ```jsonc
   {
     "success": true,
     "data": {
       "courseId": "6a1d586590405a483d47e1e6",   // ← must be non-null for course scope
       "packageId": null,
       "liveCourseId": null,
       "positionSec": 114,
       "durationSec": 1706
       // ...
     }
   }
   ```

   - `scope.kind: "course"` → `data.courseId` must be set.
   - `scope.kind: "package"` → `data.packageId` must be set.
   - `scope.kind: "liveCourse"` → `data.liveCourseId` must be set.

   If the matching pointer is still `null`, the `scope.id` is wrong (you sent a category
   id, or a container the user isn't subscribed to). Fix the id you're threading in.

2. **Call the feed.** `GET /api/v1/client/learning/progress/my` should now include a card
   whose `id` equals your `scope.id`, with the played video as its `lecture` / `resume`.

> Existing rows that were saved *before* this fix self-heal: the next heartbeat (with a
> correct `scope`) re-stamps the pointer. The user just needs to play the video once more.

---

## Failure-mode cheat sheet

| Symptom | Cause | Fix |
|---|---|---|
| `200 OK` but `data.courseId/packageId/liveCourseId` all `null` | `scope` omitted, or `scope.id` is a category id, or paid user not subscribed to that container | Send `scope` with the **container** id of the screen the user opened |
| Card missing from `/progress/my` despite heartbeats | Same as above — the row has no container pointer | Same as above |
| `403 No active subscription` | User genuinely lacks a verified sub for this lecture (and it isn't free) | Expected — don't send heartbeats for content the user can't access |
| `400` validation error | `positionSec`/`durationSec` not integers, or `scope.id` not a 24-char ObjectId | `Math.floor` the times; pass a valid id |
| `404 Lecture not found` | `videoId` wrong or video disabled | Check the id |

---

## Contract notes for FE

- `scope` is **idempotent and safe** to send on every heartbeat — send it every time, not
  just the first.
- Sending `scope` never changes *access* (entitlement is checked independently); it only
  controls **which card** the progress attaches to.
- Keep sending the same `scope` for the whole watch session of a given screen. If the same
  video is genuinely reachable from two products, attribute it to the one the user is
  currently inside.
