# Live Chat Moderation — Client (Mobile/Web) Integration

When an admin uses the moderation tools (delete a message, block/unblock a user), the customer-facing live chat UI must react in real time. This doc covers everything the client app needs to handle.

> Companion to `docs/admin-livechat-moderation.md`, which covers the admin side.

---

## 1. Two new socket events to listen for

The customer's existing socket connection to the live class room receives two new events:

### `message_deleted`

Emitted to **every viewer** in the live class room when an admin deletes a message.

**Payload:**
```json
{
  "messageId": "65f...",
  "liveClassId": "T_17787583234029",
  "deletedAt": "2026-05-22T10:11:12.345Z"
}
```

**Client must:**
- Find the bubble with `_id === messageId` in the local message list and remove it.
- Make the removal **idempotent** — the event can fire while the bubble is already gone (e.g. on rejoin races).

Without this listener, deleted messages stay on every viewer's screen until they refresh.

### `chat_banned`

Emitted **only to the banned customer's own sockets** when an admin blocks them. Right after this event, the backend forcibly disconnects those sockets.

**Payload:**
```json
{
  "message": "You are blocked from sending messages.",
  "reason": "Spamming"
}
```

(`reason` may be `null`.)

**Client must:**
- Disable the chat composer (input + send button).
- Show the `message` text where the composer was (e.g. a greyed-out banner).
- Optionally show `reason` if present.
- Treat this as a **persistent state** — see §2.

---

## 2. Persistent banned state (important)

`chat_banned` is **not** a one-time event. The backend re-enforces the ban every time the customer tries to send:

- If a banned user reconnects (auto-reconnect after the forced disconnect, app reopen, network blip), they can still **view** chat — only sending is blocked.
- If they attempt `send_message` after reconnecting, the socket emits `chat_banned` again instead of `new_message` and no message is saved.

**Client must:**
- Treat receiving `chat_banned` at any point — not just at the initial ban moment — as "enter the disabled-composer state".
- Do **not** assume "I'm only banned if I received `chat_banned` immediately after a ban" — handle it whenever it arrives.
- Don't try to recover by clearing local "banned" state on reconnect. The composer should remain disabled until the user is actually unbanned (see §4).

A simple pattern: keep a local `isBanned` flag that flips `true` on any `chat_banned` event. Composer renders disabled iff `isBanned`. Never flip it back to `false` from the client side based on reconnect / new room join — only flip it back from a real "unban" signal (or app restart, as a last resort).

---

## 3. Reconnect & disconnect behavior

When admin blocks a user, the backend calls `socket.disconnect(true)` on all their chat sockets after emitting `chat_banned`.

**What the client sees:**
1. `chat_banned` event.
2. Socket `disconnect` shortly after (reason: server disconnect).
3. The app's existing auto-reconnect logic kicks in.

**Client must:**
- Let auto-reconnect run normally — banned users can still see chat.
- On reconnect, the user re-joins via `join_live_chat`. They'll receive `chat_history` (with soft-deleted messages already filtered out) as usual.
- Stay in the read-only banned view (composer disabled) — don't re-enable just because the connection came back.

---

## 4. Unban behavior (current limitation)

When admin unbans a customer, the backend does **not** emit a socket event. The customer has to **refresh / reopen the app** to be able to send messages again.

This is intentional for now — keeps the client logic simple. If you want a live "composer re-enables instantly when unbanned" UX, backend can emit a `chat_unbanned` event; ask the backend team to wire it.

For now, no client work is needed for unban beyond:
- Composer is back to enabled on next app launch / page reload (no persisted state needed).
- If you do persist `isBanned` in local storage, also clear it on app reopen or expose a manual "refresh chat" affordance.

---

## 5. What already works (no client changes needed)

These are already handled by the backend; the client gets the right behavior automatically:

- **`chat_history` on join** — soft-deleted messages are filtered out, so deleted bubbles never appear after a reload/rejoin.
- **`GET /api/v1/client/live-chat/:liveClassId/history`** HTTP fallback — same: soft-deleted messages are excluded.
- Polls, viewer count, presence (`user_joined` / `user_left`), poll voting — unchanged.

---

## 6. Quick client implementation checklist

- [ ] Subscribe to `message_deleted` on the live chat socket. Remove the matching bubble (idempotent).
- [ ] Subscribe to `chat_banned` on the live chat socket. Set `isBanned = true`, disable composer, show banner with `message` + optional `reason`.
- [ ] Composer disabled state survives reconnects within the session — don't reset on `connect`/`join_live_chat`.
- [ ] On `disconnect` after a ban: let auto-reconnect proceed; user stays in read-only view.
- [ ] No special unban handling — refresh/relaunch clears the banned state.

---

## 7. Event reference

| Event              | Direction              | Trigger                          | Payload                                                  |
|--------------------|------------------------|----------------------------------|----------------------------------------------------------|
| `message_deleted`  | server → all viewers   | Admin deletes a single message   | `{ messageId, liveClassId, deletedAt }`                  |
| `chat_banned`      | server → banned user   | Admin blocks the user, or banned user attempts to send | `{ message, reason }`                          |
| `new_message`      | server → all viewers   | Anyone sends a message (existing)| `{ _id, liveClassId, customerId/adminId, isAdmin, userName, message, createdAt }` |

---

## 8. Example pseudocode

```ts
// On the live chat screen:
let isBanned = false;
let banReason: string | null = null;

socket.on("message_deleted", ({ messageId }) => {
  setMessages((prev) => prev.filter((m) => m._id !== messageId));
});

socket.on("chat_banned", ({ message, reason }) => {
  isBanned = true;
  banReason = reason ?? null;
  setComposerDisabled(true);
  setBanBanner(message);
});

socket.on("disconnect", () => {
  // Don't touch isBanned. Let auto-reconnect run.
});

socket.on("connect", () => {
  // Re-join room. Do NOT reset isBanned here.
  socket.emit("join_live_chat", { liveClassId });
});

// On unmount / next app launch, the in-memory flag resets naturally —
// that's the current "unban requires refresh" behavior.
```

---

## 9. Open question for product

Do you want a `chat_unbanned` socket event so an unbanned customer's composer re-enables live without a refresh? It's a small backend change; flag it and we'll wire it.
