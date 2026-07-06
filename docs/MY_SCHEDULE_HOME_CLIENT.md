# Home Screen — My Schedule (Client)

Powers the **left-most screen** of the Schedule flow on the mobile home screen: the user's purchased Live Courses, grouped by Live Course Category. Tapping a category opens the second screen (the list of courses in that group), and tapping a course opens the third screen (the existing per-course schedule table served by `GET /api/v1/client/live-courses/:id/schedule`).

> **Status: shipped on backend.** Endpoint is live behind the standard customer bearer auth.

---

## 1. Endpoint

```
GET /api/v1/client/live-courses/my/schedule
```

**Auth:** `Authorization: Bearer <customer token>` (route group gated by `authenticate + requireRole("customer")`).

**Query params:** none.

**What "purchased" means here:** only subscriptions that are
- `paymentStatus = "verified"`, **and**
- `status = true` (not soft-cancelled), **and**
- either have no `endAt`, or `endAt >= now`.

Same rule as `GET /my?status=active`. Pending / expired subscriptions are excluded so the home Schedule list doesn't accidentally show a course the user can't open.

If the underlying `LiveCourse` was deleted or had `status` toggled off after purchase, it's silently dropped — the user won't see a dead row.

---

## 2. Response shape

```jsonc
{
  "success": true,
  "message": "Your schedule fetched.",
  "data": {
    "groups": [
      {
        "category": {
          "_id": "65f0…",
          "name": "Constable Hybrid Batch",
          "image": "https://cdn…/cat-constable.png",
          "order": 0
        },
        "liveCourses": [
          { "_id": "6a04…", "name": "Constable Hybrid Batch", "image": "https://cdn…/course-a.png", "level": "intermediate" },
          { "_id": "6a05…", "name": "PSI Batch",              "image": "https://cdn…/course-b.png", "level": "intermediate" }
        ]
      },
      {
        "category": {
          "_id": "65f1…",
          "name": "Geography",
          "image": "https://cdn…/cat-geography.png",
          "order": 1
        },
        "liveCourses": [
          { "_id": "6a06…", "name": "Constable Hybrid Batch", "image": "https://cdn…/course-c.png", "level": "intermediate" },
          { "_id": "6a07…", "name": "Geography Batch",        "image": "https://cdn…/course-d.png", "level": "intermediate" },
          { "_id": "6a08…", "name": "Geography Batch",        "image": "https://cdn…/course-e.png", "level": "intermediate" }
        ]
      }
    ],
    "totalCategories": 2,
    "totalLiveCourses": 5
  }
}
```

### Field contract

#### `groups[i].category`

| Field   | Type   | Notes                                                                                          |
| ------- | ------ | ---------------------------------------------------------------------------------------------- |
| `_id`   | string | Live Course Category id. For the synthetic catch-all group, this is the literal `"uncategorized"`. |
| `name`  | string | Section header text. `"Uncategorized"` for the synthetic group.                                |
| `image` | string | Category image URL. May be `""` for the synthetic group — render a fallback.                   |
| `order` | number | Sort order from the admin Category list. Server already sorts groups by this; just preserve.    |

#### `groups[i].liveCourses[j]`

| Field   | Type   | Notes                                                              |
| ------- | ------ | ------------------------------------------------------------------ |
| `_id`   | string | Live Course id. Use this for the next-screen drill-down route.     |
| `name`  | string | Course title shown in the row.                                     |
| `image` | string | Course image URL — the small avatar on the left of each row.       |
| `level` | string | e.g. `"intermediate"`. Not shown in the current mockup, but available if you want a small badge later. |

#### Top-level totals

| Field              | Type   | Notes                                            |
| ------------------ | ------ | ------------------------------------------------ |
| `totalCategories`  | number | `groups.length`. Convenience for headers/empty checks. |
| `totalLiveCourses` | number | Sum of `liveCourses[]` lengths across all groups. Useful for an "X courses" header label. |

### Empty state

If the user has no qualifying subscriptions, `groups: []` and both totals `= 0`. Render the Schedule empty state — don't fall through to any other list.

### Ordering guarantees

- Groups are sorted by `(category.order asc, category.name asc)`. `"Uncategorized"` (if present) is always **last**.
- Courses within a group are in subscription-recency order (newest purchase first). Duplicates are removed — if the user holds multiple active subs for the same course (e.g. plan extension), it appears once.

---

## 3. Three-screen navigation

| Screen                    | Endpoint                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. Home → Schedule         | `GET /api/v1/client/live-courses/my/schedule` ← **this doc**                                              |
| 2. Category → course list  | None needed — use `groups[i].liveCourses` from screen 1's response (no extra round-trip).                 |
| 3. Course → schedule table | `GET /api/v1/client/live-courses/:id/schedule` — see [LIVE_COURSE_SCHEDULE_ENTRIES_CLIENT.md](LIVE_COURSE_SCHEDULE_ENTRIES_CLIENT.md) and read `data.scheduleEntries[]`. |

Screen 2 is intentionally a pure client-side push from the already-loaded data. If you later want to add per-category filters/search, we can add a dedicated endpoint — not needed today.

---

## 4. Rendering — sample (TypeScript / pseudo-React)

```tsx
type Course   = { _id: string; name: string; image: string; level: string };
type Category = { _id: string; name: string; image: string; order: number };
type Group    = { category: Category; liveCourses: Course[] };

function HomeScheduleScreen() {
  const { data } = useSWR("/api/v1/client/live-courses/my/schedule", fetcher);

  if (!data?.groups?.length) return <EmptyScheduleState />;

  return (
    <ScreenContainer title="Schedule">
      {data.groups.map((g: Group) => (
        <Section key={g.category._id} title={g.category.name}>
          {g.liveCourses.map((c) => (
            <CourseRow
              key={c._id}
              image={c.image}
              title={c.name}
              onPress={() => nav.push("LiveCourseScheduleList", { categoryId: g.category._id })}
            />
          ))}
        </Section>
      ))}
    </ScreenContainer>
  );
}
```

For screen 2, push the **whole group object** into navigation params (or look it up by `categoryId` from cached screen-1 data) — no need to re-fetch.

For screen 3, call the per-course schedule endpoint with `liveCourse._id` and render `data.scheduleEntries` as documented in [LIVE_COURSE_SCHEDULE_ENTRIES_CLIENT.md](LIVE_COURSE_SCHEDULE_ENTRIES_CLIENT.md).

---

## 5. Error responses

| Code | When                                          | Body                                                                          |
| ---- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| 401  | Missing/invalid bearer, or non-customer role   | Standard auth error                                                           |
| 500  | DB / unhandled server failure                  | `{ "success": false, "code": 500, "message": "Failed to fetch your schedule." }` |

No 404 / 422 path — the endpoint takes no params, and an empty result is `groups: []`, not an error.

---

## 6. Smoke test

```sh
curl http://localhost:4001/api/v1/client/live-courses/my/schedule \
  -H "Authorization: Bearer <customer-token>" | jq '.data'
```

Expect either `{ "groups": [...], "totalCategories": N, "totalLiveCourses": M }` or, for a customer with no active live-course subs, `{ "groups": [], "totalCategories": 0, "totalLiveCourses": 0 }`.
