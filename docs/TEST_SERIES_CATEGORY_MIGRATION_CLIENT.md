# Test Series — Category Migration (Client / Frontend)

> **What changed:** A test series can now belong to **multiple** exam categories.
> The single `examCategoryId` (one ObjectId) is replaced by `examCategoryIds`
> (an **array** of ObjectId strings). The papers endpoint also gained per-paper
> paid/lock flags.
>
> This doc is the focused changelog for the **client app**. For the full endpoint
> reference see `TEST_SERIES_CLIENT.md`.

Auth: Bearer customer token on every route. Response envelope is the standard
`{ success, code, data, message, messages }`.

---

## TL;DR for the frontend

| Field | Where | Type | Notes |
|-------|-------|------|-------|
| `examCategoryIds` | list item, detail `series` | `{ _id, name }[]` | Array of **populated** ExamCategory objects. May be `[]`. **Use this.** |
| `examCategoryId` | — | — | **Removed from client responses.** The DB still keeps it during the migration window, but the client list/detail endpoints no longer return it. Do not depend on it. |
| `isPaid` | papers (top level) | `boolean` | `= !series.isFree`. Series-level paywall. |
| `paper.isPaid` | papers → category → papers[] | `boolean` | The paper's own paid flag. |
| `paper.isLocked` | papers → category → papers[] | `boolean` | `paper.isPaid && !hasAccess`. Gate the Start button. |

**One rule for categories:** read `examCategoryIds` (array of `{ _id, name }`).
The client endpoints no longer return the legacy `examCategoryId`. The parser
below still tolerates a bare-string fallback defensively, but you should not rely
on `examCategoryId` being present.

---

## 1. Reading categories (list + detail)

`GET /api/v1/client/test-series` (list) and `GET /api/v1/client/test-series/:id`
(detail) both now expose `examCategoryIds` on the series object.

**List item (excerpt)**
```jsonc
{
  "_id": "...",
  "title": "Online Mock test 2025",
  "examCategoryIds": [                          // <-- array of populated { _id, name }
    { "_id": "66aa...", "name": "GPSC" },
    { "_id": "66bb...", "name": "UPSC" }
  ],
  "isFree": false,
  "isPaid": true,
  // ...defaultPlan, isPurchased, daysLeft, shareableLink
}
```

**Detail (excerpt)**
```jsonc
{
  "data": {
    "series": {
      "_id": "...",
      "title": "Online Mock test 2025",
      "examCategoryIds": [                          // <-- array of populated { _id, name }
        { "_id": "66aa...", "name": "GPSC" },
        { "_id": "66bb...", "name": "UPSC" }
      ],
      "isPaid": true
      // ...rest of the TestSeries doc
    },
    "contentCategories": [ /* ... */ ],
    "prices": [ /* ... */ ],
    "isPurchased": true
  }
}
```

> `examCategoryIds` is **populated** server-side to `{ _id, name }` objects, so you
> can render category names directly — no client-side id→name lookup needed. The
> parser below still tolerates raw id strings (e.g. the legacy `examCategoryId`
> fallback), so it's safe either way.

### Backward-compatible parser (drop-in)

```ts
type ExamCategory = { _id: string; name?: string };

// Normalizes the category field across the new populated array, raw id strings,
// and the deprecated single field. Returns { _id, name } objects so you can both
// render names and filter by id.
function getExamCategories(series: any): ExamCategory[] {
  const toCat = (v: any): ExamCategory | null => {
    if (v == null) return null;
    if (typeof v === "string") return { _id: v };           // raw id (legacy / fallback)
    const _id = v._id ?? v.id;
    return _id ? { _id, name: v.name } : null;              // populated object
  };

  const arr = series?.examCategoryIds;
  if (Array.isArray(arr) && arr.length) {
    return arr.map(toCat).filter(Boolean) as ExamCategory[];
  }
  // Fallback to the deprecated single field (migration window only).
  const single = toCat(series?.examCategoryId);
  return single ? [single] : [];
}

// Convenience when you only need ids (e.g. for filtering).
const getExamCategoryIds = (series: any): string[] =>
  getExamCategories(series).map((c) => c._id);
```

Use `getExamCategories(series)` to render category chips (names come straight from
the populated objects) and `getExamCategoryIds(series)` wherever you previously read
`series.examCategoryId`. Once the backend drops the legacy field, both keep working
unchanged.

---

## 2. Papers tab — paid / lock flags

`GET /api/v1/client/test-series/:id/papers`

```jsonc
{
  "data": {
    "isPaid": true,          // series-level: !series.isFree
    "hasAccess": true,       // customer can open papers (free series or active sub)
    "categories": [
      {
        "_id": "...",
        "name": "GPSC Mains Lecture PDF",
        "papers": [
          {
            "linkId": "...",
            "exam": { "_id": "...", "title": "...", "isPaid": true, "durationMinutes": 10 },
            "isPaid": true,      // <-- per-paper paid flag (from Exam)
            "isLocked": false,   // <-- isPaid && !hasAccess
            "attemptState": "retake",
            "lastResult": { "score": 7, "total": 10 }
          }
        ]
      }
    ]
  }
}
```

**Rendering rules**

- `data.isPaid === true` → show the "paid series" treatment / paywall affordance.
- `paper.isLocked === true` → show a lock icon / "Buy to unlock", and **disable**
  the Start/Retake button (ignore `attemptState` in this case).
- `paper.isLocked === false` → enable the button; label it from `attemptState`
  (`"start"` → "Start", `"retake"` → "Retake").
- Start/Retake still delivers questions via the existing quizzes endpoints:
  `POST /api/v1/client/quizzes/:examId/attempts/start` with `exam._id`.

---

## Migration checklist (frontend)

- [ ] Replace every read of `series.examCategoryId` with `getExamCategoryIds(series)`.
- [ ] Update any category chips/filter UI to render **multiple** categories.
- [ ] On the Papers tab, honor `paper.isLocked` to gate the Start button.
- [ ] Optionally surface the top-level `isPaid` on the Papers/Detail screens.
- [ ] No client write payloads change — creating/editing test series is admin-only
      (see `TEST_SERIES_ADMIN.md` for the `examCategoryIds` write contract).

---

## Notes

- The legacy `examCategoryId` is kept **temporarily** so existing app builds keep
  working. It will be removed in a later release — migrate reads now.
- `examCategoryIds` can be an empty array for series with no category assigned;
  render that as "uncategorized" rather than erroring.
