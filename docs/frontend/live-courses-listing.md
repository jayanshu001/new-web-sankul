# Live Courses — Client Listing & Detail

Covers the new `startTime`, `purchaseCount`, `cardVariant`, and `isPurchased` fields on the live-course client APIs, and how the FE should render the two special hero cards (red "Featured Batch" and blue "Coming Soon") above the regular grid.

---

## 1. `GET /api/v1/client/live-courses`

Discovery feed. Returns every active live course, paged.

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | number | 1 | 1-indexed |
| `limit` | number | 20 | Max 50 |
| `search` | string | — | Case-insensitive partial match on `name` |

### Response

```jsonc
{
  "status": true,
  "message": "Live courses fetched.",
  "data": {
    "liveCourses": [
      {
        "_id": "65f...",
        "name": "UPSC 2026 Foundation Batch",
        "description": "...",
        "image": "https://...",
        "ordered": 1,
        "level": "Beginner",
        "classType": "live",
        "status": true,
        "isPaid": true,
        "isPopular": false,
        "startTime": "2026-01-20T09:00:00.000Z",   // NEW — ISO date or null
        "courseEducatorId":  { "_id": "...", "name": "...", "image": "..." },
        "packageCategoryId": { "_id": "...", "title": "...", "slug": "...", "image": "..." },
        "createdAt": "...",
        "updatedAt": "...",

        // NEW fields on every row:
        "daysLeft": 42,             // remaining days on user's active sub, null otherwise
        "isPurchased": true,        // user has a verified+active subscription
        "purchaseCount": 5234,      // verified subscriptions count (cached 5min)
        "cardVariant": "featured"   // "featured" | "coming_soon" | null
      }
      // ...more rows
    ],
    "total": 27,
    "page": 1,
    "limit": 20
  }
}
```

### New field reference

| Field | Type | Meaning |
|---|---|---|
| `startTime` | ISO string \| null | Date/time the batch is scheduled to begin. `null` means "no scheduled start" (treat as already running). |
| `isPurchased` | boolean | `true` when the logged-in customer has a verified + active subscription to this course. Guests always get `false`. |
| `purchaseCount` | number | Total verified subscriptions for the course. Drives the popularity ranking. Cached server-side for 5 minutes — not real-time. |
| `cardVariant` | `"featured"` \| `"coming_soon"` \| `null` | Tells the FE which hero card slot this row belongs to. At most one row in the entire list gets `"featured"`, at most one gets `"coming_soon"`. All other rows are `null`. |

---

## 2. How `cardVariant` is decided (backend logic, for your awareness)

Rules — applied across the **current page only**:

