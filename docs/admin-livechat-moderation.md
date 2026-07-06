# Live Chat Moderation — Admin Frontend Integration

Two moderation actions are now available from the backend:

1. **Delete a single chat message** — removes one message from the live chat view for every viewer in real time.
2. **Block (ban) / Unblock a user** — globally prevents a customer from sending any live-chat messages and immediately disconnects their active chat sockets.

Both actions trigger socket events that the client UI must handle so the change is reflected without a refresh.

---

## 1. Delete a single message

### Endpoint

```
DELETE /api/v1/admin/live-chat/messages/:messageId
```

**Auth:** Bearer token; role `admin`, `super_admin`, or `editor`.

**Response (200):**
```json
{
  "success": true,
  "message": "Message deleted.",
  "data": {
    "messageId": "65f...",
    "liveClassId": "T_17787583234029",
    "deletedAt": "2026-05-22T10:11:12.345Z"
  }
}
```

**Errors:**
- `422` — invalid `messageId`.
- `404` — message not found.
- `200` with `alreadyDeleted: true` — message was already soft-deleted (idempotent).

### UI: where to place

In the Live chat panel (the screenshot you sent), every message bubble should expose a delete affordance on hover (or via long-press on mobile). Recommended:

- A small `⋯` (kebab) menu on each message bubble → "Delete message".
- Show a confirm dialog: *"Delete this message for everyone? This cannot be undone from the UI."*
- On confirm, call the endpoint. On 200, remove the bubble locally — but you'll also receive `message_deleted` over the socket (see below), so make sure the local removal is idempotent.

### Behavior

- The message is **soft-deleted** — the row stays in Mongo (`deletedAt`/`deletedBy` set) so moderation history is auditable, but it's hidden from all chat reads.
- The history endpoint hides soft-deleted messages by default. For moderation review you can fetch them with `?includeDeleted=true` on `GET /api/v1/admin/live-chat/:liveClassId/history`.

---

## 2. Block / Unblock a user from chat

Bans are **global** — a blocked customer cannot send messages in any live chat room. Existing messages are **not** removed at ban time; if you need to clear them, delete them individually.

### 2a. Block (create ban)

```
POST /api/v1/admin/live-chat/bans
```

**Body:**
```json
{
  "customerId": "65f...",
  "reason": "Spamming" // optional, max 500 chars
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Customer banned from live chat.",
  "data": {
    "ban": {
      "_id": "65f...",
      "customerId": "65f...",
      "reason": "Spamming",
      "createdAt": "2026-05-22T10:11:12.345Z"
    }
  }
}
```

**Behavior:**
- Idempotent — banning an already-banned customer returns the existing ban (200).
- The backend immediately disconnects every active chat socket the customer has and emits `chat_banned` to their client (cluster-wide).
- Any subsequent `send_message` from this customer (e.g. via reconnect) is rejected at the socket layer.

**Errors:**
- `422` — invalid `customerId`.
- `404` — customer not found.

### 2b. Unblock (remove ban)

```
DELETE /api/v1/admin/live-chat/bans/:customerId
```

**Response (200):**
```json
{
  "success": true,
  "message": "Customer unbanned.",
  "data": { "customerId": "65f..." }
}
```

If the customer wasn't banned, response is still 200 with `alreadyUnbanned: true` (idempotent).

> **Note:** the unbanned user will need to reconnect their socket (or refresh) to be able to send messages again — there's no `chat_unbanned` socket event today. Tell me if you want one and I'll add it.

### 2c. List currently banned users

```
GET /api/v1/admin/live-chat/bans?page=1&limit=20
```

**Response (200):**
```json
{
  "success": true,
  "message": "Chat bans fetched.",
  "data": {
    "items": [
      {
        "_id": "65f...",
        "customerId": {
          "_id": "65f...",
          "firstName": "Rahul",
          "lastName": "K",
          "phoneNumber": "9876543210"
        },
        "bannedBy": "65f...",
        "reason": "Spamming",
        "createdAt": "2026-05-22T10:11:12.345Z",
        "updatedAt": "2026-05-22T10:11:12.345Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
  }
}
```

### UI: where to place

**On each message bubble (live chat panel):**
- The same `⋯` kebab menu used for "Delete message" should also have **"Block user"** → calls `POST /bans` with the message's `customerId` and an optional reason. Show a confirm dialog.
- For admin messages (`isAdmin: true`), hide both actions.

**A separate "Blocked users" page** (suggested location: under Live → Moderation, or as a tab on the Live chat page):
- Table powered by `GET /bans` showing name / phone / reason / banned-at.
- Each row has an **Unblock** button → calls `DELETE /bans/:customerId`. After success, remove the row from the table.

### Recommended button labels
- Per-message: **Delete** and **Block user** (kebab menu).
- On the Blocked users page: **Unblock** (per row).

---

## 3. Socket events to handle in the admin UI

The admin live-chat panel already subscribes to the live class room. Add two listeners:

### `message_deleted`
Payload:
```json
{ "messageId": "65f...", "liveClassId": "T_...", "deletedAt": "2026-05-22T..." }
```
Action: remove the bubble with `_id === messageId` from the local message list. Fires when **any admin** deletes a message, including this admin — making the local removal idempotent is the easiest way to stay correct.

### `chat_banned`
Payload:
```json
{ "message": "You are blocked from sending messages.", "reason": "Spamming" }
```
This event is emitted to the **banned customer's** sockets only — admin sockets won't normally see it. Customer apps should disable the composer and show `message` to the user. (Mentioned here for completeness; nothing to do in the admin UI.)

---

## 4. Quick implementation checklist for the admin UI

- [ ] Each non-admin chat bubble: hover/long-press `⋯` menu with **Delete** and **Block user**.
- [ ] Delete: confirm dialog → `DELETE /messages/:messageId` → optimistic remove, reconciled by `message_deleted` socket event.
- [ ] Block: prompt for optional reason → `POST /bans` → toast "User blocked".
- [ ] New "Blocked users" page/tab: `GET /bans` with pagination, **Unblock** button on each row → `DELETE /bans/:customerId`.
- [ ] Subscribe to `message_deleted` on the live chat panel and remove matching bubbles.
- [ ] Optional but nice: show a small "Deleted by admin" placeholder for the brief window between the bubble being removed and the next render — or just remove it cleanly.

---

## 5. Endpoint quick reference

| Action | Method + Path | Body |
|--------|---------------|------|
| Delete one message | `DELETE /api/v1/admin/live-chat/messages/:messageId` | — |
| Block user | `POST /api/v1/admin/live-chat/bans` | `{ customerId, reason? }` |
| Unblock user | `DELETE /api/v1/admin/live-chat/bans/:customerId` | — |
| List blocked users | `GET /api/v1/admin/live-chat/bans?page=&limit=` | — |
| Chat history (incl. soft-deleted) | `GET /api/v1/admin/live-chat/:liveClassId/history?includeDeleted=true` | — |

All endpoints require `Authorization: Bearer <token>` and an admin/super_admin/editor role.
