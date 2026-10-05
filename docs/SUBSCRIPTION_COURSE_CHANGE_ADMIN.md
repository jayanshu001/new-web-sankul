# Admin — Subscription course change, move, deactivate + change history

Backend spec for the new admin panel (`websankul-admin`). These are the course/package
subscription actions the legacy panel offered on **Customer details → Package/Course tabs**:

| Legacy panel (Laravel)                               | New endpoint                                           |
|------------------------------------------------------|--------------------------------------------------------|
| ✏ Update subscription (`Subscriptions::update`)       | `POST /api/v1/admin/subscriptions/:id/change-product`  |
| ⇄ Move to other customer (`moveSubscription`)         | `POST /api/v1/admin/subscriptions/:id/move`            |
| ⊘ Deactivate (`deactivateCourse`)                     | `POST /api/v1/admin/subscriptions/:id/deactivate`      |
| Add Days (`Customers::update_subcription`)             | `POST /api/v1/admin/subscriptions/:id/add-days`        |
| Remarks history column                                | `GET  /api/v1/admin/subscriptions/:id/history`         |

`:id` = `ws_package_course_subscription.id` (the `id` / `_id` of a subscription row).
All require a Bearer token. **No schema change**: history lives in the subscription's
existing `remarks` TEXT column in the legacy `[YYYY-MM-DD HH:mm:ss] text` format (IST,
newest first), so both panels read and write the same history. The acting admin comes
from the JWT, is stamped on `updated_by`, and is written into each entry.

## Permissions

| Route | Any of |
|---|---|
| `change-product`, `move`, `deactivate` | `subscriptions.edit`, `customers.edit` |
| `history` | `subscriptions.view`, `subscriptions.reports.view`, `subscriptions.material-report.view`, `customers.view` |

## Envelope

Standard envelope, `{ success, code, data, message, messages }`. Validation errors
return **422**, with `messages` as a flat `field → message` map.

```json
{ "success": false, "code": 422, "data": {}, "message": "Validation failed.",
  "messages": { "remark": "Remark is required." } }
```

The three writes return `data` = the same DTO as `GET /admin/subscriptions/:id`
(`_id`, `customerId{…}`, `courseId`, `packageId`, `planId`, `startAt`, `endAt`, `remark`, …).
`remark` in that DTO is the full history string. Use `/history` to get it structured.

---

## POST `/admin/subscriptions/:id/change-product`

Switches the subscription to another course **or** package. The other one is cleared,
as in legacy. Only `course_id` / `package_id` change and a history entry is added.
Plan (`pcb_id`), dates, amount, order, payment and material are not touched.

```json
{ "courseId": 12, "remark": "Student enrolled in wrong batch" }
{ "packageId": 3, "remark": "Upgrade to full package" }
```

| Field | Rule |
|---|---|
| `courseId` / `packageId` | exactly one, positive integer |
| `remark` | required, 1–500 chars |

200 `message: "Subscription course/package changed."`

| Status | message |
|---|---|
| 404 | `Subscription not found.` / `Course not found.` / `Package not found.` |
| 422 | `Validation failed.` — `messages.courseId: "Provide exactly one of courseId or packageId."` |
| 422 | `Subscription is already on this course/package.` (`messages.courseId` or `messages.packageId`) |

History entry written:
`Course/package changed: Package "A" (#3) -> Course "B" (#12). Remark: … | by Jane Doe (#5)`

Pickers: reuse `GET /admin/courses` and `GET /admin/packages`. A `planId` key is ignored.

## POST `/admin/subscriptions/:id/move`

Moves the subscription to another customer, for example when a student changes mobile
number. Only `customer_id` changes. The target must be a live account
(`is_account_deleted = 0`). Both customers' cached catalog reads are flushed.

```json
{ "customerId": 48213, "remark": "Old number lost" }
```

| Field | Rule |
|---|---|
| `customerId` | required, positive integer — the **new** owner |
| `remark` | optional, ≤ 500 chars (legacy had none) |

200 `message: "Subscription moved."`. `data.customerId` is now the new owner.

