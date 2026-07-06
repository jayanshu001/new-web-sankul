# Free Tests — Client API (Frontend Integration Doc)

The **`GET /api/v1/client/free-tests`** endpoint now works as a **year → month →
week → tests** drill-down, exactly like the Daily Quizzes screen
(`client/quizzes/daily`). This doc is for the **client app / frontend** team.

> **What changed:** Previously this endpoint returned a single flat paginated
> list of free tests. It now returns **drill-down levels** depending on which
> query params you send. The final level (tests) is still a paginated list with
> the same item shape as before — so the only migration is: send
> `?year&month&week` to get the actual test list.

---

## TL;DR

| | |
|---|---|
| **Endpoint** | `GET /api/v1/client/free-tests` |
| **Auth** | **Required** — `Authorization: Bearer <accessToken>` |
| **Drill-down** | Driven by optional `year`, `month`, `week` query params |
| **Bucketed on** | The test's **`createdAt`** date |
| **Counts honour** | The optional `search` filter (so counts match the eventual list) |

---

## 1. The four levels

Send params **progressively**. Each added param drills one level deeper:

| Query params | `level` returned | Items contain |
|--------------|------------------|---------------|
| _(none)_ | `years` | `{ year, testsCount }` |
| `?year=2026` | `months` | `{ year, month, label, testsCount }` |
| `?year=2026&month=6` | `weeks` | `{ week, label, startDate, endDate, testsCount }` |
| `?year=2026&month=6&week=1` | `tests` | full test objects (+ `pagination`) |

- **year**: integer `1970`–`9999`
- **month**: integer `1`–`12` — **requires** `year`
- **week**: integer `1`–`5` — **requires** `year` **and** `month`
- Week buckets: **Week 1** = days 1–7, **Week 2** = 8–14, **Week 3** = 15–21,
  **Week 4** = 22–28, **Week 5** = 29–end of month.

Future months/weeks (after today) are not shown — buckets are capped at the
current day.

### Auth — REQUIRED

```
Authorization: Bearer <accessToken>
```

Missing/invalid/expired token → `401`. Use the same refresh+retry flow as every
other client endpoint.

### Optional filters at every level

- `search` — case-insensitive title match. Applied at **all** levels, so the
  counts shown at the year/month/week levels always match what the test list
  will contain.
- `page` / `limit` — only meaningful at the **tests** level (default
  `page=1`, `limit=20`).

---

## 2. Responses by level

### Level 1 — Years _(no params)_

`GET /api/v1/client/free-tests`

```json
{
  "success": true,
  "data": {
    "level": "years",
    "items": [
      { "year": 2026, "testsCount": 42 },
      { "year": 2025, "testsCount": 31 }
    ]
  }
}
```

### Level 2 — Months `?year=2026`

```json
{
  "success": true,
  "data": {
    "level": "months",
    "year": 2026,
    "items": [
      { "year": 2026, "month": 5, "label": "May",  "testsCount": 12 },
      { "year": 2026, "month": 6, "label": "June", "testsCount": 30 }
    ]
  }
}
```

### Level 3 — Weeks `?year=2026&month=6`

```json
{
  "success": true,
  "data": {
    "level": "weeks",
    "year": 2026,
    "month": 6,
    "items": [
      {
        "week": 1,
        "label": "Week 1",
        "startDate": "2026-06-01T00:00:00.000Z",
        "endDate": "2026-06-07T23:59:59.999Z",
        "testsCount": 8
      },
      {
        "week": 2,
        "label": "Week 2",
        "startDate": "2026-06-08T00:00:00.000Z",
        "endDate": "2026-06-14T23:59:59.999Z",
        "testsCount": 5
      }
    ]
  }
}
```

> Weeks with **zero** tests are omitted. `startDate`/`endDate` are ISO strings —
> use them as the date-range label for the week card.

### Level 4 — Tests `?year=2026&month=6&week=1`

```json
{
  "success": true,
  "data": {
    "level": "tests",
    "year": 2026,
    "month": 6,
    "week": 1,
    "items": [
      {
        "_id": "665f0c2a9b1e4a0012a3b4c5",
        "title": "Free Mock Test 1",
        "type": "subject",
        "categoryId": { "_id": "…", "title": "GS", "image": "https://…" },
        "isPaid": false,
        "durationMinutes": 60,
        "questionCount": 50,
        "positiveMarks": 1,
        "negativeMarks": 0,
        "language": "gujarati",
        "orderBy": 0,
        "createdAt": "2026-06-03T10:00:00.000Z",
        "updatedAt": "2026-06-03T10:00:00.000Z"
      }
    ]
  },
  "pagination": { "total": 8, "page": 1, "limit": 20, "totalPages": 1 }
}
```

