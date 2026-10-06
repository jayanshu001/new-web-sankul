# Admin — Subscription course change, move, deactivate + change history

Backend spec for the new admin panel (`websankul-admin`). These are the course/package
subscription actions the legacy panel offered on **Customer details → Package/Course tabs**:

| Legacy panel (Laravel)                               | New endpoint                                           |
|------------------------------------------------------|--------------------------------------------------------|
| ✏ Update subscription (`Subscriptions::update`)       | `POST /api/v1/admin/subscriptions/:id/change-product`  |
| ⇄ Move to other customer (`moveSubscription`)         | `POST /api/v1/admin/subscriptions/:id/move`            |
| ⊘ Deactivate (`deactivateCourse`)                     | `POST /api/v1/admin/subscriptions/:id/deactivate`      |
| Add Days (`Customers::update_subcription`)             | `POST /api/v1/admin/subscriptions/:id/add-days`        |
| — (new: undo the last Deactivate)                      | `POST /api/v1/admin/subscriptions/:id/revert-deactivation` |
| Remarks history column                                | `GET  /api/v1/admin/subscriptions/:id/history`         |

`:id` = `ws_package_course_subscription.id` (the `id` / `_id` of a subscription row).
All require a Bearer token. **No schema change**: history lives in the subscription's
existing `remarks` TEXT column in the legacy `[YYYY-MM-DD HH:mm:ss] text` format (IST,
newest first), so both panels read and write the same history. The acting admin comes
from the JWT, is stamped on `updated_by`, and is written into each entry.

## Permissions

One key per subscription type × action (2026-10-06, catalog module **Customers**). The
old `.edit` keys no longer grant these actions; super-admins always pass.

| Action | Course | Package | Live course | Test series | Ebook |
|---|---|---|---|---|---|
| Change product | `customers.course-subscriptions.change` | `customers.package-subscriptions.change` | `customers.live-course-subscriptions.change` | — | — |
| Move | `….course-subscriptions.move` | `….package-subscriptions.move` | `….live-course-subscriptions.move` | — | — |
| Deactivate | `….course-subscriptions.deactivate` | `….package-subscriptions.deactivate` | `….live-course-subscriptions.deactivate` | — | — |
| Revert deactivation | `….course-subscriptions.revert` | `….package-subscriptions.revert` | `….live-course-subscriptions.revert` | — | — |
| Add days | `….course-subscriptions.add-days` | `….package-subscriptions.add-days` | `….live-course-subscriptions.add-days` | `customers.test-series-subscriptions.add-days` | `customers.ebook-subscriptions.add-days` |
| Edit (`PUT /subscriptions/:id`: dates, status, shipping, payment) | `….course-subscriptions.edit` | `….package-subscriptions.edit` | — | — | — |

The **Subscriptions** module has no `edit` / `toggle-status` keys any more (view, create,
delete only); row edits use the per-type keys above.

`/admin/subscriptions/:id/<action>` serves both course and package rows, so the route map
admits either type's key and the controller (`authorizeSubAction`) then requires the
row's own type.

| Route | Any of |
|---|---|
| `history` | `subscriptions.view`, `subscriptions.reports.view`, `subscriptions.material-report.view`, `customers.view` |

## Envelope

Standard envelope, `{ success, code, data, message, messages }`. Validation errors
return **422**, with `messages` as a flat `field → message` map.

