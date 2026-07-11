# Media Security — What We Did (Plain-Language Overview)

This is the simple story of how we secured videos, live streams, ebook PDFs, and
audio notes in the client APIs. No deep code — just what the problem was, what we
built, and why. For the exact API contract, see
[`client/CLIENT_MEDIA_ACCESS.md`](./client/CLIENT_MEDIA_ACCESS.md).

---

## The problem

The client APIs were handing out **raw media links and IDs** in plain text:

- Direct video URLs (`.m3u8`, `.mp4`)
- AWS/Spaces storage keys, YouTube IDs, Vimeo IDs, VideoCrypt IDs
- Ebook PDF links and audio-note links

Anyone who saw an API response could copy a link and watch/download the content
**without paying** — and even share it. Paid content wasn't really protected.

---

## What we did — in two steps

### Step 1 — Hide the links (encryption)

First we stopped sending raw links. We scrambled (encrypted) every URL/ID before
sending it, and the app unscrambled it to play.

This helped, but it had a real weakness: **the "key" to unscramble travelled in
the same response.** So it was more like a locked box with the key taped to the
lid — it hid the link from a casual look, but it never truly expired and it
didn't check whether the user had actually purchased the content.

### Step 2 — The proper fix (the one we're on now)

We replaced the scrambling with a **"claim ticket" system**. Now the API never
sends a media link at all. Instead it sends a small, temporary **ticket**
(we call it a `mediaToken`):

1. **List / detail screens** give you a ticket for each item — *or nothing at
   all if you haven't purchased it.*
2. When the user actually taps **Play** (or **Open PDF**), the app hands that
   ticket to **one special endpoint** (`POST /client/media/resolve`).
3. The server checks the ticket, confirms **it belongs to this user**, and
   **re-checks the subscription right then** — and only then hands back the real
   link.
4. That real link is **short-lived** (expires in minutes).

Think of it like a coat check: you get a numbered tag, not the coat. You can't do
anything useful with the tag alone, it's tied to you, and the staff only give you
the coat after checking the tag is valid.

---

## The rules the server now enforces

| Who | What they get |
|---|---|
| **Hasn't purchased** the course / package / book | **Nothing** — no link, no ID, no ticket (just "locked") |
| **Free content** (free videos, ebook samples) | A ticket (still no raw link) |
| **Has purchased** | A ticket, exchanged for a short-lived link at play time |

And these are **never** sent to the client anymore, in any form:
AWS/Spaces keys, YouTube IDs, Vimeo IDs, VideoCrypt IDs, `.m3u8`/`.mp4` URLs,
PDF links, audio links.

---

## Why this is much safer

- **Nothing leaks up front.** A stolen API response only contains a ticket that
  expires in ~5 minutes and only works for that one user.
- **Access is re-checked at the last moment.** If a subscription expired between
  browsing and pressing play, the server refuses — the old system couldn't do this.
- **Real links are short-lived.** Even a captured final link stops working quickly.
- **The ticket can't be misused as a login.** It's signed with a separate key and
  can't be swapped for an account/session token.

---

## What's covered

Everything a paying user consumes:

- **Recorded videos** — course lectures, package lectures, category videos,
  catalog videos
- **Live-course recordings**
- **Live sessions** (including the free "preview/trial" window)
- **Free videos** (open, but still ticketed)
- **Ebooks** — the free **sample** always available; the full **book PDF** only
  after purchase
- **Audio notes** — a user's own voice notes, released only to their owner

---

## How the app uses it (short version)

1. Show the list. If an item has a ticket, it's playable; if the ticket is empty
   (`null`), show the paywall.
2. On tap, send the ticket to `/client/media/resolve` and play the link it returns.
3. If the ticket has expired, refresh the list to get a new one and try again.

Full details, code samples, and error handling are in
[`client/CLIENT_MEDIA_ACCESS.md`](./client/CLIENT_MEDIA_ACCESS.md).

---

## Timeline / where the details live

| Doc | What it covers |
|---|---|
| **This file** | Plain-language overview of the whole effort |
| `client/CLIENT_MEDIA_ACCESS.md` | The current API contract + frontend integration guide |
| `client/VIDEO_URL_DECRYPTION.md` | The old scrambling scheme (Step 1) — **retired**, kept for history |
| `MIGRATION_QUERY_CHANGES.md` | The dated, technical change log for every step |