1. Only courses with `startTime > now` (i.e. batches that haven't started yet) are eligible for either hero card. Courses with `startTime <= now` or `startTime == null` always get `cardVariant: null`.
2. Among the eligible upcoming courses, rank by `purchaseCount` (descending):
   - **#1 (top-purchased)** → `cardVariant: "featured"` (red, Join Now)
   - **#2 (second-highest)** → `cardVariant: "coming_soon"` (blue)
3. Every other row gets `cardVariant: null`.
4. If fewer than 2 upcoming courses exist on the page, one or both hero cards will simply be absent from the response — FE should hide those slots gracefully.

**Implications for FE:**

- Don't compute the variant yourself. Just consume `cardVariant`.
- A page can have 0, 1, or 2 hero cards. Don't assume both always exist.
- A course tagged `"featured"` or `"coming_soon"` should **still be rendered in its normal grid position too** (unless product specifically wants it hidden from the grid — confirm).

---

## 3. Rendering the two hero cards

### `cardVariant: "featured"` → red "Featured Batch" card

Shown for the **top-purchased upcoming batch** (highest `purchaseCount` among courses with `startTime > now`).

Render:
- Background: red gradient
- Star icon + "FEATURED BATCH" pill (yellow)
- Title: `name`
- Subtitle: `"Join 5,000+ students · Starting <formatted startTime>"`
  - If `startTime` is null, drop the "Starting ..." segment.
  - For subscriber count, format `purchaseCount` (e.g. `5,234` → `"5,000+"` if you want to bucket).
- CTA button: **"Join Now"** → opens course detail (`/live-courses/:_id`)
  - If `isPurchased === true`, swap label to **"Continue"** and route the same way.

### `cardVariant: "coming_soon"` → blue "Coming Soon" card

Shown for the **second-highest purchased upcoming batch** (`startTime > now`, ranked #2 by `purchaseCount`).

Render:
- Background: indigo/blue
- Title: **"New Batch Starting Soon!"**
- Subtitle: `"<name> · <formatted startTime> onwards"`
- CTA pill: **"Coming soon"** (disabled / non-interactive)
  - If `isPurchased === true`, swap to **"Purchased"** or keep disabled but show a checkmark — confirm with design.

### Pseudocode

```ts
const featured  = liveCourses.find(c => c.cardVariant === "featured");
const upcoming  = liveCourses.find(c => c.cardVariant === "coming_soon");
const rest      = liveCourses; // or filter out hero cards if product wants

return (
  <>
    {featured && <FeaturedBatchCard course={featured} />}
    {upcoming && <ComingSoonCard course={upcoming} />}
    <Grid>
      {rest.map(c => <CourseCard key={c._id} course={c} />)}
    </Grid>
  </>
);
```

---

## 4. `GET /api/v1/client/live-courses/:id`

Detail view. The relevant additions:

```jsonc
{
  "data": {
    "liveCourse": {
      // ...all course fields, including:
      "startTime": "2026-01-20T09:00:00.000Z"   // NEW
    },
    "stats": { "subjectsCount": 8, "materialsCount": 3, "classType": "live" },
    "plans": [ /* ... */ ],
    "subscribed": true,
    "isPurchased": true,     // NEW — alias of `subscribed`, use whichever you prefer
    "daysLeft": 42
  }
}
```

`isPurchased` and `subscribed` are identical on the detail endpoint — `isPurchased` exists for naming parity with the list endpoint. Prefer `isPurchased` going forward.

---

## 5. Admin → where `startTime` comes from

Admins set `startTime` on `POST /admin/live-courses` and `PUT /admin/live-courses/:id`:

```json
{ "startTime": "2026-01-20T09:00:00.000Z" }
```

- Accepts an ISO 8601 datetime with offset.
- Pass `null` to clear it.
- Omitting the field on update leaves the existing value untouched.
- The backend does **not** currently reject past dates — admin can set a `startTime` in the past, which will move the course into the "featured" bucket. If you want past-date validation on the admin form, flag it.

---

## 6. Caching note

`purchaseCount` is aggregated and cached server-side for **5 minutes** (Redis). A brand-new purchase will not bump a course into the "featured" slot instantly — expect up to a 5-minute lag. This is a deliberate trade-off; the count powers a popularity ranking, not entitlement, so freshness is not critical. `isPurchased` is **not** cached and reflects real-time subscription state for the logged-in user.

---

## 7. Edge cases checklist

- [ ] Guest (no auth) — `isPurchased` is `false` on every row; `cardVariant` still works.
- [ ] Empty result set — no hero cards; render empty state.
- [ ] No upcoming courses (`startTime > now`) on the page — both hero cards are absent.
- [ ] Exactly one upcoming course — only `cardVariant: "featured"` is set; `coming_soon` is absent.
- [ ] `purchaseCount === 0` on every upcoming course — they're still ranked; ties are broken by the existing list order (`ordered` asc, `createdAt` desc).
- [ ] Search filtered list — hero cards are computed from the **filtered page**, so they reflect the visible subset, not the whole catalog.
- [ ] Paginated past page-1 — the hero rule still runs per page. Product may want to suppress hero cards on `page > 1` — confirm.
