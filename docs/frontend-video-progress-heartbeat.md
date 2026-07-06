# Frontend Guide — Video Progress Heartbeat → showing up in `/learning/progress/my`

**Audience:** App / frontend engineers
**Goal:** Make sure that when a user watches a video, the heartbeat call results in a card appearing in the unified **Resume Learning** feed (`GET /api/v1/client/learning/progress/my`).

---

## TL;DR — what changed and what you must do

The Resume-Learning feed (`/learning/progress/my`) only shows a watched video if its
saved progress row is attributed to a **container** — a Course, a Package, or a Live Course.

> ✅ **The one rule (now trivial):** the video endpoints return a ready-made
> **`scope` object** — just echo it back on every heartbeat. No more deriving the
> container id yourself. A heartbeat without `scope` returns `400`.

### 🚀 The easy path: use the `scope` the API gives you

As of the latest backend, the endpoints you load videos from **return a top-level
`scope: { kind, id }`** already resolved to the correct owning container
(course / package / live course). Use whichever you fetched the video from:

| Endpoint | Where `scope` is | Resolved kind |
|---|---|---|
| `GET /api/v1/client/video-categories/:id/videos` | `data.scope` | course / package / liveCourse (walks the tree) |
| `GET /api/v1/client/video-categories/:id/videos/:videoId` | `data.scope` | course / package / liveCourse (walks the tree) |
| `GET /api/v1/client/courses/:id` (course detail) | `data.scope` | always `course` |
| `GET /api/v1/client/packages/:id` (package detail) | `data.scope` | always `package` |
| `GET /api/v1/client/live-courses/:id` (live course detail) | `data.scope` | always `liveCourse` |

> The detail screens emit `scope` directly (the container *is* that screen). The
> `/video-categories/...` endpoints resolve it by walking the category tree, so they work
> even when a video is reached outside a product detail screen.

```jsonc
// GET /video-categories/6a1c1594dde3e6309cbc751d/videos
{
  "success": true,
  "data": {
    "category": { "_id": "6a1c1594dde3e6309cbc751d", "title": "January(2025)", ... },
    "scope": { "kind": "course", "id": "6a1d586590405a483d47e1e6" },  // ← use this
    "list": [ /* videos */ ]
  }
}
```

➡️ **Store `data.scope` when you load the video list / open the player, and pass it
straight into every heartbeat as the `scope` field.** That's the whole integration —
it is guaranteed reachable and correct, so you can't trigger the `400 "Video is not
part of the scoped <kind>"` error anymore.

> `scope` is `null` only for an **orphan category** linked to no product. In that rare
> case there is no container to file progress under — skip the heartbeat.

