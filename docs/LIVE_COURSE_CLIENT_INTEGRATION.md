# Live Course — Customer (Client) API Integration Guide

Front-end integration guide for the **live course** customer experience: browse,
buy (with promo codes), watch live, watch recordings, and read the schedule.

---

## 1. Basics

**Base URL:** `{{URL}}/api/v1`

**Auth:** every endpoint here requires a customer Bearer token (from the OTP
login flow):

```
Authorization: Bearer <customer access token>
```

**Response envelope** — all `live-courses` / `live-sessions` endpoints return:

```jsonc
{
  "success": true,
  "code": 200,
  "data": { /* the payload described per-endpoint below */ },
  "message": "Live course fetched.",
  "messages": {}
}
```

> The three **payment** endpoints (`/payment/*`) return a slightly different
> shape — `{ "success": true, "data": {...} }` (no `code`/`messages`). Noted
> again on those endpoints.

On error: `success: false`, an HTTP 4xx/5xx status, and a human `message`. A
`403` from a gated endpoint also puts `purchaseOptions` in `data`.

---

## 2. Screen → endpoint map

| Screen / tab | Endpoints |
|---|---|
| **Course detail header** (name, stat bar, price bar) | `GET /client/live-courses/:id` |
| **Videos tab → "Live Now"** | `GET /client/live-courses/:id/sessions?status=CREATED` → open with `GET /client/live-sessions/:id` |
| **Videos tab → "Previous Live Session"** | `GET /client/live-courses/:id/recordings` (folder-grouped) → open with `GET /client/live-courses/:id/lecture/:videoId` |
| **Recorded live classes list** | `GET /client/live-courses/:id/session-recordings` → open with `GET /client/live-sessions/:id` |
| **Schedule tab** | `GET /client/live-courses/:id/schedule` |
| **My courses** | `GET /client/live-courses/my` |
| **Buy flow** | `POST /payment/apply-promo/live-course` → `POST /payment/create-order/live-course` → Razorpay checkout → `POST /payment/verify` |

---

## 3. Entitlement & the 3-minute preview (read this first)

A live session attached to one or more live courses is **gated**:

- **Subscriber** (active verified subscription to ANY attached course) →
  `accessLevel: "full"` — full playback, no cutoff.
- **Non-subscriber** → a **per-viewer 3-minute preview**. The clock starts the
  first time they open the session and **cannot be reset** by reopening.
  - While inside the window → `accessLevel: "preview"`, playback URLs ARE
    returned, plus `previewExpiresAt` / `previewSecondsRemaining`. The client
    should stop playback when the timer hits 0.
  - After the window → `accessLevel: "preview_ended"`, playback URLs are
    **withheld by the server**, and `purchaseOptions` is returned for the
    "buy to continue" popup.
- A session attached to **no** course → `accessLevel: "full"` for anyone.

`purchaseOptions` lists **every** attached course + its plans — the user can buy
**any one** of them to unlock the session.

---

## 4. Browse

### `GET /client/live-courses`
List active live courses.

Query: `page` (default 1), `limit` (default 20, max 50), `search` (name).

`data`: `{ liveCourses: [LiveCourse], total, page, limit }`

---

### `GET /client/live-courses/:id`  ← course detail header

`data`:
```jsonc
{
  "liveCourse": {
    "_id": "...", "name": "...", "description": "...", "image": "...",
    "level": "intermediate",
    "classType": "live_offline",        // "live" | "live_offline" | "offline"
    "courseEducatorId": { "name": "...", "image": "...", "about": "..." },
    "timetableFiles": [ ... ],
    "...": "..."
  },
  "stats": {
    "subjectsCount": 12,                // folder count → "Subjects 12+"
    "materialsCount": 10,               // → "Materials 10+"
    "classType": "live_offline"         // → "Class Type: Live + Offline"
  },
  "plans": [
    {
      "_id": "...", "name": "3 months", "duration": 3,   // duration is MONTHS
      "price": 3999,
      "originalPrice": 14999,           // null when no MRP set
      "discountPercent": 73,            // computed; 0 when no discount
      "isDefault": true, "status": true
    }
  ],
  "subscribed": true                    // current customer's entitlement
}
```

Use `plans[].price` / `originalPrice` / `discountPercent` for the
`₹3999 ~~₹14,999~~ 73% off` bottom bar.

---

### `GET /client/live-courses/my`  ← "My Courses"
The customer's own subscriptions (verified only).

