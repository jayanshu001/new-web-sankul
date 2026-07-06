# Notifications — Admin API

Backend contract for the admin-panel Notifications module. Covers compose/send, scheduling, audience targeting, the list table (search/sort/pagination/status), bulk delete, and cancel-scheduled.

**Auth:** Bearer token, role `admin` or `super_admin` on every endpoint.
**Base path:** `/api/v1/admin/notifications`

---

## 1. Send / Schedule

`POST /api/v1/admin/notifications/broadcast`

Accepts JSON **or** `multipart/form-data` (when uploading an image file). For multipart, send the file under field name `image`; the server replaces the body's `image` with the S3 URL.

### Request body

```json
{
  "title": "string (required, frontend cap 100 chars)",
  "body": "string (required, frontend cap 500 chars)",
  "image": "https://... (optional, or upload via multipart)",
  "deepLink": "/courses/abc or app://... (optional)",
  "type": "general (optional, default \"general\")",
  "data": { "anyKey": "anyValue" },

  "platforms": ["ios", "android"],
  "courseIds": ["<courseId>", "..."],
  "userIds":   ["<customerId>", "..."],

  "scheduledAt": "2026-05-15T09:00:00.000Z"
}
```

**Audience rules:**
- Omit `platforms` / `courseIds` / `userIds` entirely → broadcast to all eligible customers (active, not deleted, has FCM token).
- Any combination of the three is ANDed together: platform ∈ list AND has active enrollment in any `courseIds` AND `_id ∈ userIds`.
- `customerIds` is accepted as a backward-compat alias for `userIds`. Prefer `userIds`.

**Scheduling rules:**
- Omit `scheduledAt` → sends immediately (synchronous FCM dispatch).
- Provide `scheduledAt` in the future → stored as `status: "scheduled"`, dispatched by the cron worker within ~1 minute of the target time.
- `scheduledAt` in the past → HTTP **400** `"scheduledAt must be in the future."`

### Response — immediate send

```json
{
  "success": true,
  "message": "Notification sent.",
  "data": {
    "broadcast": true,
    "targetCount": "all",         // or a number for filtered audiences
    "successCount": 1234,
    "failureCount": 7,
    "invalidTokensPruned": 3,
    "status": "sent"              // or "failed" if all FCM sends failed
  }
}
```

### Response — scheduled

```json
{
  "success": true,
  "message": "Notification scheduled.",
  "data": {
    "id": "<notificationId>",
    "status": "scheduled",
    "scheduledAt": "2026-05-15T09:00:00.000Z",
    "audience": { "all": false, "platforms": ["ios"], "courseIds": ["..."], "userIds": ["..."] }
  }
}
```

### Frontend validation (do BEFORE submit)
- `title` required, ≤ 100 chars
- `body` required, ≤ 500 chars
- If "Schedule for later" toggle is on, `scheduledAt > now`
- If "Filtered audience" tab is active, **at least one** of `platforms` / `courseIds` / `userIds` must be non-empty — otherwise the request silently becomes a broadcast.

---

## 2. List

`GET /api/v1/admin/notifications`

