# Admin — Live Session form: subject-based recording grouping

## What changed

The "New live session" / "Edit scheduled session" forms previously had a
**Recording target folder ID** text input that asked admins to paste a folder
ObjectId. That field is **gone**. Recordings are now grouped into folders by
the session's **Subject**.

Implication for the form:

| Before | After |
|---|---|
| Subject was optional (timetable label only). | **Subject is required.** It doubles as the recording-folder grouping key. |
| "Recording target folder ID" — text input for an ObjectId. | **Removed.** No folder picker exists. |
| Recordings only landed in a folder if the admin remembered to paste the right id. | Recordings ALWAYS land in a folder. A folder is auto-created per `(liveCourse, subject)` the first time a recording arrives. |

## Server contract (what the API now expects)

### `POST /api/v1/admin/live-sessions`

Request body:
```jsonc
{
  "title": "Day 03 — વર્ગ & ઘન",                  // required
  "subject": "Maths",                               // REQUIRED (was optional)
  "liveCourseIds": ["6a058c63ea69f98d3d42f382"],    // required, ≥1
  "scheduledAt": "2026-05-20T09:00:00.000Z",        // optional — future = SCHEDULED, past/null = go live now
  "endAt": "2026-05-20T10:00:00.000Z",              // optional
  "educatorId": "6a05a8d8c818602bfbbe0ef5"          // optional
}
```

**Do NOT send** `recordingTargetFolderId` — the field is removed. Anything you
send under that key is ignored.

Validation errors the FE must surface:
- `422 "subject is required — recordings are auto-grouped into a folder named after it."`
- `422 "subject is too long (max 300)."`
- `422 "title is required."`
- `400 "liveCourseIds is required (provide at least one live course)."`

### `PATCH /api/v1/admin/live-sessions/:id`

Same shape, all fields optional **except** that if `subject` is sent it must
be non-empty:
- `422 "subject cannot be empty."`
- `422 "subject is too long (max 300)."`

Only `SCHEDULED` sessions are editable (409 otherwise — unchanged).

### Response shape (unchanged except for the dropped field)

The session DTO no longer includes `recordingTargetFolderId`. If your FE was
reading it, remove that read — it will be absent.

## UI changes to make

### 1. The form (your screenshot)

- **Remove the "Recording target folder ID" input entirely.**
- **Make the "Subject" field required.** Add `*` to the label, client-side
  validate non-empty + ≤300 chars before submit.
- Add a short helper line under the Subject input:

  > Recordings will be grouped into a folder named **"<subject>"** under each
  > linked live course. New folder is created automatically if it doesn't
  > exist.

- **Optional polish (recommended):** make Subject an **autocomplete /
  combobox** that suggests existing folder titles under the selected live
  course(s). This nudges admins towards reusing the existing "Maths" folder
  instead of accidentally typing "Mathematics" and creating a sibling.
  - Source: the existing folders-list endpoint for the selected live course
    (the one that powers the folder management screen).
  - Match by case-insensitive prefix on `title`.
  - Free typing must still be allowed — the admin may genuinely want a new
    subject. The server will auto-create the folder on first recording.
  - Show a small badge on each suggestion: **"existing folder"** vs.
    **"will create new folder"** as the admin types.

### 2. Behaviour of casing / whitespace

The backend normalizes subject → folder key by `trim().toLowerCase().replace(/\s+/g, " ")`.
That means:

- "Maths", "maths", " Maths ", "MATHS" → **same folder**.
- "Maths" and "Mathematics" → **different folders** (no fuzzy match).

The folder's **display title** is whatever the **first** admin typed
(preserves casing). Subsequent sessions with a different-casing subject still
hit the same folder but don't change the display title. If you want to surface
that to the admin in the autocomplete, sort matches by recency and show the
canonical title.

### 3. Folders list / folder management screen

Auto-created folders have:
- `image: null` — render a placeholder thumbnail (the existing folder-image
  upload UI should now treat the image as optional / editable post-creation).
- `order_by` set to the end of the course's folder list — admin can re-order
  via the existing folder-reorder UI.
- `subjectKey` populated — internal field, no UI needed.

The "edit folder" form should keep working as-is and lets the admin attach an
image when they get around to it.

### 4. Recording delivery flow (no FE changes here, just heads-up)

When Streamos finishes transcoding:

```
webhook → LiveSession.recordings populated
        → for each liveCourseId:
            • find folder where subjectKey == normalize(session.subject)
            • if missing → create folder (title = session.subject as typed)
            • file best-quality recording (1080p > 720p > … > 144p) as Video in folder
        → status flips to READY
        → socket: "recordings_ready"
```

The customer-facing folder listing (`GET /api/v1/client/live-courses/:id/recordings`)
already groups by folder — no FE change. The folder section header is the
folder's `title`, i.e. the subject. The "Previous Live Session" / subject-style
groups in the recordings UI will populate themselves.

## Migration (one-time, ops)

For existing data, ops will run
`scripts/backfill-video-category-subject-key.ts --apply`. It:

1. Sets `subjectKey = normalize(title)` on every existing live-course folder.
2. Reports any pre-existing duplicate `(liveCourseId, subjectKey)` folders —
   ops will merge those before applying (the new unique index would reject
   duplicates).
3. `$unset`s the dropped `recordingTargetFolderId` field from every
   `LiveSession` that still carries it.

No FE coordination needed beyond shipping the form changes above; the new
form refuses to send `recordingTargetFolderId`, and the server ignores it.

## Lecture payload now exposes multi-quality recordings

`GET /api/v1/client/live-courses/:id/recordings` lecture rows now include a
`recordings[]` array carrying every quality Streamos delivered for the source
live session. Example:

```jsonc
{
  "_id": "…",
  "title": "Day Nine1",                  // ← no "(720p)" suffix anymore
  "platform": "aws",
  "priceType": "paid",
  "locked": false,
  "aws_id": "<best-quality-path>",       // still present, sanitized
  "recordings": [                         // ← NEW — pulled from LiveSession
    { "quality": "720p", "file_size": 1293679, "path": "..." },
    { "quality": "480p", "file_size": 1293679, "path": "..." },
    { "quality": "360p", "file_size": 1293679, "path": "..." },
    { "quality": "240p", "file_size": 1293679, "path": "..." },
    { "quality": "144p", "file_size": 1293679, "path": "..." }
  ],
  "progress": null
}
```

- For lectures derived from a live recording, `recordings[]` carries 1–5 tiers.
- For manually-uploaded lectures (no source LiveSession), `recordings: []` and the FE falls back to `aws_id`.
- URLs are now sanitized server-side; the stray `%22` / trailing quote artifact is fixed at ingest and on read.

## QA checklist

- [ ] Subject input shows as required (`*`), and FE validates non-empty.
- [ ] Removed: the old "Recording target folder ID" input is no longer
      rendered in either Create or Edit forms.
- [ ] Submitting without subject shows the server's 422 message inline.
- [ ] Submitting with `subject: "Maths"` succeeds; backend response contains
      no `recordingTargetFolderId` key.
- [ ] After the first recording lands for a brand-new subject, a folder with
      `title: "Maths"` appears under the linked live course, with a
      placeholder image, ordered at the end of the folder list.
- [ ] Scheduling a second session with `subject: "maths "` (different casing
      / trailing space) results in the recording landing in the **same**
      "Maths" folder — not a new one.
- [ ] Editing a `SCHEDULED` session and clearing the Subject field returns
      `422 "subject cannot be empty."` and the form surfaces it inline.
- [ ] Recorded-course folders (not under any live course) are unchanged in
      the folder management UI — image is still settable / displayed.
