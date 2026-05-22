# Live Course — Schedule Entries (Admin)

Admin-managed **Schedule** for a Live Course: a list of `{ date, subject, time }` rows that powers the "Schedule" tab in the client app (right screen of the mockup — Date / Subject / Time columns).

> **Status: shipped on backend.** Endpoint, model, service, controller, and route are live. The client `GET …/schedule` response already includes `scheduleEntries[]`. Admin UI just needs to wire up the form.

Separate from `timetableFiles` (downloadable PDFs) and from the auto-derived `LiveSession` timetable — both continue to work; `scheduleEntries` is an additional admin-curated table.

---

## 1. Endpoint

```
PATCH /api/v1/admin/live-courses/:id/schedule-entries
```

**Auth:** `Authorization: Bearer <admin token>` (route group gated by `authenticate + requireRole("admin","super_admin")`).

**Behavior:** **Full replace.** Send the entire list of rows on every save — to add/remove/reorder, POST the whole array again. The server persists rows sorted by `(order asc, date asc)`, so the client doesn't have to re-sort.

### Request

```http
PATCH /api/v1/admin/live-courses/6a048535876e7a6704640da9/schedule-entries
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "entries": [
    { "date": "2026-05-17", "subject": "Mathematics",     "time": "09:00-10:00 AM", "order": 0 },
    { "date": "2026-05-17", "subject": "General Science", "time": "09:00-10:00 AM", "order": 1 },
    { "date": "2026-05-18", "subject": "English",         "time": "09:00-10:00 AM", "order": 2 },
    { "date": "2026-05-18", "subject": "Current Affairs", "time": "09:00-10:00 AM", "order": 3 },
    { "date": "2026-05-20", "subject": "Geography",       "time": "09:00-10:00 AM", "order": 4 }
  ]
}
```

### Field contract

| Field     | Type    | Required | Constraints / notes                                                                  |
| --------- | ------- | -------- | ------------------------------------------------------------------------------------ |
| `date`    | string  | ✅       | `"YYYY-MM-DD"` (HTML `<input type="date">`) or full ISO. Server coerces to a `Date`. |
| `subject` | string  | ✅       | Trimmed, 1–200 chars. e.g. `"Mathematics"`, `"Indian Geography"`.                    |
| `time`    | string  | ✅       | Trimmed, 1–100 chars. **Free-text label** as shown to users, e.g. `"09:00-10:00 AM"`, `"11:00-12:00 PM"`. Do not split into start/end — single input field. |
| `order`   | number  | ❌       | Integer, default 0. Drives ordering in API + UI. If omitted, server falls back to the array index. |

### Success response — `200`

```jsonc
{
  "success": true,
  "message": "Schedule entries updated.",
  "data": {
    "scheduleEntries": [
      { "date": "2026-05-17T00:00:00.000Z", "subject": "Mathematics",     "time": "09:00-10:00 AM", "order": 0 },
      { "date": "2026-05-17T00:00:00.000Z", "subject": "General Science", "time": "09:00-10:00 AM", "order": 1 },
      { "date": "2026-05-18T00:00:00.000Z", "subject": "English",         "time": "09:00-10:00 AM", "order": 2 },
      { "date": "2026-05-18T00:00:00.000Z", "subject": "Current Affairs", "time": "09:00-10:00 AM", "order": 3 },
      { "date": "2026-05-20T00:00:00.000Z", "subject": "Geography",       "time": "09:00-10:00 AM", "order": 4 }
    ]
  }
}
```

> Note: `date` comes back as a full ISO timestamp (UTC midnight of the day). The UI should format it for both the date picker (`YYYY-MM-DD`) and any display.

### Error responses

| Code | When                                                          | Body                                                                              |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 401  | Missing/invalid bearer token                                  | Standard auth error                                                               |
| 403  | Logged-in user is not `admin`/`super_admin`                   | Standard role error                                                               |
| 404  | `:id` is a valid ObjectId but the Live Course doesn't exist   | `{ "success": false, "code": 404, "message": "Live course not found." }`         |
| 422  | `:id` is not a valid ObjectId, OR body validation failed      | `{ "success": false, "code": 422, "message": "Validation failed.", "data": { "errors": ["entries.0.subject: subject is required", …] } }` |

Validation errors return the existing admin-UI shape: `data.errors: string[]`, one entry per failed field. Each entry is prefixed with the dotted path (e.g. `entries.2.time: time is required`).

---

## 2. Fetching existing entries

