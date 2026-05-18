# Promoter Dashboard — Overview API

Powers the **Promoter Dashboard** screen: totals card on the left, growth chart in the middle, and "Recent Subscriptions" list on the right. One endpoint returns everything the screen needs — no fan-out from the FE.

Two endpoints, **identical response shape**, different auth:

| Use case | Endpoint | Auth |
|---|---|---|
| Admin viewing a specific promoter (this is the panel screen) | `GET /api/v1/admin/promoters/:id/dashboard` | `admin` / `super_admin` token |
| Promoter viewing their own dashboard (separate promoter portal) | `GET /api/v1/promoter/dashboard/overview` | `promoter` token |

The `:id` in the admin route is the promoter's MongoDB id (found via `GET /api/v1/admin/promoters`). The promoter version reads the id from the bearer token.

---

## Endpoint (admin — what the panel uses)

```
GET /api/v1/admin/promoters/:id/dashboard?range=<key>
Authorization: Bearer <admin_token>
```

**Role required:** `admin` or `super_admin`.

Returns `404` if the promoter id is unknown or soft-deleted, `400` if the id isn't a valid ObjectId.

---

## Endpoint (promoter self-view)

```
GET /api/v1/promoter/dashboard/overview?range=<key>
Authorization: Bearer <promoter_token>
```

**Role required:** `promoter`.

---

## Query params

| Name    | Type   | Default | Allowed values                              |
|---------|--------|---------|---------------------------------------------|
| `range` | string | `all`   | `today` \| `week` \| `month` \| `year` \| `all` |

Maps directly to the chip row on the screen (`Today | This Week | This Month | This Year | All`).

Range semantics:

| Range   | Window                                     | Chart bucket |
|---------|--------------------------------------------|--------------|
| `today` | midnight today → now                       | hour (`%Y-%m-%d %H:00`) |
| `week`  | last 7 days (incl. today) → now            | day  (`%Y-%m-%d`) |
| `month` | 1st of current month → now                 | day  (`%Y-%m-%d`) |
| `year`  | Jan 1 of current year → now                | month (`%Y-%m`) |
| `all`   | beginning of time → now                    | month (`%Y-%m`) |

Invalid / missing `range` falls back to `all`.

---

## Response

```jsonc
{
  "success": true,
  "data": {
    "range": "all",
    "window": {
      "start": null,           // null for `range=all`, ISO date otherwise
      "end":   "2026-05-18T12:34:56.000Z"
    },

    // Top-left totals card
    "totals": {
      "subscriptions": 12,     // count of PackageCourseSubscription rows
      "earnings":      27542,  // sum of paidAmount (₹)
      "commission":    2754    // sum of paidAmount * promoterPercentage / 100 (₹)
    },

    // Growth chart (the line graph)
    "chart": {
      "unit": "month",         // "hour" | "day" | "month" — use to label x-axis
      "points": [
        { "bucket": "2026-01", "subscriptions": 2, "earnings": 3500 },
        { "bucket": "2026-02", "subscriptions": 0, "earnings": 0 },
        { "bucket": "2026-03", "subscriptions": 8, "earnings": 18420 },
        { "bucket": "2026-04", "subscriptions": 1, "earnings": 1950 },
        { "bucket": "2026-05", "subscriptions": 1, "earnings": 3672 }
      ]
    },

    // Right-hand "Recent Subscriptions" list (always last 5, regardless of range)
    "recentSubscriptions": [
      {
        "id": "65a1b2c3...",
        "customer": {
          "id": "...",
          "name": "Mangal Dhamot",
          "phoneNumber": "9876543210"
        },
        "course":    { "id": "...", "name": "TET 1" },
        "promocode": "WEB10",
        "amount":    1950,
        "status":    "complete",          // "complete" | "pending"
        "createdAt": "2026-11-18T01:44:00.000Z"
      }
      // … up to 5
    ]
  }
}
```

### Field guide

