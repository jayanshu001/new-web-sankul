# Resume Sections — Required Frontend Changes

Audience: mobile app team.
Endpoint: `GET /api/v1/client/dashboard/resume`
Symptom this doc fixes: `resumeLecture` is always `null`; `recentPackage` is
often `null` even for users with package access.

The resume API is a strict read of what the player writes into
`LectureProgress`. If the player never writes a row that points to a
live course / package, the API has nothing to return. Backend is correct —
the gaps are entirely on the write side.

---

## TL;DR — checklist

- [ ] **Send `scope` in every heartbeat payload** (new — see §0). Without
      this, the same video watched under multiple containers collapses
      into one row and overwrites itself.
- [ ] **Wire `saveLiveSessionProgressAPI` into the live player.** Mirror the
      4 triggers already in `useVideoScreen.tsx`. (Fixes `resumeLecture`.)
- [ ] **Confirm package-flow heartbeats actually fire** while in a package
      context, and that the `scope` they send is `{kind:"package", id:…}`.
      (Fixes `recentPackage`.)
- [ ] **Always send a heartbeat on first play** (don't wait the full 10
      min), so new sessions appear in `resumeLecture` / `recentCourse`
      within seconds.
- [ ] **Refresh `/dashboard/resume` on home-screen focus.**

---

## 0. NEW: send `scope` with every heartbeat

### Why

Until now, `LectureProgress` had one row per `(customer, video)`. A video
that belonged to both a Course and a Package would have its progress
silently overwritten depending on which screen the user tapped from — and
its parent pointers (`courseId`, `liveCourseId`, `packageId`) were
inferred backend-side by walking category ancestors, which only works for
some shapes.

The backend now upserts **one row per `(customer, video, scope)`**, where
**scope is the container the user is currently inside**. The frontend
already knows this — it's whatever screen the user tapped *from* to open
the player.

### Payload change

**Video heartbeat** — `POST /client/courses/lectures/:videoId/progress`

```jsonc
{
  "positionSec": 2127,
  "durationSec": 2244,
  "scope": {                       //  ← NEW (optional but strongly recommended)
    "kind": "course" | "liveCourse" | "package",
    "id":   "<courseId | liveCourseId | packageId>"
  }
}
```

**Live-session heartbeat** — `POST /client/learning/progress/live-sessions/:liveSessionId`

```jsonc
{
  "positionSec": 1850,
  "durationSec": 3600,
  "scope": {                       //  ← NEW (optional but strongly recommended)
    "kind": "liveCourse" | "package",   // no "course" for live sessions
    "id":   "<liveCourseId | packageId>"
  }
}
```

### Which `kind` to send

Pick the container the user **navigated through** to reach the player.
This is the screen one level above the player in the back stack.

| User journey to the player                            | `scope.kind`  | `scope.id`                  |
|-------------------------------------------------------|---------------|-----------------------------|
| Course detail → lecture                               | `"course"`    | `courseId`                  |
| Package detail → course → lecture                     | `"package"`   | `packageId`                 |
| Package detail → live course → lecture                | `"package"`   | `packageId`                 |
| Live course detail → live session                     | `"liveCourse"`| `liveCourseId`              |
| My-Learning "Resume Now" deeplink                     | use the `scopeKind` returned by `/learning/progress/my` for that card |

**Rule of thumb:** when the user is *inside* a Package, scope is package
— even if the lecture also lives under a course. The Package owns the
user's mental context; preserving it makes the resume cards behave
intuitively (resuming from "GCERT Smart Course" keeps them inside that
package).

### Back-compat

The field is **optional**. Old app builds that don't send it will keep
working exactly as before — the backend falls back to the legacy
single-row write path. New rows from new builds, and old rows
(after backfill), are scope-keyed.

### Acceptance check

Watch the same video first via the Course flow, then via the Package
flow. Call `GET /learning/progress/my`. You should now see two
independent rows (or two independent cards) — Course progress at X%,
Package progress at Y% — not one replacing the other.

---

## 1. Why `resumeLecture` is null — and how to fix it