Returns admin-log rows only (one row per send, not per recipient).

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | Case-insensitive regex on `title` and `body` (server-side escaped) |
| `status` | enum | — | `sent` \| `scheduled` \| `failed` \| `cancelled` |
| `sortBy` | enum | `createdAt` | `createdAt` \| `scheduledAt` \| `sentAt` \| `status` \| `title` |
| `sortOrder` | enum | `desc` | `asc` \| `desc` |
| `page` | number | `1` | |
| `limit` | number | `10` | max `100` |

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "title": "...",
      "body": "...",
      "image": "https://... | null",
      "deepLink": "/... | null",
      "type": "general",
      "status": "sent",                    // sent | scheduled | failed | cancelled
      "scheduledAt": null,
      "sentAt": "2026-05-12T10:00:00.000Z",
      "failureReason": null,
      "recipientCount": 1234,
      "broadcast": true,
      "audience": {
        "all": true,
        "platforms": [],
        "courseIds": [],
        "userIds": []
      },
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "total": 42, "page": 1, "limit": 10, "totalPages": 5 }
}
```

### Rendering hints

- **When column** — show `scheduledAt` if `status === "scheduled"`, otherwise `sentAt` (falling back to `createdAt`).
- **Status badge** — color map: `sent`=green, `scheduled`=blue, `failed`=red, `cancelled`=gray. On `failed`, show `failureReason` as a tooltip.
- **Audience summary chip** —
  - `audience.all` → "All users"
  - else build from filters: `"iOS"`, `"Android"` (from `platforms`), `"N courses"`, `"N users"`, joined with " · "
- **Recipients column** — show `recipientCount` for sent; "—" for scheduled/cancelled; `0` is valid for failed.

---

## 3. Cancel a scheduled notification

`POST /api/v1/admin/notifications/:id/cancel`

Flips `status: scheduled → cancelled`. Only works while still scheduled — if the cron worker has already claimed it, returns **404**.

### Response

```json
{ "success": true, "message": "Notification cancelled.", "data": { ... } }
```

**UI behavior:** Show "Cancel" action only on rows where `status === "scheduled"`. On 404, refetch the list and toast "Already sent."

---

## 4. Bulk delete

`POST /api/v1/admin/notifications/bulk-delete`

```json
{ "ids": ["<notificationId>", "..."] }
```

Filters out invalid ObjectIds server-side. Empty/all-invalid input → **400**.

### Response

```json
{ "success": true, "message": "Notifications deleted.", "data": { "deletedCount": 5 } }
```

---

## 5. Single delete

`DELETE /api/v1/admin/notifications/:id`

```json
{ "success": true, "message": "Notification deleted." }
```

---

## 6. In-app image banners (unchanged)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/images` | List all banners |
| `POST` | `/images` | Create — multipart with `image` file, body `{ redirectUrl?, active? }` |
| `PUT` | `/images/:id` | Update — same shape as create, all fields optional |
| `DELETE` | `/images/:id` | Delete |

---

## Migration notes (from the previous backend)

| Was | Now |
|---|---|
| `customerIds: string[]` | `userIds: string[]` (alias still accepted) |
| Response had `recipientCount`, `fcmTokensAvailable` | Now `targetCount`, `successCount`, `failureCount`, `invalidTokensPruned`, `status` |
| No status field | `status: sent \| scheduled \| failed \| cancelled` |
| No scheduling | `scheduledAt` on the send request; row holds `scheduledAt`, `sentAt`, `failureReason` |
| No audience snapshot on the row | `audience: { all, platforms, courseIds, userIds }` |
| List had only pagination | List adds `q`, `status`, `sortBy`, `sortOrder` |
| No bulk delete | `POST /bulk-delete` with `{ ids }` |
| No cancel | `POST /:id/cancel` |

---

## Dropdown data sources the compose form needs

- **Courses** for the course multi-select — use the existing admin courses list endpoint the rest of the panel already uses.
- **Users** for the user search multi-select — needs a customer-search endpoint (search by name / phone / email). Confirm whether this exists; if not, the backend team should add one before this feature ships.

---

## Sample flows

### Send to all iOS users in two courses, immediately

```
POST /api/v1/admin/notifications/broadcast
{
  "title": "New mock test available",
  "body":  "Open the app to attempt this week's mock.",
  "deepLink": "/mocks/latest",
  "platforms": ["ios"],
  "courseIds": ["652a...", "652b..."]
}
```

### Schedule a broadcast for tomorrow 9 AM IST

```
POST /api/v1/admin/notifications/broadcast
{
  "title": "Reminder: live class at 10",
  "body":  "Tap to join.",
  "scheduledAt": "2026-05-13T03:30:00.000Z"
}
```

### Cancel that schedule

```
POST /api/v1/admin/notifications/<id>/cancel
```

### List failed sends, newest first

```
GET /api/v1/admin/notifications?status=failed&sortBy=sentAt&sortOrder=desc&page=1&limit=20
```
