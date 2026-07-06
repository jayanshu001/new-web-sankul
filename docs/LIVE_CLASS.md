# Live Class — Chat & Poll Integration Guide

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [REST API — Admin (Poll Management)](#rest-api--admin-poll-management)
4. [REST API — Client (Read-only)](#rest-api--client-read-only)
5. [Socket.IO — Connection](#socketio--connection)
6. [Socket.IO — Client → Server Events](#socketio--client--server-events)
7. [Socket.IO — Server → Client Events](#socketio--server--client-events)
8. [Data Models](#data-models)
9. [React Native Integration](#react-native-integration)
10. [Error Reference](#error-reference)
11. [Flow Diagrams](#flow-diagrams)

---

## Overview

The Live Class feature provides two real-time capabilities:

| Feature | Transport | Who can use |
|---------|-----------|-------------|
| **Live Chat** | Socket.IO | Any authenticated customer in the room |
| **Live Poll** | Socket.IO (receive/vote) + REST (create/manage) | Students via socket; Admin via REST API |

- Students connect via **Socket.IO** using a customer JWT.
- Admins manage polls via **REST API** (no socket connection needed).
- All real-time events are broadcast to everyone in the live class room.

---

## Authentication

### Customer (Socket.IO)
Customers must pass a valid JWT in the socket handshake `auth` object:

```js
const socket = io("https://your-server.com", {
  auth: { token: "<customer_access_token>" },
  path: "/socket.io",
  transports: ["websocket"],
});
```

The server validates:
1. JWT signature (`JWT_ACCESS_SECRET`)
2. Active session in Redis (`customer_session:<id>`)
3. Customer account is active and not deleted

If any check fails, the connection is rejected with `"Invalid or expired token"`.

### Admin (REST API)
All admin endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <admin_access_token>
```

Allowed roles: `admin`, `super_admin`, `editor`

---

## REST API — Admin (Poll Management)

Base URL: `/api/v1/admin/live-polls`

---

### POST `/` — Create Poll

Creates a new poll for a live class. If a poll is already active for that class, it is automatically closed first.

**Request Body**
```json
{
  "liveClassId": "class_abc123",
  "question": "Which topic should we cover next?",
  "options": ["Data Structures", "Algorithms", "System Design", "Database Concepts"]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `liveClassId` | string | Yes | ID of the live class |
| `question` | string | Yes | Max 1000 characters |
| `options` | string[] | Yes | Min 2, max 6 items. Each max 300 chars |

**Response `201`**
```json
{
  "success": true,
  "message": "Poll created and sent to live class.",
  "data": {
    "poll": {
      "_id": "poll_id_here",
      "liveClassId": "class_abc123",
      "question": "Which topic should we cover next?",
      "options": [
        { "text": "Data Structures", "votes": 0 },
        { "text": "Algorithms", "votes": 0 },
        { "text": "System Design", "votes": 0 },
        { "text": "Database Concepts", "votes": 0 }
      ],
      "totalVotes": 0,
      "createdByName": "Admin Name",
      "createdAt": "2026-05-12T10:00:00.000Z"
    }
  }
}
```

**Side effect**: Broadcasts `poll_created` to all students in the room.

---

### GET `/:liveClassId` — List Polls by Class

Returns all polls (active + closed) for a live class, newest first.

**Query Parameters**

| Param | Default | Notes |
|-------|---------|-------|
| `page` | `1` | Page number |
| `limit` | `20` | Max 50 |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "polls": [ /* Poll objects */ ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

---

### GET `/:pollId/results` — Get Poll Results

Returns full poll details with per-option vote counts and total unique voter count.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "poll": {
      "_id": "poll_id_here",
      "question": "Which topic should we cover next?",
      "options": [
        { "text": "Data Structures", "votes": 12 },
        { "text": "Algorithms", "votes": 8 }
      ],
      "totalVotes": 20,
      "isActive": true,
      "createdByName": "Admin Name",
      "createdAt": "2026-05-12T10:00:00.000Z",
      "closedAt": null
    },
    "voterCount": 20
  }
}
```

---

### PATCH `/:pollId/close` — Close Poll

Closes an active poll. Students can no longer vote.

**Response `200`**
```json
{
  "success": true,
  "message": "Poll closed.",
  "data": {}
}
```

**Side effect**: Broadcasts `poll_closed` to all students in the room.

---

### PATCH `/:pollId` — Edit Poll

Updates question and/or options. Only allowed when the poll is active **and has zero votes**.

**Request Body**
```json
{
  "question": "Updated question?",
  "options": ["Option A", "Option B", "Option C"]
}
```

Both fields are optional, but at least one must be provided.

**Response `200`**
```json
{
  "success": true,
  "message": "Poll updated.",
  "data": { "poll": { /* updated poll object */ } }
}
```

**Side effect**: Broadcasts `poll_updated` to all students — they re-render the poll card and reset their vote state.

---

### DELETE `/:pollId` — Delete Poll

Permanently deletes the poll and all votes cast for it.

**Response `200`**
```json
{
  "success": true,
  "message": "Poll deleted.",
  "data": {}
}
```

**Side effect**: Broadcasts `poll_deleted` to all students — they dismiss the poll card.

---

## REST API — Client (Read-only)

### GET `/api/v1/client/live-polls/:liveClassId/active` — Get Active Poll

Returns the currently active poll for a live class, including whether the customer has already voted.

**Auth**: Customer Bearer token

**Response `200`** (poll exists)
```json
{
  "success": true,
  "data": {
    "poll": {
      "_id": "poll_id_here",
      "question": "Which topic should we cover next?",
      "options": [
        { "text": "Data Structures", "votes": 12 },
        { "text": "Algorithms", "votes": 8 }
      ],
      "totalVotes": 20,
      "createdByName": "Admin Name",
      "createdAt": "2026-05-12T10:00:00.000Z"
    },
    "myVote": 0
  }
}
```

`myVote` is the option index the customer voted for, or `null` if not yet voted.

**Response `204`** — No active poll.

---

### GET `/api/v1/client/live-chat/:liveClassId/history` — Get Chat History

Returns recent chat messages for a live class (for pre-load or pagination).

**Auth**: Customer Bearer token

**Query Parameters**

| Param | Default | Notes |
|-------|---------|-------|
| `limit` | `50` | Number of messages to return |
| `before` | — | ISO date string for cursor-based pagination (load older messages) |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "_id": "msg_id",
        "liveClassId": "class_abc123",
        "customerId": "customer_id",
        "userName": "Rahul Sharma",
        "message": "Hello everyone!",
        "createdAt": "2026-05-12T10:05:00.000Z"
      }
    ]
  }
}
```

---

## Socket.IO — Connection

**Endpoint**: `wss://your-server.com/socket.io`  
**Transport**: WebSocket preferred, falls back to polling  
**Authentication**: Pass `token` in handshake auth

```js
import { io } from "socket.io-client";

const socket = io("https://your-server.com", {
  auth: { token: customerAccessToken },
  path: "/socket.io",
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
});
```

---

## Socket.IO — Client → Server Events

These are events your app **emits** to the server.

---

### `join_live_chat`

Join a live class room. Must be the first event after connecting.

**Payload**
```js
socket.emit("join_live_chat", { liveClassId: "class_abc123" });
```

**Server responds with** (emitted back to this socket only):
- `chat_history` — last 50 messages
- `active_poll` — current active poll + whether user already voted (if any poll is active)

---

### `send_message`

Send a chat message to everyone in the room.

**Payload**
```js
socket.emit("send_message", {
  liveClassId: "class_abc123",
  message: "Great explanation!"
});
```

Constraints: message must be non-empty, max 2000 characters.

**Server responds with**: `new_message` broadcast to all in the room.

---

### `submit_vote`

Cast a vote on the active poll.

**Payload**
```js
socket.emit("submit_vote", {
  pollId: "poll_id_here",
  optionIndex: 2   // zero-based index into poll.options[]
});
```

Constraints:
- Poll must exist and be active
- `optionIndex` must be a valid index
- Each customer can only vote once per poll (duplicate triggers `error` event)

**Server responds with**: `poll_update` broadcast to all in the room.

---

### `leave_live_chat`

Leave the room (e.g. when navigating away).

**Payload**
```js
socket.emit("leave_live_chat", { liveClassId: "class_abc123" });
```

---

## Socket.IO — Server → Client Events

These are events your app **listens** for.

---

### `chat_history`

Sent immediately after `join_live_chat`. Contains the last 50 messages, oldest first.

```js
socket.on("chat_history", ({ liveClassId, messages }) => {
  // messages: ChatMessage[]
  setMessages(messages);
});
```

---

### `new_message`

Broadcast to everyone in the room when any student sends a message.

```js
socket.on("new_message", (message) => {
  // { _id, liveClassId, customerId, userName, message, createdAt }
  setMessages(prev => [...prev, message]);
});
```

---

### `active_poll`

Sent to the joining socket only, if a poll is currently active.

```js
socket.on("active_poll", ({ poll, myVote }) => {
  // poll: Poll object
  // myVote: number (option index) | null
  setActivePoll(poll);
  setMyVote(myVote);
});
```

---

### `poll_created`

Broadcast to everyone when admin launches a new poll. Show the poll card.

```js
socket.on("poll_created", ({ poll }) => {
  setActivePoll(poll);
  setMyVote(null); // reset — fresh poll
});
```

---

### `poll_update`

Broadcast to everyone after each vote. Use this to update vote bars in real time.

```js
socket.on("poll_update", ({ pollId, options, totalVotes }) => {
  // options: [{ text, votes }]
  setActivePoll(prev =>
    prev?._id === pollId ? { ...prev, options, totalVotes } : prev
  );
});
```

---

### `poll_updated`

Broadcast to everyone when admin edits question/options (only possible with 0 votes). Re-render the poll card and reset the vote state.

```js
socket.on("poll_updated", ({ poll }) => {
  setActivePoll(poll);
  setMyVote(null); // options changed, previous vote is void
});
```

---

### `poll_closed`

Broadcast to everyone when admin closes the poll. Hide voting buttons, show final results.

```js
socket.on("poll_closed", ({ pollId }) => {
  setActivePoll(prev => prev?._id === pollId ? null : prev);
});
```

---

### `poll_deleted`

Broadcast to everyone when admin deletes the poll. Remove the poll card entirely.

```js
socket.on("poll_deleted", ({ pollId }) => {
  setActivePoll(prev => prev?._id === pollId ? null : prev);
});
```

---

### `error`

Sent to the individual socket when the server rejects an action.

```js
socket.on("error", ({ message }) => {
  showToast(message);
  // Common messages:
  // "You have already voted on this poll"
  // "Poll is closed"
  // "Poll not found"
  // "Message cannot be empty"
  // "Message too long (max 2000 characters)"
  // "liveClassId is required"
  // "pollId and optionIndex are required"
  // "Invalid option"
});
```

---

## Data Models

### Poll
```typescript
interface Poll {
  _id: string;
  liveClassId: string;
  question: string;             // max 1000 chars
  options: PollOption[];        // 2–6 items
  totalVotes: number;
  isActive: boolean;
  createdByName: string;
  createdAt: string;            // ISO date
  closedAt?: string;            // ISO date, set when closed
}

interface PollOption {
  text: string;                 // max 300 chars
  votes: number;
}
```

### ChatMessage
```typescript
interface ChatMessage {
  _id: string;
  liveClassId: string;
  customerId: string;
  userName: string;
  message: string;              // max 2000 chars
  createdAt: string;            // ISO date
}
```

---

## React Native Integration

### Install dependency
```bash
npm install socket.io-client
```

### Service class — `src/services/LiveClassSocket.ts`
```typescript
import { io, Socket } from "socket.io-client";

export class LiveClassSocket {
  private socket: Socket | null = null;
  private events: LiveClassEvents = {};

  connect(serverUrl: string, token: string, events: LiveClassEvents) {
    if (this.socket?.connected) return;
    this.events = events;

    this.socket = io(serverUrl, {
      auth: { token },
      path: "/socket.io",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    this.socket.on("connect",    () => this.events.onConnected?.());
    this.socket.on("disconnect", () => this.events.onDisconnected?.());
    this.socket.on("error",      ({ message }) => this.events.onError?.(message));

    this.socket.on("chat_history",  ({ messages })      => this.events.onChatHistory?.(messages));
    this.socket.on("new_message",   (msg)               => this.events.onNewMessage?.(msg));
    this.socket.on("active_poll",   ({ poll, myVote })  => this.events.onActivePoll?.(poll, myVote));
    this.socket.on("poll_created",  ({ poll })           => this.events.onPollCreated?.(poll));
    this.socket.on("poll_update",   (data)              => this.events.onPollUpdate?.(data.pollId, data.options, data.totalVotes));
    this.socket.on("poll_updated",  ({ poll })           => this.events.onPollUpdated?.(poll));
    this.socket.on("poll_closed",   ({ pollId })         => this.events.onPollClosed?.(pollId));
    this.socket.on("poll_deleted",  ({ pollId })         => this.events.onPollDeleted?.(pollId));
  }

  joinRoom(liveClassId: string)  { this.socket?.emit("join_live_chat",   { liveClassId }); }
  leaveRoom(liveClassId: string) { this.socket?.emit("leave_live_chat",  { liveClassId }); }
  sendMessage(liveClassId: string, message: string) {
    this.socket?.emit("send_message", { liveClassId, message });
  }
  submitVote(pollId: string, optionIndex: number) {
    this.socket?.emit("submit_vote", { pollId, optionIndex });
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  get isConnected() { return this.socket?.connected ?? false; }
}

export interface LiveClassEvents {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
  onChatHistory?: (messages: ChatMessage[]) => void;
  onNewMessage?: (message: ChatMessage) => void;
  onActivePoll?: (poll: Poll, myVote: number | null) => void;
  onPollCreated?: (poll: Poll) => void;
  onPollUpdate?: (pollId: string, options: PollOption[], totalVotes: number) => void;
  onPollUpdated?: (poll: Poll) => void;
  onPollClosed?: (pollId: string) => void;
  onPollDeleted?: (pollId: string) => void;
}
```

### React hook — `src/hooks/useLiveClass.ts`
```typescript
import { useEffect, useRef, useCallback, useState } from "react";
import { LiveClassSocket, ChatMessage, Poll, PollOption } from "../services/LiveClassSocket";

interface Options {
  serverUrl: string;
  token: string;
  liveClassId: string;
}

export function useLiveClass({ serverUrl, token, liveClassId }: Options) {
  const socketRef  = useRef<LiveClassSocket | null>(null);
  const [isConnected,   setIsConnected]   = useState(false);
  const [messages,      setMessages]      = useState<ChatMessage[]>([]);
  const [activePoll,    setActivePoll]    = useState<Poll | null>(null);
  const [myVote,        setMyVote]        = useState<number | null>(null);
  const [pollDismissed, setPollDismissed] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    const client = new LiveClassSocket();
    socketRef.current = client;

    client.connect(serverUrl, token, {
      onConnected:    () => { setIsConnected(true); client.joinRoom(liveClassId); },
      onDisconnected: () => setIsConnected(false),
      onError:        (msg) => setError(msg),

      onChatHistory: (history) => setMessages(history),
      onNewMessage:  (msg)     => setMessages(prev => [...prev, msg]),

      onActivePoll:  (poll, vote) => { setActivePoll(poll); setMyVote(vote); setPollDismissed(false); },
      onPollCreated: (poll)       => { setActivePoll(poll); setMyVote(null); setPollDismissed(false); },
      onPollUpdate:  (pollId, options, totalVotes) =>
        setActivePoll(prev => prev?._id === pollId ? { ...prev, options, totalVotes } : prev),
      onPollUpdated: (poll) => { setActivePoll(poll); setMyVote(null); },
      onPollClosed:  (pollId) =>
        setActivePoll(prev => prev?._id === pollId ? null : prev),
      onPollDeleted: (pollId) =>
        setActivePoll(prev => prev?._id === pollId ? null : prev),
    });

    return () => {
      client.leaveRoom(liveClassId);
      client.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, token, liveClassId]);

  const sendMessage = useCallback((message: string) => {
    socketRef.current?.sendMessage(liveClassId, message);
  }, [liveClassId]);

  const submitVote = useCallback((pollId: string, optionIndex: number) => {
    socketRef.current?.submitVote(pollId, optionIndex);
    setMyVote(optionIndex); // optimistic update
  }, []);

  const clearError    = useCallback(() => setError(null), []);
  const dismissPoll   = useCallback(() => setPollDismissed(true), []);

  const showPoll = activePoll !== null && !pollDismissed;

  return { isConnected, messages, activePoll, myVote, showPoll, error, sendMessage, submitVote, dismissPoll, clearError };
}
```

### Screen usage — `src/screens/LiveClassScreen.tsx`
```typescript
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet
} from "react-native";
import { useLiveClass } from "../hooks/useLiveClass";

export default function LiveClassScreen({ liveClassId, customerToken }) {
  const [input, setInput] = useState("");

  const {
    isConnected, messages, activePoll,
    myVote, showPoll, error,
    sendMessage, submitVote, dismissPoll, clearError,
  } = useLiveClass({
    serverUrl: "https://your-server.com",
    token: customerToken,
    liveClassId,
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput("");
  };

  return (
    <View style={styles.container}>

      {/* Connection status */}
      <View style={styles.statusBar}>
        <View style={[styles.dot, { backgroundColor: isConnected ? "#22c55e" : "#ef4444" }]} />
        <Text style={styles.statusText}>{isConnected ? "Live" : "Connecting..."}</Text>
      </View>

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError}>
          <Text style={styles.errorText}>{error}  ✕</Text>
        </TouchableOpacity>
      )}

      {/* Active poll card — hidden when student dismisses it */}
      {showPoll && activePoll && (
        <View style={styles.pollCard}>
          <View style={styles.pollHeader}>
            <View>
              <Text style={styles.pollLabel}>LIVE POLL</Text>
              <Text style={styles.pollQuestion}>{activePoll.question}</Text>
            </View>
            {/* Dismiss button — student can close the poll card */}
            <TouchableOpacity style={styles.dismissBtn} onPress={dismissPoll}>
              <Text style={styles.dismissText}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.pollMeta}>{activePoll.totalVotes} votes</Text>

          {activePoll.options.map((opt, idx) => {
            const pct = activePoll.totalVotes > 0
              ? Math.round((opt.votes / activePoll.totalVotes) * 100) : 0;
            const voted = myVote === idx;

            return (
              <TouchableOpacity
                key={idx}
                style={[styles.option, voted && styles.optionVoted]}
                onPress={() => myVote === null && submitVote(activePoll._id, idx)}
                disabled={myVote !== null}
              >
                <View style={[styles.bar, { width: `${pct}%` }]} />
                <Text style={styles.optionText}>{voted ? "✓ " : ""}{opt.text}</Text>
                {myVote !== null && <Text style={styles.pct}>{pct}%</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Chat messages */}
      <FlatList
        data={messages}
        keyExtractor={m => m._id}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.msg}>
            <Text style={styles.userName}>{item.userName}</Text>
            <Text style={styles.msgText}>{item.message}</Text>
          </View>
        )}
      />

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor="#64748b"
          maxLength={2000}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#0f172a" },
  statusBar:    { flexDirection: "row", alignItems: "center", gap: 6, padding: 8, backgroundColor: "#1e293b" },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  statusText:   { color: "#94a3b8", fontSize: 12 },
  errorBanner:  { backgroundColor: "#7f1d1d", padding: 10, alignItems: "center" },
  errorText:    { color: "#fca5a5", fontSize: 13 },
  pollCard:     { margin: 12, padding: 14, backgroundColor: "#1e293b", borderRadius: 12, borderLeftWidth: 3, borderLeftColor: "#6366f1" },
  pollHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  pollLabel:    { color: "#818cf8", fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  pollQuestion: { color: "#f1f5f9", fontSize: 15, fontWeight: "700" },
  dismissBtn:   { width: 26, height: 26, borderRadius: 13, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", alignItems: "center", justifyContent: "center" },
  dismissText:  { color: "#64748b", fontSize: 16, lineHeight: 20 },
  pollMeta:     { color: "#64748b", fontSize: 11, marginBottom: 10 },
  option:       { position: "relative", borderRadius: 8, overflow: "hidden", backgroundColor: "#0f172a", padding: 10, marginBottom: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  optionVoted:  { borderColor: "#6366f1", borderWidth: 1 },
  bar:          { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#312e81", borderRadius: 8 },
  optionText:   { color: "#e2e8f0", fontSize: 13, fontWeight: "600", zIndex: 1 },
  pct:          { color: "#818cf8", fontSize: 12, fontWeight: "700", zIndex: 1 },
  list:         { flex: 1, paddingHorizontal: 12 },
  msg:          { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  userName:     { color: "#818cf8", fontSize: 11, fontWeight: "700", marginBottom: 2 },
  msgText:      { color: "#e2e8f0", fontSize: 14 },
  inputRow:     { flexDirection: "row", padding: 10, gap: 8, backgroundColor: "#1e293b", borderTopWidth: 1, borderTopColor: "#334155" },
  input:        { flex: 1, backgroundColor: "#0f172a", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, color: "#f1f5f9", fontSize: 14 },
  sendBtn:      { backgroundColor: "#6366f1", borderRadius: 20, paddingHorizontal: 16, justifyContent: "center" },
  sendBtnText:  { color: "#fff", fontWeight: "700", fontSize: 14 },
});
```

---

## Error Reference

### REST API errors

| Status | Message | Cause |
|--------|---------|-------|
| `422` | `liveClassId is required` | Missing or non-string field |
| `422` | `question is required` | Missing or empty question |
| `422` | `Provide between 2 and 6 options` | Option count out of range |
| `422` | `All options must be non-empty strings` | Blank option in array |
| `422` | `Invalid pollId` | Poll ID is not a valid ObjectId |
| `400` | `Poll is already closed` | Trying to close an already-closed poll |
| `400` | `Cannot edit a closed poll` | Edit attempted on closed poll |
| `400` | `Cannot edit a poll that already has votes` | Edit blocked once any vote is cast |
| `404` | `Poll not found` | Poll ID does not exist |
| `500` | `Failed to create/close/update/delete poll` | Unexpected server error |

### Socket.IO errors (via `error` event)

| Message | Cause |
|---------|-------|
| `Authentication token required` | No token in handshake |
| `Invalid or expired token` | Bad JWT, wrong type, or Redis session mismatch |
| `liveClassId is required` | Missing field in `join_live_chat` or `send_message` |
| `pollId and optionIndex are required` | Missing fields in `submit_vote` |
| `Poll not found` | Poll ID does not exist in DB |
| `Poll is closed` | Voting attempted on a closed poll |
| `Invalid option` | `optionIndex` out of range |
| `You have already voted on this poll` | Duplicate vote attempt |
| `Message cannot be empty` | Empty string after trim |
| `Message too long (max 2000 characters)` | Message exceeds limit |
| `Failed to send message` | DB write error |
| `Failed to submit vote` | DB write error |

---

## Flow Diagrams

### Student joining a live class

```
Student App                    Server
    |                             |
    |-- connect (JWT) ----------->|
    |                             |-- verify JWT
    |                             |-- check Redis session
    |                             |-- check DB customer
    |<-- connected ---------------|
    |                             |
    |-- join_live_chat ---------->|
    |<-- chat_history (50 msgs) --|
    |<-- active_poll (if any) ----|
    |                             |
```

### Student sending a chat message

```
Student App                    Server               Other Students
    |                             |                       |
    |-- send_message ------------>|                       |
    |                             |-- save to MongoDB      |
    |                             |-- emit new_message --->|
    |<-- new_message (broadcast) -+----------------------->|
```

### Admin creating a poll

```
Admin App (REST)               Server               All Students
    |                             |                       |
    |-- POST /admin/live-polls -->|                       |
    |                             |-- close existing poll  |
    |                             |-- emit poll_closed --->|
    |                             |-- create new poll      |
    |                             |-- emit poll_created -->|
    |<-- 201 { poll } ------------|                       |
    |                             |         <-- poll card shown
```

### Student voting on a poll

```
Student App                    Server               All Students
    |                             |                       |
    |-- submit_vote ------------->|                       |
    |  { pollId, optionIndex }    |-- check poll active    |
    |                             |-- create Vote doc      |
    |                             |-- $inc votes + total   |
    |                             |-- emit poll_update --->|
    |<-- poll_update (broadcast) -+----------------------->|
    |  (vote bars update live)                   (all see live counts)
    |                             |
    | (duplicate attempt)         |
    |-- submit_vote ------------->|
    |<-- error "already voted" ---|
```