| Status | message |
|---|---|
| 404 | `Subscription not found.` / `Customer not found.` (missing or deleted account) |
| 422 | `Subscription already belongs to this customer.` (`messages.customerId`) |

Customer picker: reuse `GET /admin/customers?search=`. Legacy stays on the current
customer and reloads its tables afterwards (its JSON carries a `redirect_url`, but the
page never follows it).

History entry written (legacy wording, plus both ids):
`Mobile number changed - subscription moved from 98xxxxxx01 (customer #100) to 97xxxxxx02 (customer #48213). Remark: … | by Jane Doe (#5)`

## POST `/admin/subscriptions/:id/deactivate`

Same rule as legacy: `end_at := start_at` (or now if there is no start date), so every
entitlement check closes immediately. `status` is **not** changed, and the row still
appears in purchase history, where it reads as expired.

```json
{ "remark": "Refund issued" }
```

200 `message: "Subscription deactivated."`

| Status | message |
|---|---|
| 404 | `Subscription not found.` |
| 422 | `Subscription is already deactivated.` |
| 422 | `Validation failed.` — `messages.remark: "Remark is required."` |

History entry: `Deactivated: end date 2026-12-31 23:59:59 -> 2026-01-01 10:00:00. Remark: Refund issued | by Jane Doe (#5)`

A row is "deactivated" when `startAt === endAt`. Legacy showed this as a red **Deactivated** label.

## POST `/admin/subscriptions/:id/add-days`

Legacy Add Days edited the clicked row's `end_at` in place. This does the same: no new
subscription row and no order row. `end_at := max(end_at, now) + days` (calendar days), so
an expired row gets N days from now. `start_at`, `status`, plan, amount and order are
not touched.

```json
{ "days": 10 }
{ "days": 10, "remark": "Compensation for app outage" }
```

| Field | Rule |
|---|---|
| `days` | required, positive integer |
| `remark` | optional, max 500 chars — the server always writes the entry below |

200 `message: "Days added."`, `data` = the `GET /admin/subscriptions/:id` DTO.

| Status | message |
|---|---|
| 404 | `Subscription not found.` |
| 422 | `Validation failed.` — `messages.days: "Days must be a positive whole number."` |

History entry: `Added 10 days: end date 2026-10-10 18:00:00 -> 2026-10-20 18:00:00. Remark: Compensation for app outage | by Jane Doe (#5)`

The same action exists for every product with an `endAt`:

| Route | Permission (any of) | 200 `data` |
|---|---|---|
| `POST /admin/subscriptions/:id/add-days` (course / package) | `subscriptions.edit`, `customers.edit` | subscription DTO |
| `POST /admin/live-courses/subscriptions/:id/add-days` | `live-courses.edit`, `customers.edit` | `{ subscription }` (live DTO) |
| `POST /admin/test-series/subscriptions/:id/add-days` | `test-series.edit`, `customers.edit` | `{ subscription }` (test-series DTO) |
| `POST /admin/ebooks/subscriptions/:id/add-days` | `ebooks.edit`, `customers.edit` | `{ subscription }` (same as the ebook PUT) |

The paid **Subscription Type = Extend** on Add Subscription is unchanged: it still writes a
new row tied to its own order.

## GET `/admin/subscriptions/:id/history`

```json
{
  "success": true, "code": 200, "message": "", "messages": {},
  "data": {
    "_id": "9001",
    "customerId": { "_id": "48213", "firstName": "Ravi", "lastName": "Patel", "phoneNumber": "97…", "emailAddress": null },
    "courseId": "12",
    "packageId": null,
    "product": "Course \"B\" (#12)",
    "createdAt": "2026-01-01T04:30:00.000Z",
    "createdBy": { "_id": "5", "name": "Jane Doe" },
    "updatedAt": "2026-09-29T06:30:00.000Z",
    "updatedBy": { "_id": "7", "name": "Amit Shah" },
    "history": [
      { "at": "2026-09-29 12:00:00", "text": "Course/package changed: … Remark: …", "changedBy": { "_id": "7", "name": "Amit Shah" } },
      { "at": "2025-01-05 10:00:00", "text": "deactivated: fraud", "changedBy": null }
    ]
  }
}
```