### Root cause

From your own `VIDEO_PROGRESS.md` §2:

> No heartbeat, no pause-flush, no back-press save is implemented [for live
> session recordings]. The player position is tracked in `playerPositionRef`
> in `useLiveVideoScreen.tsx` only for attaching timestamps to notes — it
> is never posted to the backend.

`saveLiveSessionProgressAPI` (`POST /client/learning/progress/live-sessions/{liveSessionId}`)
is the **only** writer that reliably stamps `liveCourseId` on a
`LectureProgress` row. The app never calls it ⇒ no row ever has
`liveCourseId` ⇒ the purple "Resume Learning" card is always empty.

### Required change

In `src/screens/app/liveCourseMaterials/useLiveVideoScreen.tsx`, wire the
**same 4 triggers** that `useVideoScreen.tsx` already implements. Reuse the
existing pattern — don't invent a new one.

| Trigger             | When                                                                 |
|---------------------|----------------------------------------------------------------------|
| Heartbeat (10 min)  | `position >= lastHeartbeatPosition + PROGRESS_HEARTBEAT_INTERVAL_MS` |
| Completion          | `position / duration >= 0.95` (fire once, then suppress)             |
| Pause               | `play → pause` transition (skip initial mount)                       |
| Back-press / unmount| Before navigation away / on cleanup                                  |

Sketch (adapt names to match your hook):

```ts
// useLiveVideoScreen.tsx
import { saveLiveSessionProgressAPI } from "@/api/services/learningProgressApi";

const isSavingRef = useRef(false);
const lastHeartbeatPosRef = useRef(0);
const completedFiredRef = useRef(false);

const persistLiveProgress = useCallback(async (reason: string) => {
  if (isSavingRef.current) return;
  const positionSec = Math.floor(playerPositionRef.current);
  const durationSec = Math.floor(playerDurationRef.current);
  if (durationSec <= 0) return;
  isSavingRef.current = true;
  try {
    await saveLiveSessionProgressAPI(liveSessionId, { positionSec, durationSec });
  } catch (e) {
    // swallow — next heartbeat will retry
  } finally {
    isSavingRef.current = false;
  }
}, [liveSessionId]);

// 1) Heartbeat + completion (inside onTimeUpdate handler)
const onTimeUpdate = (sec: number) => {
  playerPositionRef.current = sec;
  if (sec - lastHeartbeatPosRef.current >= 10 * 60) {
    lastHeartbeatPosRef.current = sec;
    persistLiveProgress("heartbeat");
  }
  if (!completedFiredRef.current
      && playerDurationRef.current > 0
      && sec / playerDurationRef.current >= 0.95) {
    completedFiredRef.current = true;
    persistLiveProgress("complete");
  }
};

// 2) Pause flush
const onPauseChange = (paused: boolean) => {
  if (paused && hasStartedRef.current) persistLiveProgress("pause");
};

// 3) Back-press
const handleBackPress = () => { persistLiveProgress("back"); /* nav back */ };

// 4) Unmount
useEffect(() => () => { persistLiveProgress("unmount"); }, [persistLiveProgress]);
```

**Important:** the `liveSessionId` you pass MUST be the live-session
identifier — not a Video id, not a livestream URL. The backend uses it to
look up `LiveSession.liveCourseIds` and stamp the correct `liveCourseId`.

### Acceptance check

After implementing, watch any live session for ~15 seconds, kill the screen,
then call `GET /api/v1/client/dashboard/resume`. `resumeLecture` should
return a non-null card with `type: "live"` and a real `liveCourseId`.

---

## 2. Why `recentPackage` is null — and how to fix it

### Root cause

The package card lights up when a `LectureProgress` row has `packageId` set.
The backend stamps `packageId` only when, at the moment of the heartbeat,
the user holds an active `PackageCourseSubscription` with `targetPackageId`
covering the played video.

There are two common ways this silently misses:

1. **The user reached the course via a direct course sub, not a package
   sub.** Nothing to do here — there's genuinely no package to resume.
   This is correct behavior.