```json
{ "success": false, "code": 422, "data": {}, "message": "Validation failed.",
  "messages": { "courseId": "Provide exactly one of courseId or packageId." } }
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
| `remark` | optional, max 500 chars — the default history line is always written |
| `confirmDates` | optional boolean — accept the queued dates from a 409 (see "Overlap" below) |

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
number. `customer_id` changes on the subscription **and on the order that paid for it**
(`ws_package_course_order.customer_id`), in one transaction, so the purchase follows the
student. An order another subscription still references (legacy data) is left alone. The
order's `shipping` snapshot is not touched. The target must be a live account
(`is_account_deleted = 0`). Both customers' cached catalog reads are flushed.

```json
{ "customerId": 48213, "remark": "Old number lost" }
```

| Field | Rule |
|---|---|
| `customerId` | required, positive integer — the **new** owner |
| `remark` | optional, ≤ 500 chars (legacy had none) |
| `confirmDates` | optional boolean — accept the queued dates from a 409 (see "Overlap" below) |

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

## Overlap with an active subscription (change-product / move, and the live-course twins)

When the transfer would land on a product the customer **already holds actively**
(change-product / change-course: this customer, target product; move: target customer,
same product), the row is queued after it instead of overlapping:

- remaining time = `end_at − max(now, start_at)`
- new `start_at` = the latest active row's `end_at`; new `end_at` = new start + remaining time
- deactivated (`start_at = end_at`) and expired rows don't count; a row that already starts
  after the active one ends is left alone

Without `confirmDates: true` nothing is written. The server answers **409** with the
proposed dates for the admin to confirm:

```json
{ "success": false, "code": 409,
  "message": "Customer already has this product active. Confirm to queue this subscription after it.",
  "data": { "dateShift": { "activeSubscriptionId": "123", "activeEndAt": "2026-12-10T…",
    "startAt": "2026-12-10T…", "endAt": "2027-03-06T…", "days": 86 } } }
```

Re-send the same body with `"confirmDates": true` to apply it. The history entry gets
the date change appended:
`Course/package changed: … -> …. Dates moved after active subscription #123: 2026-01-01 00:00:00 - 2026-12-31 00:00:00 -> 2026-12-10 00:00:00 - 2027-03-06 00:00:00 | by Jane Doe (#5)`

### Move only: a queued row is pulled forward

A row that starts in the future was usually queued behind the **old** owner's active
subscription. That anchor stays with the old owner, so on move (course/package and
live course) the row is pulled forward instead of keeping a far-off start:

- new `start_at` = the target customer's latest active `end_at` for that product, or
  **now** when they hold none; new `end_at` = new start + the row's original length
- only when that is earlier than the row's current `start_at`; running, deactivated and
  overlapping rows are untouched (the overlap case is the 409 flow above)
- applied directly — no 409, no `confirmDates` — and recorded in the history entry:
  `… moved from … to …. Queued dates moved up to start now: 2027-04-01 11:55:37 - 2027-04-15 11:55:37 -> 2026-10-06 13:58:29 - 2026-10-20 13:58:29 | by Jane Doe (#5)`
  (or `… to follow active subscription #123: …`)

---

## POST `/admin/subscriptions/:id/deactivate`

Same rule as legacy: `end_at := start_at` (or now if there is no start date), so every
entitlement check closes immediately, **and `status := 0`** (inactive). The previous
status is recorded in the history entry so Revert can restore it. The row still appears in
purchase history, where it reads as inactive.

```json
{ "remark": "Refund issued" }
```

`remark` is optional (max 500 chars); the history entry below is always written.

200 `message: "Subscription deactivated."`

| Status | message |
|---|---|
| 404 | `Subscription not found.` |
| 422 | `Subscription is already deactivated.` |

History entry: `Deactivated: end date 2026-12-31 23:59:59 -> 2026-01-01 10:00:00, status active -> inactive. Remark: Refund issued | by Jane Doe (#5)`

A row is "deactivated" when `startAt === endAt`. Legacy showed this as a red **Deactivated** label.

## POST `/admin/subscriptions/:id/revert-deactivation`

Undoes the most recent Deactivate. The old end date is read back from the newest
`Deactivated: end date X -> Y, status S -> inactive` entry in `remarks`; `end_at := X` and
`status := S`. Entries written before Deactivate set the status (no `, status …` part)
restore `status := 1`. One `UPDATE` on the same row; nothing else is touched.

It is refused (nothing written) unless the row's current `end_at` still equals that
entry's `Y` — i.e. nothing changed the end date after the deactivation (no Add Days,
no PUT edit, not already reverted). Legacy free-text entries such as `deactivated: fraud`
carry no old date and cannot be reverted.

```json
{}
{ "remark": "Deactivated by mistake" }
```

| Field | Rule |
|---|---|
| `remark` | optional, max 500 chars |