- `history` is newest first. `at` is IST wall-clock text (`YYYY-MM-DD HH:mm:ss`), not ISO.
  It is `null` for old free-text remarks written before timestamps were added.
- `changedBy` is `null` on entries the legacy panel wrote, because it recorded only the
  last editor, in `updated_by`.
- `createdBy` / `updatedBy` are `null` when not admin-attributed (online purchases).
  `name` is `null` if the admin user no longer exists.
- 404 `Subscription not found.`

## Live course subscriptions

Same three actions on `ws_live_course_subscription`, with the same rules, the same
history format in its `remarks` column, and the same 422 `messages` map. `:id` is the
live subscription id. They return `data.subscription` (the
`GET /admin/live-courses/subscriptions/:id` DTO). Permission: `live-courses.edit` or
`customers.edit`.

| Route | Body | 200 message |
|---|---|---|
| `POST /admin/live-courses/subscriptions/:id/change-course` | `{ liveCourseId, remark }` | `Subscription live course changed.` |
| `POST /admin/live-courses/subscriptions/:id/move` | `{ customerId, remark? }` | `Subscription moved.` |
| `POST /admin/live-courses/subscriptions/:id/deactivate` | `{ remark }` | `Subscription deactivated.` |

- **change-course** switches only to another live course (not to a course/package —
  separate tables, separate orders). Only `live_course_id` changes and a history entry
  is added. `plan_id`, order, amount, dates and `pc_material_id` are untouched.
  404 `Live course not found.`; 422 `Subscription is already on this live course.` (`messages.liveCourseId`).
- **move** / **deactivate**: identical to the course/package versions (only `customer_id`
  changes; `end_at := start_at`, `status` untouched).

History entry: `Live course changed: Live course "A" (#3) -> Live course "B" (#7). Remark: … | by Jane Doe (#5)`

There is no `/history` route for live subscriptions; the history string is the DTO's `remarks`.

## Behaviour change on the existing `PUT /admin/subscriptions/:id`

- `remark` **no longer overwrites** `remarks`. It becomes the note on a new history
  entry. Previously a save wiped the whole history.
- Each changed field (`startAt`, `endAt`, `status`, `customerShippingId`, `trackingId`,
  `paymentMethod`, and the bank or Razorpay ids) is written to history as `old -> new`
  together with the acting admin. A PUT that changes nothing and has no remark writes nothing.
- This schema only accepts `remark` (singular); a `remarks` key is silently dropped. Send
  `remark` and **don't pre-fill it** with the existing history. (The panel's edit modal
  sent `remarks` and pre-filled it; it was fixed on 2026-09-30.)

## Where it lives in the admin panel (`websankul-admin`)

- **Customer details → Courses / Packages tabs:** an **Actions** column (shown when the admin
  holds `subscriptions.edit` or `customers.edit`) with Change course/package, Move to another
  customer, and Deactivate. The **Live Courses** tab has the same column (gated on
  `live-courses.edit` or `customers.edit`), where Change switches to another live course. All three open `SubscriptionActionModal`; after any action the panel stays on the
  customer and reloads the tables, as legacy does. Legacy gating: every button is disabled
  unless the row is active (`endAt` in the future and `startAt !== endAt`), and on the
  Packages tab Deactivate appears only on the customer's latest row for that package
  (`isLatest` on `GET /admin/customers/:id/package-subscriptions`). Rows where
  `startAt === endAt` show a red **Deactivated** badge.
- **Subscription details page (course/package):** a **History** card from `/history`. It falls
  back to the raw Remarks card if that call fails.

## Not covered

- Legacy "Lifetime" toggle (hard-coded package 3 ↔ 64 swap): use `change-product`.
- Deleting a subscription deletes its history with it, as in legacy.
- Ebook / test-series subscriptions: only `add-days` (above). Change / move / deactivate
  are not in scope; the helper (`utils/subscriptionRemarkHistory.ts`) works on their
  `remarks` columns if added later.