There is **no dedicated GET**. Two options, both already work:

- `GET /api/v1/admin/live-courses/:id` returns the full Live Course document, including `scheduleEntries` (already sorted).
- `GET /api/v1/client/live-courses/:id/schedule` (no auth needed beyond customer bearer) returns `scheduleEntries` alongside `timetable` + `files`.

For the admin form, **use the admin GET** so you don't have to ship a customer token from the dashboard.

---

## 3. Admin UI integration — what to build

Looking at your current "Schedule Entries" panel (the screenshot — "Demo Live Course (seed) → Schedule"), the API supports exactly what's already on screen. Wire it up like this:

### 3a. Loading the form

1. On the Schedule tab mount, call `GET /api/v1/admin/live-courses/:id`.
2. Read `data.scheduleEntries` (may be `[]` if the admin hasn't saved any yet).
3. Map server rows → form rows:
   ```ts
   const formRows = (data.scheduleEntries ?? []).map((e, i) => ({
     date: e.date ? e.date.slice(0, 10) : "",  // ISO → "YYYY-MM-DD" for <input type="date">
     subject: e.subject,
     time: e.time,
     order: e.order ?? i,
   }));
   ```
4. If `formRows.length === 0`, render one blank row so the user sees the empty form, not a blank panel.

### 3b. The form (matches your current UI)

- **Add Row** → push `{ date: "", subject: "", time: "", order: rows.length }`.
- **Up / Down arrows** → swap with the neighbor, then re-assign `order = index` to all rows so the value matches the position.
- **Trash icon** → splice the row, then re-assign `order = index`.
- **Inputs:**
  - Date → `<input type="date">` (value `YYYY-MM-DD`).
  - Subject → plain `<input type="text">`, maxLength 200.
  - Time → plain `<input type="text">`, maxLength 100. Show a placeholder like `09:00-10:00 AM` so admins know it's free text (no time picker).

### 3c. Saving — **Save Schedule** button

1. Client-side guard (optional but nicer UX): drop any row where all three of date/subject/time are blank (treat as deleted). Reject submit if a row is partially filled — point the admin at the first bad row.
2. Build the payload exactly as the contract:
   ```ts
   const payload = {
     entries: rows.map((r, i) => ({
       date: r.date,           // "YYYY-MM-DD" — server coerces
       subject: r.subject.trim(),
       time: r.time.trim(),
       order: i,               // ignore stored order; trust array position
     })),
   };
   ```
3. `PATCH /api/v1/admin/live-courses/:id/schedule-entries` with that body.
4. On `200` → toast `"Schedule saved"`, replace local state with `response.data.scheduleEntries` (so the UI reflects server-side sorting).
5. On `422` → read `response.data.errors[]`, surface inline per row by parsing the `entries.<index>.<field>` prefix.
6. On `404` → toast `"Live course not found"` (the course was deleted while the tab was open).

### 3d. Empty save = clear the schedule

Sending `{ "entries": [] }` is valid and **replaces** the saved list with nothing. Use this for a "Clear schedule" action if you add one — no separate DELETE endpoint exists.

---

## 4. Where it lives in the backend (for reference)

- Model: [src/models/course/LiveCourse.model.ts](src/models/course/LiveCourse.model.ts) — `scheduleEntries: ILiveCourseScheduleEntry[]`.
- Service: [src/admin/live-course/live-course.service.ts](src/admin/live-course/live-course.service.ts) — `updateScheduleEntries()`.
- Controller: [src/admin/live-course/live-course.controller.ts](src/admin/live-course/live-course.controller.ts) — zod schema `scheduleEntriesSchema` + handler.
- Route: [src/admin/live-course/live-course.routes.ts:72](src/admin/live-course/live-course.routes.ts#L72) — `router.patch("/:id/schedule-entries", updateScheduleEntries)`.

---

## 5. Smoke test

```sh
# Save two rows
curl -X PATCH http://localhost:4001/api/v1/admin/live-courses/<liveCourseId>/schedule-entries \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      { "date": "2026-05-23", "subject": "Maths",   "time": "09:00-10:00 AM", "order": 0 },
      { "date": "2026-05-26", "subject": "English", "time": "11:00-12:00 PM", "order": 1 }
    ]
  }'

# Verify it persisted
curl http://localhost:4001/api/v1/admin/live-courses/<liveCourseId> \
  -H "Authorization: Bearer <admin-token>" | jq '.data.scheduleEntries'
```
