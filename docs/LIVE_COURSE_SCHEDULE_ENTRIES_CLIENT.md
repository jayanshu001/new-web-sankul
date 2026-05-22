# Live Course — Schedule Entries (Client)

The client "Schedule" tab on the Live Course detail page renders an admin-curated timetable of `{ date, subject, time }` rows — the right screen in the mockup (Date / Subject / Time columns).

> **Status: shipped.** The existing endpoint `GET /api/v1/client/live-courses/:id/schedule` now returns a new `scheduleEntries[]` field alongside the existing `timetable` and `files`. Existing fields are unchanged — old clients keep working.

Companion admin doc: [LIVE_COURSE_SCHEDULE_ENTRIES_ADMIN.md](LIVE_COURSE_SCHEDULE_ENTRIES_ADMIN.md).

---

## 1. Endpoint

```
GET /api/v1/client/live-courses/:id/schedule
```

**Auth:** `Authorization: Bearer <customer token>` (route group gated by `authenticate + requireRole("customer")`).

Optional query params:

| Param      | Type    | Effect                                                                                            |
| ---------- | ------- | ------------------------------------------------------------------------------------------------- |
| `upcoming` | boolean | `true` filters the auto-derived `timetable[]` to sessions in the future. **Does not** affect `scheduleEntries` — admin-entered rows are always returned in full. |

---

## 2. Response shape

```jsonc
{
  "success": true,
  "message": "Schedule fetched.",
  "data": {
    "liveCourse": { "_id": "6a04…", "name": "Constable Hybrid Offline + Live" },

    // ──────────────────────────────────────────────────────────────
    // NEW — admin-managed schedule rows (renders the Schedule tab)
    // ──────────────────────────────────────────────────────────────
    "scheduleEntries": [
      { "date": "2026-05-17T00:00:00.000Z", "subject": "Mathematics",     "time": "09:00-10:00 AM", "order": 0 },
      { "date": "2026-05-17T00:00:00.000Z", "subject": "General Science", "time": "09:00-10:00 AM", "order": 1 },
      { "date": "2026-05-18T00:00:00.000Z", "subject": "English",         "time": "09:00-10:00 AM", "order": 2 },
      { "date": "2026-05-18T00:00:00.000Z", "subject": "Current Affairs", "time": "09:00-10:00 AM", "order": 3 },
      { "date": "2026-05-20T00:00:00.000Z", "subject": "Geography",       "time": "09:00-10:00 AM", "order": 4 }
    ],

    // EXISTING — auto-derived from LiveSession docs (subject / educator / date / time slot)
    "timetable": [ /* …unchanged… */ ],

    // EXISTING — downloadable Time Table files (PDFs etc.)
    "files":    [ /* …unchanged… */ ],

    "total": 5   // count of items in `timetable` (unchanged semantics)
  }
}
```

### Field contract — `scheduleEntries[i]`

| Field     | Type     | Notes                                                                                                                  |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `date`    | ISO 8601 | UTC midnight of the calendar day. Render day-of-week + day-of-month (e.g. `"Mon 17"`).                                  |
| `subject` | string   | Show in the "Subject" column exactly as entered.                                                                       |
| `time`    | string   | **Free-text slot label** exactly as the admin typed (e.g. `"09:00-10:00 AM"`). Render as-is — do **not** parse to Date. |
| `order`   | number   | Server returns rows sorted by `(order asc, date asc)`. Client should preserve this order — no client-side sort needed.  |

### Empty state

If the admin hasn't entered any rows yet, `scheduleEntries` is `[]`. Render the empty state for the Schedule tab — don't fall back to `timetable[]`, those serve a different UI (the auto-generated session list).

---

## 3. Rendering — Schedule tab

The mockup shows:

```
Date    | Subject          | Time
────────┼──────────────────┼─────────────
Mon 17  | Mathematics      | 09:00-10:00 AM
Mon 17  | General Science  | 09:00-10:00 AM
Tue 18  | English          | 09:00-10:00 AM
Tue 18  | Current Affairs  | 09:00-10:00 AM
Thu 20  | Geography        | 09:00-10:00 AM
```

- One row per `scheduleEntries[i]`.
- Group visually by `date` (the day badge can span multiple rows on the same date) — purely presentation; the API still returns one entry per row.
- The faculty names ("Dr. R. Kumar", "Prof. P. Sharma") shown under each subject in the mockup are **not** part of `scheduleEntries` in this iteration. If you need them, request a v2 admin doc that adds an `educator` field to the row.

### Sample render (TypeScript / pseudo-React)

```tsx
type ScheduleEntry = { date: string; subject: string; time: string; order: number };

const formatDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getUTCDate()}`;
  // → "Mon 17"
};

function ScheduleTab({ entries }: { entries: ScheduleEntry[] }) {
  if (!entries.length) return <EmptyScheduleState />;

  return (
    <Table>
      <Thead><Tr><Th>Date</Th><Th>Subject</Th><Th>Time</Th></Tr></Thead>
      <Tbody>
        {entries.map((e, i) => (
          <Tr key={i}>
            <Td>{formatDay(e.date)}</Td>
            <Td>{e.subject}</Td>
            <Td>{e.time}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
```

---

## 4. Smoke test

```sh
curl http://localhost:4001/api/v1/client/live-courses/<liveCourseId>/schedule \
  -H "Authorization: Bearer <customer-token>" | jq '.data.scheduleEntries'
```

Expect an array (possibly empty). If empty, ask the admin to save rows via the Schedule tab — see [LIVE_COURSE_SCHEDULE_ENTRIES_ADMIN.md](LIVE_COURSE_SCHEDULE_ENTRIES_ADMIN.md).
