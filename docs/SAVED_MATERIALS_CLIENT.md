# Saved Materials (Lecture Notes Listing) — Client integration

Backs the **"Saved Materials"** screen — one row per **lecture** the customer
has taken notes on, with aggregated text + voice note counts and the
lecture's own title.

A "lecture" is either:
- a **recorded video** (`Video`) — for notes taken on a recorded lecture, or
- a **live session** (`LiveSession`) — for notes taken on a live class.

Both kinds come back in a **single combined list**, distinguished by `kind`.

---

## Auth

```
Authorization: Bearer <customerAccessToken>
```

Customer role required. Missing/invalid token → `401`.

---

## Endpoint

```
GET /api/v1/client/lecture-notes/saved-materials
```

No query parameters.

### Response — `200 OK`

```json
{
  "status": true,
  "message": "Saved materials fetched.",
  "data": {
    "items": [
      {
        "kind": "live",
        "videoId": null,
        "liveSessionId": "66f1c0a2e4b0a1234567890a",
        "title": "Indian geography - River systems",
        "textNotesCount": 4,
        "voiceNotesCount": 1,
        "lastNoteAt": "2026-05-16T09:41:00.000Z"
      },
      {
        "kind": "recorded",
        "videoId": "66ee1234e4b0a1234567890b",
        "liveSessionId": null,
        "title": "Modern History — Lecture 12: Revolt of 1857",
        "textNotesCount": 7,
        "voiceNotesCount": 0,
        "lastNoteAt": "2026-05-14T17:02:11.000Z"
      }
    ]
  }
}
```

| Field             | Type                       | Notes                                                                 |
|-------------------|----------------------------|-----------------------------------------------------------------------|
| `kind`            | `"recorded" \| "live"`     | Discriminator. Drives which player to open and which id to use.       |
| `videoId`         | string \| null             | Set when `kind === "recorded"`. Maps to `Video._id`.                  |
| `liveSessionId`   | string \| null             | Set when `kind === "live"`. Maps to `LiveSession._id`.                |
| `title`           | string                     | `Video.title` / `LiveSession.title`. Render as the card title.        |
| `textNotesCount`  | number                     | Count of `LectureNote` rows on this lecture.                          |
| `voiceNotesCount` | number                     | Count of `LectureAudioNote` rows on this lecture.                     |
| `lastNoteAt`      | ISO date                   | Most recent `updatedAt` across both note types. Drives default sort.  |

Items are returned **sorted by `lastNoteAt` desc** (newest activity first),
mixed across both kinds. Lectures with zero notes are omitted. A lecture
with only text notes or only voice notes is still returned, with the other
count as `0`. Rows whose underlying `Video` / `LiveSession` no longer exists
(or has an empty title) are filtered out.

### Empty state

```json
{ "status": true, "message": "Saved materials fetched.", "data": { "items": [] } }
```

Render the empty state — do not treat as an error.

---

## How the counts are computed

Notes carry the lecture id at create time (`videoId` for recorded,
`liveSessionId` for live). The aggregation groups directly by that id — one
note → one lecture → `+1`. Both `LectureNote` (text) and `LectureAudioNote`
(voice) are aggregated independently then merged into the same row per
lecture.

---

## UI mapping — "Saved Materials" screen

```
┌──────────────────────────────────────┐
│  Indian geography - River …      🗑  │  ← title (lecture title)
│  4 Text Notes  •  1 Voice Note       │  ← textNotesCount / voiceNotesCount
└──────────────────────────────────────┘
```

- **Card title** → `title`
- **Subtitle** → `"{textNotesCount} Text Notes  •  {voiceNotesCount} Voice Note{s?}"`
- **Pluralisation** is client-side. Server returns raw counts.
- **Tap the card** → open the player for that lecture:
  - `kind === "recorded"` → use `videoId`
  - `kind === "live"` → use `liveSessionId`
  Notes for that lecture are fetched via the existing per-lecture listing
  endpoints in [LECTURE_NOTES_CLIENT.md](./LECTURE_NOTES_CLIENT.md).
- **Trash icon** → there is **no bulk-delete endpoint**. Either delete notes
  one by one through the existing `DELETE /lecture-notes/:id` /
  `DELETE /lecture-audio-notes/:id` endpoints from the detail screen, or
  request a bulk endpoint before wiring this affordance.

---

## Errors

| Status | When                                |
|--------|-------------------------------------|
| `401`  | Missing/invalid bearer token        |
| `500`  | Unexpected server error             |

No path/query parameters → no `400` case.

---

## Related

- [LECTURE_NOTES_CLIENT.md](./LECTURE_NOTES_CLIENT.md) — text + audio note
  CRUD (the per-lecture endpoints behind the detail screen).