> **Note the shape change vs. the old endpoint:** the test array is now at
> `data.items` (not `data`), and `data` also carries `level/year/month/week`.
> `pagination` stays a top-level sibling of `data`, same as before.

**Validation error (`400`)** — e.g. `month` without `year`:

```json
{ "success": false, "message": "`month` requires `year`." }
```

Other messages: `"Invalid year."`, `"Invalid month (1-12)."`,
`"Invalid week (1-5)."`, `` "`week` requires `year` and `month`." ``

**Server error (`500`)**

```json
{ "success": false, "message": "<error message>" }
```

---

## 3. Suggested UI flow

1. Open screen → call with **no params** → render a list of **year** cards
   (`year` + `testsCount`).
2. Tap a year → call `?year=Y` → render **month** cards (`label` + `testsCount`).
3. Tap a month → call `?year=Y&month=M` → render **week** cards (`label`,
   `startDate`–`endDate`, `testsCount`).
4. Tap a week → call `?year=Y&month=M&week=W` → render the **test list**
   (paginate with `page`/`limit`); open a test as you do today.

Use `data.level` to decide which renderer to show — don't infer it from which
params you sent.

---

## 4. Integration example (TypeScript / fetch)

```ts
type Level = "years" | "months" | "weeks" | "tests";

interface FreeTestsResponse {
  success: boolean;
  data: {
    level: Level;
    year?: number;
    month?: number;
    week?: number;
    items: any[]; // shape depends on level (see §2)
  };
  pagination?: { total: number; page: number; limit: number; totalPages: number };
}

export async function getFreeTests(
  accessToken: string,
  opts: { year?: number; month?: number; week?: number; search?: string; page?: number; limit?: number } = {}
): Promise<FreeTestsResponse> {
  const qs = new URLSearchParams();
  if (opts.year != null) qs.set("year", String(opts.year));
  if (opts.month != null) qs.set("month", String(opts.month));
  if (opts.week != null) qs.set("week", String(opts.week));
  if (opts.search) qs.set("search", opts.search);
  if (opts.page != null) qs.set("page", String(opts.page));
  if (opts.limit != null) qs.set("limit", String(opts.limit));

  const res = await fetch(`${API_BASE}/api/v1/client/free-tests?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED"); // trigger refresh
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "Failed to load free tests");
  return json as FreeTestsResponse;
}
```

### React Query hook

```ts
export const useFreeTests = (
  opts: { year?: number; month?: number; week?: number; search?: string; page?: number } = {}
) =>
  useQuery({
    queryKey: ["free-tests", opts],
    queryFn: () => getFreeTests(getAccessToken(), opts),
    keepPreviousData: true,
  });
```

---

## 5. Checklist for the app

- [ ] Send `Authorization: Bearer <accessToken>` (required).
- [ ] Start with **no params** → render year cards.
- [ ] Drill down with `?year`, then `?year&month`, then `?year&month&week`.
- [ ] Branch rendering on `data.level` (`years` / `months` / `weeks` / `tests`).
- [ ] At `tests` level: read the list from **`data.items`** and use top-level
      `pagination` for paging (`page`/`limit`).
- [ ] Respect dependency rules (don't send `month` without `year`, or `week`
      without `year`+`month`) — the API returns `400` otherwise.
- [ ] Optionally pass `search` — counts at every level reflect it.
- [ ] Weeks/months with zero tests won't appear — fine to just render what's
      returned.

---

## Appendix — Notes for backend/QA

- Drill-down buckets on **`createdAt`** (not `startAt`), because free tests
  aren't scheduled like daily quizzes and `startAt` is optional on the Exam
  model — bucketing on `startAt` would drop free tests that have none.
- The "free" filter is unchanged: a test is free if it's `PUBLISHED` **and**
  (reachable via a free package/course exam-category **OR** `isPaid:false` with a
  non-null `categoryId`). This same filter is applied at every level, so counts
  are consistent with the test list.
- Date math (`MONTH_LABELS`, `weekOfMonth`, `weekRange`) is shared via
  `src/utils/dateBuckets.ts` and matches `client/quizzes/daily` exactly.