**`totals`**
- `subscriptions` — count of the promoter's `PackageCourseSubscription` rows inside the range. Matches the **"All Subscriptions"** number on the screen.
- `earnings` — `Σ paidAmount`. Matches the **"All Earnings"** ₹ figure (gross paid by buyers).
- `commission` — `Σ (paidAmount × promoterPercentage / 100)`. The promoter's actual take. Show as a secondary stat if you want; the screenshot shows gross earnings.

**`chart.points`**
- One entry per non-empty bucket. The FE should pad with zeros if it wants a gap-free axis (typical chart libs handle this with `connectNulls: false`).
- `bucket` is a sortable string in the format implied by `chart.unit`.

**`recentSubscriptions`**
- Always the latest 5, independent of `range`. This matches the screenshot's "Recent Subscriptions" panel which doesn't change as the user clicks chips.
- `promocode` is the redeemed code's text, or `null` if the buyer didn't use one (rare for a promoter-attributed sub but possible historically).
- `status: "complete"` when the subscription's `status` flag is `true` (paid + activated); `"pending"` otherwise.

---

## Error responses

| Status | Body                                                       | When                              |
|--------|------------------------------------------------------------|-----------------------------------|
| `401`  | `{ "success": false, "message": "Unauthorized." }`         | Missing / invalid bearer.         |
| `403`  | role check failure (handled by middleware)                 | Token belongs to a non-promoter.  |
| `500`  | `{ "success": false, "message": "<error>" }`               | Unexpected aggregation failure.   |

---

## What's intentionally *not* in this endpoint

Things the existing **`GET /api/v1/promoter/dashboard`** endpoint already returns and that this new endpoint deliberately skips:

- Ebook subscription counts / revenue — the screen is course-focused. Hit `/dashboard` if you need ebook stats.
- Active vs. inactive promocode counts — irrelevant to this screen.
- Unique customer count — same.

The new endpoint is **screen-shaped**, not a general-purpose stats dump.

---

## Suggested FE wiring

1. **On screen mount** — call `/overview` with no `range` (defaults to `all`). Render totals + chart + recent list.
2. **On chip click** — re-call with the corresponding `range`. Replace totals and chart; **leave recentSubscriptions visible** (it's range-independent, so optionally just don't re-render that pane to avoid flicker).
3. **Chart x-axis label** — use `chart.unit` to format ticks:
   - `hour` → `"14:00"`
   - `day` → `"Nov 18"`
   - `month` → `"Nov '25"`
4. **Empty state** — if `totals.subscriptions === 0`, render a "No subscriptions yet" placeholder over the chart instead of an empty graph.

---

## Endpoint quick reference (promoter side)

| Method | Path                                          | Purpose                                            |
|--------|-----------------------------------------------|----------------------------------------------------|
| GET    | `/api/v1/admin/promoters/:id/dashboard`       | **Admin** — screen-shaped data for one promoter    |
| GET    | `/api/v1/promoter/dashboard/overview`         | **Promoter self-view** — same shape                |
| GET    | `/api/v1/admin/promoters`                     | List promoters (to find the `:id` for the screen)  |
| GET    | `/api/v1/admin/promoters/:id/promocodes`      | That promoter's promocodes                         |
| GET    | `/api/v1/admin/promoters/:id/subscriptions`   | That promoter's full subscription listing          |

---

## Related files
- Shared service (single source of truth for the response): [src/promoter/dashboard/overview.service.ts](src/promoter/dashboard/overview.service.ts)
- Admin handler + route: [src/admin/promoter/promoter.controller.ts](src/admin/promoter/promoter.controller.ts), [src/admin/promoter/promoter.routes.ts](src/admin/promoter/promoter.routes.ts)
- Promoter self-view handler + route: [src/promoter/dashboard/dashboard.controller.ts](src/promoter/dashboard/dashboard.controller.ts), [src/promoter/dashboard/dashboard.routes.ts](src/promoter/dashboard/dashboard.routes.ts)
- Subscription model: [src/models/customer/PackageCourseSubscription.model.ts](src/models/customer/PackageCourseSubscription.model.ts)
