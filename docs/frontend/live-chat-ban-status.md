# Live Chat — Ban Status (Frontend Integration)

How the client app should detect whether the logged-in user is blocked from sending live-chat messages, and how to render the correct UI.

A user can be banned globally from live chat by an admin (one ban row per customer; not scoped to a single live class). The frontend needs to know this so it can disable the chat input and show a clear message — instead of letting the user type, hit send, and only then get rejected.

There are **two signals** the frontend should use together:

1. **REST**, on chat screen mount → know the state up front.
2. **Socket event**, while connected → react if the user gets banned mid-session.

---

## 1. REST — `GET /api/v1/client/live-chat/ban-status`

Call this once when the chat screen / live-class screen mounts (or whenever you'd render the chat input).

### Request

```
GET /api/v1/client/live-chat/ban-status
Authorization: Bearer <accessToken>
```

- Auth: **required** (Bearer token, same as every other client API).
- No query params, no body.

### Response — 200 OK

Not banned:

```json
{
  "success": true,
  "message": "Chat ban status fetched",
  "data": {
    "isBanned": false,
    "reason": null,
    "bannedAt": null
  }
}
```

Banned:

```json
{
  "success": true,
  "message": "Chat ban status fetched",
  "data": {
    "isBanned": true,
    "reason": "Spamming promotional links",
    "bannedAt": "2026-05-20T11:42:08.117Z"
  }
}
```

Fields:

| Field      | Type                  | Notes                                                                 |
|------------|-----------------------|-----------------------------------------------------------------------|
| `isBanned` | `boolean`             | `true` ⇒ user cannot send chat messages anywhere.                     |
| `reason`   | `string \| null`      | Admin-provided reason. May be `null` if admin didn't supply one.      |
| `bannedAt` | `ISO 8601 \| null`    | When the ban was created. Useful if you want to show "banned since X".|

### Error responses

| Status | Meaning                                |
|--------|----------------------------------------|
| 401    | Missing/invalid token — re-auth flow.  |
| 500    | Server error — fall back to socket signal (see §2). |

---

## 2. Socket events — live ban / unban (runtime)

The REST call gives you state at screen-load time. While the socket is connected, the server pushes events when an admin bans or unbans the user during the live stream — so the UI flips in real time without a refresh.

### `chat_banned` — user was just banned

Emitted by the server when:
- An admin bans the user via the admin API while the user is connected, **OR**
- The user attempts `send_message` while already banned.

Payload:

```json
{ "message": "You are blocked from sending messages.", "reason": "Spam" }
```

`reason` may be `null`. After this event fires, **the server force-disconnects the user's chat sockets**. Your socket client will likely auto-reconnect; the reconnect itself succeeds (the ban only blocks sending, not connecting).

FE action: disable input, show the banner.

### `chat_unbanned` — user was just unbanned

Emitted by the server when an admin unbans the user. Reaches any active chat socket the user has (e.g. the one auto-reconnected after the earlier `chat_banned` disconnect).

Payload:

```json
{ "message": "You can send messages again.", "unbannedAt": "2026-05-25T10:14:33.812Z" }
```

FE action: hide the banner, re-enable the input.

> If the user manually reloaded after being banned, they have no active socket to receive `chat_unbanned`. That's fine — the REST `/ban-status` call on next chat screen mount will return `isBanned: false`.

---

## 3. Suggested frontend flow

```ts
// Pseudocode — on chat screen mount
const { isBanned, reason, bannedAt } = await api.get('/api/v1/client/live-chat/ban-status').then(r => r.data);

if (isBanned) {
  showBannedBanner({ reason, bannedAt });
  disableChatInput();
} else {
  enableChatInput();
}

// While socket is connected
socket.on('chat_banned', ({ reason }) => {
  showBannedBanner({ reason, bannedAt: new Date().toISOString() });
  disableChatInput();
});

socket.on('chat_unbanned', () => {
  hideBannedBanner();
  enableChatInput();
});
```

### UI recommendations

- **Banner copy when banned**:
  > You've been blocked from live chat by an admin.
  > Reason: *{reason}* &nbsp;·&nbsp; Since: *{bannedAt formatted}*
  > Contact support if you believe this is a mistake.
- **Disable** the text input and the send button (don't just hide them — users get confused). Keep chat history visible (read-only).
- Don't poll `/ban-status`. Once per chat screen mount is enough; the socket event covers live changes.

---

## 4. What this endpoint does NOT do

- It does not unban anyone — admin-only action via `DELETE /api/v1/admin/live-chat/bans/:customerId`.
- It is not scoped per live class — bans are global across all live chat.
- It does not return message history — use `GET /api/v1/client/live-chat/:liveClassId/history` for that.

---

## 5. Quick checklist for FE integration

- [ ] Call `GET /api/v1/client/live-chat/ban-status` on every chat screen mount.
- [ ] If `isBanned`, render banner + disable input before showing the screen.
- [ ] Subscribe to `chat_banned` socket event; on fire, flip to banned-state.
- [ ] Subscribe to `chat_unbanned` socket event; on fire, flip back to normal state.
- [ ] Ensure the socket client auto-reconnects after the server-side disconnect that follows `chat_banned` (most defaults do).
- [ ] On 401, route to re-auth. On 500, fall back to socket-only enforcement.
