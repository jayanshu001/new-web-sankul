# Daily Quizzes — Client API

Drill-down endpoint for the **Daily Tests** UI (Year → Month → Week → Tests).

A single endpoint handles all four screens. Pass progressively more filters as the user drills in.

- **URL:** `GET /api/v1/client/quizzes/daily`
- **Auth:** required — `Authorization: Bearer <token>`
- **Query params (all optional, but hierarchical):**
  - `year` — integer (e.g. `2025`)
  - `month` — integer 1–12 (requires `year`)
  - `week` — integer 1–5 (requires `year` and `month`)

The server picks the response level based on which params are present.

Week boundaries within a month:
- Week 1: days 1–7
- Week 2: days 8–14
- Week 3: days 15–21
- Week 4: days 22–28
- Week 5: days 29–end of month

Only daily quizzes with `status = PUBLISHED` and `startAt <= end of today` are counted/returned. Future-scheduled dailies are hidden until their day arrives.

The response envelope is always `{ success: true, data: { level, ...filters, items } }`. The `level` field tells you which screen to render.

---

## Level 1 — Years list (Screen 1)

**Request**
```
GET /api/v1/client/quizzes/daily
```

**Response**
```json
{
  "success": true,
  "data": {
    "level": "years",
    "items": [
      { "year": 2025, "testsCount": 336 },
      { "year": 2024, "testsCount": 336 },
      { "year": 2023, "testsCount": 336 }
    ]
  }
}
```

Sorted newest year first.

---

## Level 2 — Months in a year (Screen 2)

**Request**
```
GET /api/v1/client/quizzes/daily?year=2025
```

**Response**
```json
{
  "success": true,
  "data": {
    "level": "months",
    "year": 2025,
    "items": [
      { "year": 2025, "month": 1, "label": "January",  "testsCount": 28 },
      { "year": 2025, "month": 2, "label": "February", "testsCount": 28 },
      { "year": 2025, "month": 3, "label": "March",    "testsCount": 26 },
      { "year": 2025, "month": 4, "label": "April",    "testsCount": 26 },
      { "year": 2025, "month": 5, "label": "May",      "testsCount": 27 }
    ]
  }
}
```

Months with zero published dailies are omitted. Sorted ascending (Jan → Dec).

---

## Level 3 — Weeks in a month (Screen 3)

**Request**
```
GET /api/v1/client/quizzes/daily?year=2023&month=1
```

**Response**
```json
{
  "success": true,
  "data": {
    "level": "weeks",
    "year": 2023,
    "month": 1,
    "items": [
      {
        "week": 1,
        "label": "Week 1",
        "startDate": "2023-01-01T00:00:00.000Z",
        "endDate":   "2023-01-07T23:59:59.999Z",
        "testsCount": 7
      },
      {
        "week": 2,
        "label": "Week 2",
        "startDate": "2023-01-08T00:00:00.000Z",
        "endDate":   "2023-01-14T23:59:59.999Z",
        "testsCount": 7
      },
      {
        "week": 5,
        "label": "Week 5",
        "startDate": "2023-01-29T00:00:00.000Z",
        "endDate":   "2023-01-31T23:59:59.999Z",
        "testsCount": 3
      }
    ]
  }
}
```

Weeks with zero published dailies are omitted. Use `startDate`/`endDate` for the "Jan 1 – Jan 7, 2023" subtitle.

---

## Level 4 — Tests in a week (Screen 4)

**Request**
```
GET /api/v1/client/quizzes/daily?year=2026&month=3&week=3
```

**Response**
```json
{
  "success": true,
  "data": {
    "level": "tests",
    "year": 2026,
    "month": 3,
    "week": 3,
    "items": [
      {
        "_id": "65f0...",
        "title": "Mix Test - 414",
        "durationMinutes": 30,
        "questionCount": 25,
        "positiveMarks": 1,
        "negativeMarks": 0.25,
        "startAt": "2026-03-16T03:30:00.000Z",
        "orderBy": 0,
        "language": "en",
        "attemptsCount": 0,
        "bestScore": 0,
        "isAttempted": false,
        "lastResult": null
      },
      {
        "_id": "65f1...",
        "title": "Mix Test - 414",
        "durationMinutes": 30,
        "questionCount": 25,
        "positiveMarks": 1,
        "negativeMarks": 0.25,
        "startAt": "2026-03-16T05:30:00.000Z",
        "orderBy": 0,
        "language": "en",
        "attemptsCount": 2,
        "bestScore": 18,
        "isAttempted": true,
        "lastResult": {
          "_id": "660a...",
          "attemptNumber": 2,
          "score": 18,
          "timing": 1420,
          "submittedAt": "2026-03-16T06:05:00.000Z"
        }
      }
    ]
  }
}
```

**UI mapping for this screen:**
- `isAttempted === false` → show **Start** button
- `isAttempted === true`  → show **Retake** button (and surface `bestScore` / `lastResult` if needed)

Sorted by `startAt` ascending.

---

## Errors

| Status | When |
|--------|------|
| 400 | `month` sent without `year`, or `week` sent without `year`+`month` |
| 400 | `year` outside 1970–9999, `month` outside 1–12, `week` outside 1–5 |
| 401 | Missing/invalid Bearer token |
| 500 | Server error (`message` field has details) |

All error responses are `{ "success": false, "message": "..." }`.

---

## Notes for the frontend

- Cache aggressively per filter combo — the year/month/week counts are stable until new dailies are published.
- `lastResult` is included on Level 4 so the "Retake" screen can deep-link straight into the previous attempt's solution if you want.
- The previous flat-list shape (just an array of exams under `data`) is **gone** — `data` is now always an object with `level` + `items`. Update any existing callers.