200 `message: "Deactivation reverted."`, `data` = the `GET /admin/subscriptions/:id` DTO.

| Status | message |
|---|---|
| 404 | `Subscription not found.` |
| 422 | `No deactivation with a recorded end date to revert.` |
| 422 | `Subscription is not deactivated, or was changed after its last deactivation.` |

History entry: `Deactivation reverted: end date 2026-01-01 10:00:00 -> 2026-12-31 23:59:59, status inactive -> active. Remark: Deactivated by mistake | by Jane Doe (#5)`

Live course: `POST /admin/live-courses/subscriptions/:id/revert-deactivation`, same body,
rules and messages; returns `data.subscription`. Permission: the type's `.revert` key
(see Permissions).

The restored end date has second precision (the history stamp's precision); the
legacy `end_at` column is `datetime`, so nothing finer is lost.

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
| `POST /admin/subscriptions/:id/add-days` (course / package) | `customers.course-subscriptions.add-days` / `customers.package-subscriptions.add-days` (the row's type) | subscription DTO |
| `POST /admin/live-courses/subscriptions/:id/add-days` | `customers.live-course-subscriptions.add-days` | `{ subscription }` (live DTO) |
| `POST /admin/test-series/subscriptions/:id/add-days` | `customers.test-series-subscriptions.add-days` | `{ subscription }` (test-series DTO) |
| `POST /admin/ebooks/subscriptions/:id/add-days` | `customers.ebook-subscriptions.add-days` | `{ subscription }` (same as the ebook PUT) |

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
`GET /admin/live-courses/subscriptions/:id` DTO). Permission: the matching
`customers.live-course-subscriptions.*` key (see Permissions).

| Route | Body | 200 message |
|---|---|---|
| `POST /admin/live-courses/subscriptions/:id/change-course` | `{ liveCourseId, remark?, confirmDates? }` | `Subscription live course changed.` |
| `POST /admin/live-courses/subscriptions/:id/move` | `{ customerId, remark?, confirmDates? }` | `Subscription moved.` |
| `POST /admin/live-courses/subscriptions/:id/deactivate` | `{ remark? }` | `Subscription deactivated.` |

- **change-course** switches only to another live course (not to a course/package —
  separate tables, separate orders). Only `live_course_id` changes and a history entry
  is added. `plan_id`, order, amount, dates and `pc_material_id` are untouched.
  404 `Live course not found.`; 422 `Subscription is already on this live course.` (`messages.liveCourseId`).
- **move** / **deactivate**: identical to the course/package versions (`customer_id` on the
  subscription and on its `ws_live_course_order`; `end_at := start_at`, `status := 0`).

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

- **Customer details → Courses / Packages tabs:** an **Actions** column with Change course/package, Move to another
  customer, Deactivate and Revert — each button shown only when the admin holds that type's
  key (see Permissions); the column is hidden when they hold none. The **Live Courses** tab
  has the same column, where Change switches to another live course. Add Days is gated the
  same way, per type. All three open `SubscriptionActionModal`; after any action the panel stays on the
  customer and reloads the tables, as legacy does. Legacy gating: every button is disabled
  unless the row is active (`endAt` in the future and `startAt !== endAt`); Add Days is
  disabled on a deactivated row. Deactivation runs in sequence per product: Deactivate
  appears only on the newest row that isn't deactivated (`canDeactivate`), and Revert only
  on the deactivated row directly above it, or the oldest row once all are deactivated
  (`canRevert`) — both flags on the customer's course / package / live-course subscription
  lists. Rows where `startAt === endAt` show a red **Deactivated** badge.
- **Subscription details page (course/package):** a **History** card from `/history`. It falls
  back to the raw Remarks card if that call fails.

## Not covered

- Legacy "Lifetime" toggle (hard-coded package 3 ↔ 64 swap): use `change-product`.
- Deleting a subscription deletes its history with it, as in legacy.
- Ebook / test-series subscriptions: only `add-days` (above). Change / move / deactivate
  are not in scope; the helper (`utils/subscriptionRemarkHistory.ts`) works on their
  `remarks` columns if added later.