The rest of this doc explains the `scope` rules and how to derive the id manually (still
valid if you can't thread the API-provided `scope` through), but **prefer `data.scope`.**

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

> **Easiest:** copy `data.scope` from the video endpoint response (see the 🚀 section
> above) — it already holds the correct `{ kind, id }`. The rule below is what that
> resolved value represents, and how to derive it yourself if needed.

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

1. **Reachability** — the video must actually live under that container (the scoped
   course owns the video, or the scoped package/live course links the video's category).
   If not → **`400`**.
2. **Entitlement** — this depends on the **video's** `priceType`, not the container's:
   - **Free video** (`priceType: "free"`) → **no subscription needed**, in **any** scope
     (`course`, `package`, **and** `liveCourse`). The backend only confirms the scoped
     container exists/is active, then attributes the row. This means a free lecture inside
     a paid-but-unpurchased course/package/live-course **still saves progress** — so keep
     sending heartbeats for free videos even when the user hasn't bought the container.
   - **Paid video** → the user must hold an active, verified, non-expired subscription for
     that exact `scope.id`. If not → **`403`**. A spoofed `scope` cannot attach progress to
     something the user hasn't bought.

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

User opened child category `January(2025)` and is playing video
`6a19736359f7f485f583a6e1`. The category's own `courseId` is `null` (the link lives on
the Course's downward pointer), so the FE can't see the owner from the category alone —
**this is exactly why the FE used to guess `package` and get a `400`.**

Now the listing response hands you the resolved owner directly:

```jsonc
// GET /video-categories/6a1c1594dde3e6309cbc751d/videos
"data": { "scope": { "kind": "course", "id": "6a1d586590405a483d47e1e6" }, ... }
```

Echo it straight into the heartbeat:

```jsonc
POST /api/v1/client/courses/lectures/6a19736359f7f485f583a6e1/progress
{
  "positionSec": 114,
  "durationSec": 1706,
  "scope": { "kind": "course", "id": "6a1d586590405a483d47e1e6" }   // = data.scope
}
```

➡️ Row stamped with `courseId = 6a1d586590405a483d47e1e6` → appears as a **course** card
in `/learning/progress/my`. (This video is also `priceType: "free"`, so it saves even if
the user hasn't purchased the course.)

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
| `400 Video is not part of the scoped course/package/live course` | `scope.id` is a **category** id, or a product that doesn't actually contain this video | Use `data.scope` from the video endpoint response (it's always reachable). Or send the id of the product the user opened — the same id used to open the detail screen |
| `400` validation error (other) | `scope` omitted entirely, `positionSec`/`durationSec` not integers, or `scope.id` not a 24-char ObjectId | Always send `scope`; `Math.floor` the times; pass a valid id |
| `403 No active subscription` | The video is **paid** and the user lacks a verified, non-expired sub for the scoped container. (Free videos never `403` — they save in any scope.) | Expected for paid content the user hasn't bought — don't retry |
| Card missing from `/progress/my` despite `200`s | You're scoping to a different product than you expect, so the card shows under that other product | Confirm `data.containerId` in the response equals the product you intend |
| Same video overwrites instead of showing two cards | You sent the **same** `scope` for both watch sessions | Send each product's own `scope.id`; identical scope is the same row by design |
| `404 Lecture not found` | `videoId` wrong or video disabled | Check the id |

---

## Resolving `400 "Video is not part of the scoped <kind>"`

This *used* to be the most common wiring mistake. **It's now avoidable entirely: use the
`scope` object returned by the video endpoints** (`data.scope`) instead of constructing
one yourself — it is pre-validated as reachable. The guidance below remains for teams
deriving the id manually.

**What the backend does:** for the `scope.id` you send, it verifies the video genuinely
lives inside that product (its category, or any parent/child category linked to the
product). If it can't find that link, it returns this `400`. It is **not** an access
error — it means *"this video isn't in that product."*

### The one correct source: `data.scope`

> ✅ **Just use `data.scope`** from whichever endpoint loaded the video (see the 🚀 table
> at the top). It is the server-resolved, guaranteed-reachable owner — copying it verbatim
> makes this `400` impossible. The manual derivation below is only a fallback.

If you derive it manually, `scope.id` must be the **`_id` of the product whose screen the
user opened** — the **same id you already used to load that screen's content**:

| Screen the user is on | `scope.kind` | `scope.id` = the `_id` you opened the screen with |
|---|---|---|
| Course detail | `"course"` | the Course `_id` (`GET /courses/:id` — also returns `data.scope`) |
| **Package detail** | `"package"` | the Package `_id` (`GET /packages/:id` — also returns `data.scope`) |
| Live course detail | `"liveCourse"` | the Live Course `_id` (`GET /live-courses/:id` — also returns `data.scope`) |
| Browsing videos in a category | (resolved) | use `data.scope` from `GET /video-categories/:id/videos` — don't guess |

> 💡 **The reliable rule:** whatever `:id` you put in the URL that **listed the videos**
> the user is now watching, put that *same* id in `scope.id` with the matching `kind`.
> The video you're sending a heartbeat for came from that list, so by construction it is
> reachable from that id.

### Do NOT send any of these as `scope.id` (all cause this `400`)

- ❌ A **video category / chapter / subject** id (e.g. the `videoCategoryId` on the lecture,
  or a `categoryIds` filter value). This is the #1 cause.
- ❌ The **video's own `_id`**.
- ❌ A **package-category** id (the grouping the package is listed under) instead of the
  **package** id itself.
- ❌ A different product that merely *looks* related. Send the product the user actually
  opened.

### 30-second self-check

1. Log the request body right before the heartbeat fires. Confirm `scope.id` is a 24-char
   hex id and is **identical** to the `:id` you used to fetch this screen's video list.
2. Confirm `scope.kind` matches that screen (`package` for a package screen, etc.).
3. On success, the `200` response body echoes `data.containerType` and `data.containerId`
   — they must equal what you sent. If they do, you're wired correctly.

If `scope.id` is genuinely the product id from the list call and you still get this `400`,
it's a data-linkage problem on that specific product (not your wiring) — capture the
`videoId` + `scope` and send them to backend.

---

## Contract notes for FE

- **Prefer `data.scope`** — every endpoint you load a video from now returns it:
  `GET /video-categories/:id/videos`, `GET /video-categories/:id/videos/:videoId`,
  `GET /courses/:id`, `GET /packages/:id`, `GET /live-courses/:id`. Capture it when you
  load the player and echo it back. It removes all guesswork and makes the
  `400 "not part of scope"` error structurally impossible. (`scope` is `null` only for an
  orphan category linked to no product — skip the heartbeat then.)
- `scope` is **required** on every heartbeat — send it every time, including the first.
- `scope` decides **which product's row** the progress writes to. It does not loosen
  access — entitlement and reachability are validated server-side every call.
- Keep the **same** `scope` for the whole watch session of one screen. Re-using the same
  `scope.id` updates the same row (correct). Watching the same video from a *different*
  product means a *different* `scope.id`, which the backend keeps as a separate row with
  its own resume position — so attribute progress to the product the user is currently inside.