Query: `status` = `active` | `expired` | `all` (default `all`).

`data`:
```jsonc
{
  "liveCourses": [
    {
      "subscriptionId": "...",
      "liveCourse": { "_id": "...", "name": "...", "image": "...", "level": "...", "isPaid": true, "status": true },
      "plan": { "_id": "...", "name": "3 months", "duration": 3, "price": 3999 },
      "startAt": "2026-05-14T...", "endAt": "2026-08-14T...",
      "paymentStatus": "verified",
      "active": true                    // status && (endAt == null || endAt >= now)
    }
  ],
  "total": 1
}
```

---

## 5. Live sessions (the Videos tab)

### `GET /client/live-courses/:id/sessions`  ← "Live Now" / upcoming list
Metadata-only list — **no playback URLs here** (those come from the session
detail endpoint, which applies the gate).

Query: `status` (`SCHEDULED`|`CREATED`|`ENDED`|`READY`), `upcoming=true`
(SCHEDULED with `scheduledAt >= now`), `page`, `limit`.

- **"Live Now"** = `?status=CREATED`
- **Upcoming** = `?upcoming=true`

`data`: `{ sessions: [{ _id, title, status, scheduledAt, streamId, liveCourseIds, hasRecordings, createdAt, updatedAt }], total, page, limit }`

---

### `GET /client/live-sessions/:id`  ← the "Watch / Join" endpoint
`:id` accepts the Mongo session `_id` **or** the numeric `streamId`.

Applies the entitlement gate (section 3). `data`:
```jsonc
{
  "id": "...", "title": "...", "status": "CREATED",
  "scheduledAt": null, "streamId": 99231,
  "liveCourseIds": ["..."],
  "isLive": true,                       // live on Streamos right now
  "hlsUrl": "https://...m3u8",          // null when accessLevel = "preview_ended"
  "hlsUrls": { "240": "...", "720": "..." },
  "recordings": [ { "quality": "720p", "path": "https://...mp4" } ],
  "liveClassId": "99231",               // Socket.IO room id for chat/polls (string of streamId)
  "accessLevel": "preview",             // "full" | "preview" | "preview_ended"
  "previewSeconds": 180,                // null when "full"
  "previewExpiresAt": "2026-05-14T...", // null when "full"
  "previewSecondsRemaining": 142,       // 0 unless accessLevel = "preview"
  "purchaseOptions": [                  // [] when "full"
    {
      "liveCourseId": "...", "name": "...", "image": "...",
      "plans": [ { "planId": "...", "name": "...", "duration": 3, "price": 3999, "isDefault": true } ]
    }
  ]
}
```

**Client rules:**
- `full` → play to the end.
- `preview` → play, but cut at `previewSecondsRemaining`; then show the popup
  built from `purchaseOptions` (you already have it — no refetch needed).
- `preview_ended` → no URLs; show the popup immediately.
- Live chat / polls: connect Socket.IO using `liveClassId` as the room id
  (only valid once `streamId` exists — status `CREATED` or later).

---

## 6. Recorded lectures

There are **two** recordings views — they're different on purpose:

### `GET /client/live-courses/:id/session-recordings`  ← recorded live classes
The raw Streamos recordings off each past live session — shows even before an
admin files them into folders. Metadata only.

Query: `page`, `limit` (default 50).

`data`:
```jsonc
{
  "liveCourse": { "_id": "...", "name": "...", "image": "..." },
  "subscribed": false,
  "total": 8, "page": 1, "limit": 50,
  "lectures": [
    {
      "sessionId": "...", "title": "...", "status": "READY",
      "streamId": 99231,
      "scheduledAt": "...", "recordedAt": "...",
      "qualities": ["720p", "480p"],    // no mp4 URLs in the list
      "recordingCount": 2,
      "locked": true                    // !subscribed
    }
  ],
  "purchaseOptions": [ ... ]            // [] when subscribed
}
```
To watch one → `GET /client/live-sessions/:sessionId` (applies the preview gate).

### `GET /client/live-courses/:id/recordings`  ← folder-grouped lectures
Videos an admin promoted into folders (+ any manually added).

`data`:
```jsonc
{
  "liveCourse": { "_id": "...", "name": "...", "image": "..." },
  "subscribed": false,
  "totalLectures": 21,
  "folders": [
    {
      "folderId": "...", "title": "Current Affairs", "image": "...", "order": 1,
      "lectures": [
        {
          "_id": "...", "title": "...", "topic": "...",
          "platform": "aws", "priceType": "paid", "order": 0,
          "locked": true,               // !subscribed && priceType != "free"
          "videoUrl": null              // present only when not locked
        }
      ]
    }
  ],
  "purchaseOptions": [ ... ]
}
```

