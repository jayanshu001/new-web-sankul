# Admin Frontend — Exam Countdown "Goal" tagging

The exam-countdown create/edit form now accepts **two new optional fields**: `goalId`
and `goalLabelId`. They tag a countdown to a Goal + a specific label inside it (e.g.
Goal "Civil Services" → label "GPSC"), which the app uses to prioritise the dashboard
exam-countdown section by the user's selected goal.

## New fields

| field | type | required | notes |
|-------|------|----------|-------|
| `goalId` | int (as string ok) | optional | A Goal's id. |
| `goalLabelId` | int | optional | A label `id` **within that goal**. Requires `goalId`. |

Rules enforced by the API:
- `goalLabelId` without `goalId` → **400** "goalId is required when goalLabelId is provided."
- `goalId` not an existing goal → **404/400** "Goal not found for the supplied goalId."
- `goalLabelId` not a label of that goal → **400** "goalLabelId does not belong to the supplied goalId."
- Both are **optional** — omit them (or send `null`/`""` to clear on edit).

## Where the dropdown data comes from

Reuse the existing goals endpoint (no new API):

```
GET /api/v1/admin/goals        (super_admin, Bearer)
```
Response (each goal):
```json
{
  "data": [
    {
      "_id": "2",
      "title": "Civil Services",
      "labels": [ { "id": 1, "name": "UPSC" }, { "id": 2, "name": "GPSC" } ],
      "isActive": true
    }
  ],
  "meta": { "total": 5, "page": 1, "limit": 10, "totalPages": 1 }
}
```

- **Goal dropdown** → options from `data[]`: value = `goal._id`, label = `goal.title`. Send the chosen value as `goalId`.
- **Goal Label dropdown** (dependent) → options from the selected goal's `labels[]`:
  value = `label.id`, label = `label.name`. Send the chosen value as `goalLabelId`.
- When the goal changes, reset the label dropdown.

## Form behaviour

1. Add a **Goal** select and a dependent **Goal Label** select to the exam-countdown
   create/edit form (both optional).
2. Disable / clear the Label select until a Goal is chosen.
3. On submit, include `goalId` and `goalLabelId` in the body only if chosen. To clear an
   existing tag on edit, send `goalId: null` (or empty string) — the label clears with it.

## API calls (unchanged endpoints, new body fields)

**Create** — `POST /api/v1/admin/exam-countdowns`
```json
{
  "title": "GPSC Class 1-2 Prelims",
  "categoryId": "1",
  "examDate": "2026-08-15",
  "status": true,
  "goalId": 2,
  "goalLabelId": 2
}
```

**Update** — `PUT /api/v1/admin/exam-countdowns/:id`
```json
{ "goalId": 2, "goalLabelId": 1 }      // change tag
{ "goalId": null }                      // clear the tag (label clears too)
```

## Reading back (pre-fill the edit form)

`GET /api/v1/admin/exam-countdowns` (and the create/update responses) now return:
```json
{
  "_id": "6",
  "title": "GPSC Class 1-2 Prelims",
  "categoryId": { "_id": "1", "name": "GPSC", "colorHex": "#1E88E5" },
  "goalId": "2",          // string | null
  "goalLabelId": 2,        // int | null
  "examDate": "2026-08-15T00:00:00.000Z",
  "status": true
}
```
Use `goalId` to preselect the Goal dropdown and `goalLabelId` to preselect the Label
dropdown when editing.

## Validation UX tips
- If the admin picks a label but no goal, block submit client-side (the server also 400s).
- Treat all goal fields as optional — many countdowns won't be goal-tagged.

---
Backend reference: `src/admin/examCountdown/examCountdown.controller.ts`,
`src/modules/exam-countdown/exam-countdown.service.ts` (`validateGoalPair`),
DDL `docs/migration/schema-changes/2026-06-26-exam-countdown-goal.sql`.
