# Profile Dashboard Counts — Client

Aggregator endpoint for the **My Profile** screen badges (e.g. "Saved Addresses · 2 addresses", "My Subscriptions · 2 active plans", "Notifications · 2 New Notifications"). Returns just the integers the UI needs so the app does not have to fan out to four separate list endpoints on profile open.

## Endpoint

`GET /api/v1/client/profile/dashboard`

- **Auth:** required (`Authorization: Bearer <customerAccessToken>`).
- **Response:** `200 OK` always (empty / new accounts return zeroed counts, not 404).

### Response shape

```json
{
  "success": true,
  "data": {
    "savedAddresses": 2,
    "downloads": 0,
    "activePlans": 2,
    "unreadNotifications": 2,
    "pastExams": 1
  }
}
```

| Field                 | Type   | Source                                                                                                                                                       |
|-----------------------|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `savedAddresses`      | number | `CustomerAddress` where `customerId === me && status === true`                                                                                              |
| `downloads`           | number | **Stub `0`** — Downloads feature is not built yet. Will be wired when a Downloads model exists.                                                              |
| `activePlans`         | number | `PackageCourseSubscription` + `EbookSubscription` where `customerId === me && status === true`                                                              |
| `unreadNotifications` | number | `Notification` where `customerId === me && isRead === false`                                                                                                |
| `pastExams`           | number | `ExamResult` where `customerId === me && status === true && inProgress === false && submittedAt !== null`, joined to `Exam` and filtered to `type === "daily"` |

All counts are computed in **parallel** via `Promise.all`, so total latency is ~one DB round trip rather than four. The `pastExams` count uses an aggregation (because `Exam.type` lives on a different collection than `ExamResult`); the others are plain `countDocuments`.

> **Listing endpoint pairing.** `pastExams` uses the **same predicate** as `GET /api/v1/client/quizzes/my/past-daily` (the listing screen the user lands on after tapping the "Exam Analytics" row). Badge count and list size will always agree. If you ever change one, change the other.

## Field-to-screen mapping

| UI row (My Profile)                          | API field             |
|----------------------------------------------|-----------------------|
| Saved Addresses · `2 addresses`              | `savedAddresses`      |
| Downloads · `2 active plans`                 | `downloads`           |
| My Subscriptions · `2 active plans`          | `activePlans`         |
| Notifications · `2 New Notifications`        | `unreadNotifications` |
| Exam Analytics · `1 Past Exam`               | `pastExams`           |

The static rows on the screen — Personal Information, Purchase History, Exam Analytics, Contact Us, FAQs, About Websankul, Settings, Logout, Refer & Earn — are **not** part of this endpoint. They are static navigation and need no count. The count next to "Exam Analytics" in the design (`1 Past Exam`) and any future similar badges can be added to this same payload later as new fields without breaking the response shape.

## Behaviour notes

- **Missing-feature rule:** when an underlying feature is not yet built, the field is **present and equals `0`**. Today this applies to `downloads`. The app should render the row unconditionally and rely on the count for "show / hide badge" decisions, not on field presence. This way wiring up Downloads later is a server-only change.
- **`activePlans` is a sum** across `PackageCourseSubscription` (course/package subs) and `EbookSubscription` (ebook subs). The screen says "active plans" without distinguishing the type, so we collapse them into one number. If the design later wants per-type counts, we can split the field without breaking the existing one (add `activePackagePlans`, `activeEbookPlans` alongside).
- **`status: true` is the active flag** in this codebase's subscription/address models. Date-based expiry (e.g. `endDate < now`) is **not** consulted here — the rest of the app already flips `status` to `false` on expiry/cancel. If that ever stops being true, this endpoint will need to add an `endDate >= now` clause.
- **Unread notifications** uses the same predicate as the existing notifications list endpoint (`customerId === me && isRead === false`), so the badge count and the unread items the user actually sees on the Notifications screen will always agree.

## Why one endpoint instead of four

Profile screen on app open should be one API call, not four. Each individual list endpoint (`GET /address`, `GET /notifications`, `GET /subscriptions`, …) returns full lists with pagination — overkill when all the screen needs is a count for a badge. This endpoint:

- runs four `countDocuments` queries in parallel (cheap — they hit existing indexes on `customerId`),
- returns ~80 bytes of JSON,
- gives the app one place to read all profile-screen badges from.

## Implementation pointers

- Handler: `getProfileDashboardCounts` in `src/client/profile/dashboard.controller.ts`.
- Route: registered in `src/client/profile/customer.routes.ts` at `/dashboard` under the `authenticate` middleware (mounted at `/api/v1/client/profile`).
- All four queries use `customerId` indexes that already exist on the relevant collections — no new indexes needed.

---

## Companion listing endpoint — Past Daily Tests

`GET /api/v1/client/quizzes/my/past-daily`

Drives the **Exam Analytics** screen the user lands on after tapping the row whose badge `pastExams` produces. Returns finished daily-test attempts only, newest first, paginated.

### Auth

Required (router-level `authenticate` on `/quizzes/*`).

### Query

| param   | type   | default | notes        |
|---------|--------|---------|--------------|
| `page`  | number | `1`     | 1-based      |
| `limit` | number | `20`    | clamped 1–100 |

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "attemptNumber": 1,
      "total": 50,
      "attempt": 48,
      "skip": 2,
      "success": 40,
      "failed": 8,
      "score": 32,
      "timing": "42:11",
      "submittedAt": "2026-05-07T14:23:11.000Z",
      "createdAt": "...",
      "updatedAt": "...",
      "exam": {
        "_id": "...",
        "title": "Daily Test - 7 May",
        "type": "daily",
        "durationMinutes": 60,
        "positiveMarks": 1,
        "negativeMarks": 0.33,
        "startAt": "2026-05-07T03:30:00.000Z"
      }
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

### Predicate (kept in lock-step with `pastExams`)

```
ExamResult.customerId === me
AND ExamResult.status === true
AND ExamResult.inProgress === false
AND ExamResult.submittedAt !== null
AND join(Exam).type === "daily"
```

If this is ever broadened (e.g. include subject mocks too), update both this endpoint *and* the `pastExams` count in `dashboard.controller.ts` in the same change.

### Why a new endpoint instead of reusing `GET /quizzes/my/attempts`

`GET /my/attempts` ([exam.controller.ts: listMyResults](src/client/exam/exam.controller.ts)) returns **all** attempts of any type, including in-progress ones. The Exam Analytics screen specifically wants **past daily tests**, so it needs a tighter predicate. Adding query-param filters to the existing endpoint would have made the badge count harder to keep in sync — separate endpoint with a single, fixed predicate keeps the two glued together.

---

## What's next (not in this PR)

- Wire `downloads` to a real source once the Downloads feature is designed (likely a `CustomerDownload` model with `customerId` + `itemType` + `itemId`).
- If "Exam Analytics" should later include other test types (mocks, subject tests), broaden the predicate in **both** the `pastExams` count and `listMyPastDailyResults` listing in the same change. The doc and code already point that out.
- If the app needs *list previews* (e.g. show the first 2 addresses on the profile screen instead of just a count), extend the dashboard endpoint with optional `include=addresses,subscriptions` query params rather than creating a new endpoint.