2. **The user is in a package context but the existing video heartbeat
   isn't actually being called** (e.g. video playback path bypasses
   `useVideoScreen`, or `saveVideoProgressAPI` is short-circuited for that
   flow).

### Required check

For a user known to hold a package subscription, while playing a
course-video inside that package:

1. Confirm `saveVideoProgressAPI` is called (network log) with the right
   `videoId`.
2. Confirm the response contains a row with `packageId` populated. If yes,
   the next `/dashboard/resume` call will return `recentPackage`. If no,
   the user doesn't actually hold a `targetPackageId` sub — talk to backend.

No frontend code change needed beyond ensuring heartbeats fire for every
playback path. **Do not** add a separate "track package open" call —
package recency is derived purely from lecture activity.

---

## 3. First-play heartbeat (UX improvement)

Right now heartbeats only fire after 10 minutes of playback. That means a
user who watches a lecture for 2 minutes and exits will only trigger the
pause/back/unmount flush — fine when those fire, but on iOS app-killed and
some background-suspend cases those can be missed.

**Recommended:** send one heartbeat at `position >= 5s` on first play, in
addition to the existing 10-min cadence. One extra call per lecture, but
guarantees the row exists almost immediately so the home screen reflects
"started watching X" right after the user exits.

```ts
if (!firstHeartbeatFiredRef.current && sec >= 5) {
  firstHeartbeatFiredRef.current = true;
  lastHeartbeatPosRef.current = sec;
  persistVideoProgress("first-play");   // or persistLiveProgress for the live hook
}
```

Apply the same change in both `useVideoScreen.tsx` and the new
`useLiveVideoScreen.tsx` save path.

---

## 4. Refresh policy for the home screen

`/dashboard/resume` is a *read* of the latest `LectureProgress` rows. To
keep the home screen current:

- Call **once on home-screen mount**.
- Call **again on screen focus** (when the user returns from any player).
  This is when newly-written progress will reflect into the resume cards.
- **Do not** poll on a timer — the data only changes when the user watches
  something, and the player flushes on pause/back/unmount.

React Navigation example:

```ts
useFocusEffect(useCallback(() => {
  fetchResumeDashboard();
}, []));
```

---

## 5. Things NOT to do

- **Do not** add a separate "track open" call for packages, courses, or
  live courses. Recency is derived from lecture activity only. Adding open
  events would create rows the resume cards interpret as "user resumed
  here" when they actually didn't watch anything.
- **Do not** call `saveLiveSessionProgressAPI` with a Video id or any other
  id type. It must be a `LiveSession._id`.
- **Do not** call `saveVideoProgressAPI` for live sessions or YouTube
  videos. YouTube is already guarded; live should route to
  `saveLiveSessionProgressAPI`.
- **Do not** "fix" empty resume sections by inserting placeholder cards.
  If all three are `null`, hide the block — that's the spec.

---

## 6. Verification matrix

After all changes, this is the expected behavior for a fresh user:

| User action                                          | Card that lights up |
|------------------------------------------------------|---------------------|
| Watches a course video (direct course sub)           | `recentCourse`      |
| Watches a course video (package sub)                 | `recentCourse` + `recentPackage` |
| Watches a live session                               | `resumeLecture`     |
| Watches a live-course recorded video (package sub)   | All three (if the LiveCourse → category link exists) |
| Brand-new user, no plays                             | all three `null`    |

If any row in this table doesn't behave as listed after the fixes, ping
backend with: the user id, the `videoId` / `liveSessionId` played, and the
network log of the heartbeat call.

---

## Key files (frontend)

| File                                                          | What to change           |
|---------------------------------------------------------------|--------------------------|
| `src/screens/app/liveCourseMaterials/useLiveVideoScreen.tsx`  | Add the 4 save triggers  |
| `src/screens/app/CourseMaterials/useVideoScreen.tsx`          | Add first-play heartbeat |
| `src/api/services/learningProgressApi.ts`                     | No change — both APIs already exist |
| Home screen container                                         | Add `useFocusEffect` to refresh `/dashboard/resume` |