### `GET /client/live-courses/:id/lecture/:videoId`  ← play one folder lecture
`data` on success: `{ _id, title, topic, platform, priceType, videoUrl }`.
On `403` (not subscribed, paid lecture): `data` carries `{ purchaseOptions }`.

---

## 7. Schedule tab

### `GET /client/live-courses/:id/schedule`
Not gated — course info shown to everyone.

Query: `upcoming=true` limits the timetable to classes from now onward.

`data`:
```jsonc
{
  "liveCourse": { "_id": "...", "name": "..." },
  "files": [                            // the "Time Table" file list
    { "title": "Batch Time Table", "fileUrl": "https://...pdf", "order": 0 }
  ],
  "timetable": [                        // derived from scheduled live sessions
    {
      "sessionId": "...",
      "subject": "Current Affairs",     // falls back to session title if unset
      "title": "...",
      "educator": { "_id": "...", "name": "Dr. R. Kumar", "image": "..." }, // or null
      "date": "2026-05-17T09:00:00.000Z",
      "startAt": "2026-05-17T09:00:00.000Z",
      "endAt": "2026-05-17T10:00:00.000Z",  // null if not set
      "status": "SCHEDULED",
      "streamId": null
    }
  ],
  "total": 5
}
```
Group `timetable` by `date` for the Date / Subject / Time table; render `files`
as the downloadable list.

---

## 8. Buy flow (Razorpay)

> These 3 endpoints are under `/api/v1/client/payment` and return
> `{ "success": true, "data": {...} }` (no `code`/`messages`).

### Step 1 (optional) — `POST /payment/apply-promo/live-course`
Preview a promo code's effect before checkout.

Body: `{ "planId": "...", "promocode": "WELCOME10" }`

`data`: `{ planId, liveCourseId, promocode, promocodeId, discountType, discountValue, originalAmount, discountAmount, finalAmount }`

This is preview-only — the discount is **re-validated** server-side at
create-order, so never trust this result for the actual charge.

### Step 2 — `POST /payment/create-order/live-course`
Body: `{ "planId": "...", "promocode": "WELCOME10" }`  *(`promocode` optional)*

`data`:
```jsonc
{
  "subscriptionId": "...",
  "receiptId": "live-...",
  "razorpay": { "orderId": "order_...", "keyId": "rzp_...", "amount": 90000, "currency": "INR" },
  "amountInRupees": 900,
  "liveCourse": { "_id": "...", "name": "..." },
  "plan": { "_id": "...", "duration": 3, "price": 1000 },
  "promo": { "promocodeId": "...", "originalAmount": 1000, "discountAmount": 100, "finalAmount": 900 } // null if no promo
}
```
Open Razorpay checkout with `razorpay.orderId` + `razorpay.keyId` + `razorpay.amount`.
- `409` → customer already has an active subscription to this course.
- `400` → promo invalid, or promo drops the price below the payable minimum.

### Step 3 — `POST /payment/verify`
After Razorpay checkout succeeds, post the ids back:

Body: `{ "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." }`

`data` on success: `{ "kind": "live-course", "subscription": { ... paymentStatus: "verified" ... } }`

Idempotent — re-posting an already-verified order returns `200` with
`message: "Already verified."`. The Razorpay webhook also fulfils it as a
safety net if the app dies before this call.

---

## 9. Quick reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/client/live-courses` | list courses |
| GET | `/client/live-courses/:id` | detail header (stats + plans + subscribed) |
| GET | `/client/live-courses/my` | my subscriptions |
| GET | `/client/live-courses/:id/sessions` | live/upcoming session list |
| GET | `/client/live-sessions/:id` | watch a session (entitlement gate) |
| GET | `/client/live-courses/:id/session-recordings` | recorded live classes list |
| GET | `/client/live-courses/:id/recordings` | folder-grouped recorded lectures |
| GET | `/client/live-courses/:id/lecture/:videoId` | play one folder lecture |
| GET | `/client/live-courses/:id/schedule` | timetable + files |
| POST | `/client/payment/apply-promo/live-course` | promo preview |
| POST | `/client/payment/create-order/live-course` | create Razorpay order |
| POST | `/client/payment/verify` | confirm payment |
