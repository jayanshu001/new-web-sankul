# TeleCRM Integration

> **Status: PORTED.** This document describes the OLD Mongo backend's implementation
> (kept for historical reference and behavior parity). The new MySQL backend's port
> lives in `src/utils/crm.ts` (`GenerateCRMLead`), `src/config/telecrm.ts` (config),
> and `src/shared/enums.ts` (`CRM_LEAD_TYPE`). See `docs/MIGRATION_QUERY_CHANGES.md`
> (2026-09-15 entry) for what changed vs. this doc, including the two new lead types
> (`VIEW_LIVE_COURSE`, `VIEW_TEST_SERIES`) added for products this old backend never had.

Backend integration that pushes customer activity as leads to TeleCRM, so the sales/support team can follow up on signups, package/course views, and payments.

## Entry point

`exports.GenerateCRMLead` in [src/libs/utils.js](../src/libs/utils.js#L336)

```js
await utils.GenerateCRMLead({
  params: { userId, packageId, courseId, planId, packageName, courseName, amount },
  leadType: CRM_LEAD_TYPE.LOGIN, // etc.
});
```

Called with `setImmediate(...)` (fire-and-forget) from controllers so it never blocks the API response.

## Guardrails

- **Production only** — the function returns immediately if `process.env.NODE_ENV !== 'production'`. No leads are sent from local/dev/staging.
- **Requires a `userId`** — returns early otherwise.
- **Testing accounts are excluded** — phone numbers in `constants.TESTING_ACCOUNTS` ([src/libs/constants.js](../src/libs/constants.js#L18)) never generate a lead.
- **Active subscription blocks the lead** — if the user already has a non-expired `PackageCourseSubscription` for the given `packageId`/`courseId`, no lead is sent (avoids re-pitching existing customers).

## Lead types

Defined in `CRM_LEAD_TYPE` ([src/libs/enums.js](../src/libs/enums.js#L2)):

| Lead type | Value sent | Triggered from |
|---|---|---|
| `LOGIN` | `Login` | [routes/v1/otp/controller.js](../src/routes/v1/otp/controller.js#L338) — on OTP login, only if the user has a name or email on file |
| `SIGNUP` | `Signup` | [routes/v1/user/controller.js](../src/routes/v1/user/controller.js#L196) — on profile completion (name + email present) |
| `VIEW_PACKAGE` | `View Package` | [routes/v2/package/controller.js](../src/routes/v2/package/controller.js#L28) — package detail view |
| `VIEW_COURSE` | `View Course` | [routes/v2/course/controller.js](../src/routes/v2/course/controller.js#L31) and [L229](../src/routes/v2/course/controller.js#L229) — course detail view |
| `PAYMENT_MODE` | `Payment Mode` | [routes/v1/websankul/controller.js](../src/routes/v1/websankul/controller.js#L415) — order created, payment method selected |
| `PAYMENT_SUCCESS` | `Payment Success` | [routes/v1/websankul/controller.js](../src/routes/v1/websankul/controller.js#L824) — subscription activated after successful payment |
| `PAYMENT_FAILED` | `Payment Failed` | **Defined but not currently wired up** — no call site in the codebase yet |

## Payload shape

```json
{
  "fields": {
    "name": "user.fullName",
    "email": "user.emailAddress",
    "phone": "user.phoneNumber",
    "application_course": "package/course name",
    "amount": "order or plan amount (when applicable)"
  },
  "actions": [
    { "type": "SYSTEM_NOTE", "text": "<human-readable event summary with timestamp>" }
  ]
}
```

- `fields.name/email/phone` are always pulled from the latest `Customer` record for `userId`.
- `fields.application_course` and `fields.amount` are only set for package/course/payment lead types.
- The `SYSTEM_NOTE` text differs per lead type (e.g. `Payment Mode - <package> - <plan> - <amount> - <date>`, `View Course - <course> - <educator> - <date>`).

## Delivery

`sendToTeleCrm(payload)` (inline helper inside `GenerateCRMLead`) POSTs the payload to TeleCRM:

- **URL**: `process.env.TELE_CRM_BASE_URL`
- **Auth**: `Authorization: Bearer <process.env.TELE_CRM_ACCESS_TOKEN>`
- Configured per environment in `.env`, `.env.development`, `.env.staging` (values are secrets — not reproduced here).
- Errors from the POST are caught and logged (`Error sending to TeleCRM:`) but never thrown — a TeleCRM outage cannot break the calling API request.

## Full execution order (for porting to a new backend)

```
function GenerateCRMLead(params, leadType):
    if NODE_ENV != "production": return          # (1) prod-only gate

    userId = params.userId
    if !userId: return

    user = Customer.findFirst({ id: userId }, orderBy: createdAt desc)
    if !user: return

    isTestingAccount = TESTING_ACCOUNTS.includes(user.phoneNumber)

    payload = {
      fields: { name: user.fullName, email: user.emailAddress, phone: user.phoneNumber },
      actions: []
    }
    now = current time, formatted "en-GB" (e.g. "15/09/2026, 14:32:10")

    # (2) skip if the user already has a live subscription for this package/course
    if params.packageId or params.courseId:
        existing = PackageCourseSubscription.findFirst({
            customerId: userId,
            packageId: params.packageId,   # only included if provided
            courseId: params.courseId,     # only included if provided
            endAt: { gt: now }
        })
        if existing: return

    # (3) resolve plan -> may override packageId/courseId
    plan = null
    if params.planId:
        plan = PackageCourseEbookPrice.findUnique({ id: params.planId })
        if plan:
            packageId = plan.packageId ?? params.packageId
            courseId  = plan.courseId  ?? params.courseId

    # (4) build the SYSTEM_NOTE text — see table below
    switch leadType: ...

    # (5) send, unless test account (redundant with gate #1, but also present)
    if NODE_ENV == "production" and !isTestingAccount:
        POST TELE_CRM_BASE_URL, body=payload, header Authorization: Bearer TELE_CRM_ACCESS_TOKEN
        # errors are caught and logged only — never surfaced to the caller
```

## Exact `SYSTEM_NOTE` text templates

| Case | Condition | Text |
|---|---|---|
| `LOGIN` | — | `Application Login - {now}` |
| `SIGNUP` | — | `Application Signup - {now}` |
| `VIEW_PACKAGE` / `PAYMENT_MODE` / `VIEW_COURSE`, with `packageId` resolved, **no plan** | `pkg` found | `View Package - {pkg.name} - {now}` |
| `VIEW_PACKAGE` / `PAYMENT_MODE` / `VIEW_COURSE`, with `packageId` resolved, **with plan** | `pkg` found | `Payment Mode - {pkg.name} - {plan.name} - {amount} - {now}` |
| `VIEW_PACKAGE` / `PAYMENT_MODE` / `VIEW_COURSE`, with `courseId` resolved, **no plan** | `course` found | `View Course - {course.name} - {educator.name + " - " if present} - {now}` |
| `VIEW_PACKAGE` / `PAYMENT_MODE` / `VIEW_COURSE`, with `courseId` resolved, **with plan** | `course` found | `Payment Mode - {course.name} - {plan.name} - {amount} - {now}` |
| `PAYMENT_SUCCESS` | `packageName` or `courseName` provided | `Payment Success - {packageName or courseName} - {plan.name} - {amount} - {now}` |
| `PAYMENT_FAILED` | — | not implemented |

`fields.application_course` is set alongside:
- package branch → `pkg.name`
- course branch → literal string `"Subject Wise Course"`
- `PAYMENT_SUCCESS` → `packageName` if present, else literal `"Subject Wise Course"`

`fields.amount` is only added to `payload.fields` when `amount` is truthy.

## Required env vars

| Var | Purpose |
|---|---|
| `NODE_ENV` | must equal `production` or nothing is sent |
| `TELE_CRM_BASE_URL` | TeleCRM lead-update endpoint (per-environment, see `.env*` files — value is a secret) |
| `TELE_CRM_ACCESS_TOKEN` | Bearer token for that endpoint (secret) |

## Known quirks to decide on when reimplementing

These exist in the current backend as-is; carrying them forward or fixing them is a design decision for the new backend, not an accident to silently reproduce:

1. **`leadType` doesn't fully control the message.** `VIEW_PACKAGE`, `PAYMENT_MODE`, and `VIEW_COURSE` all share one switch case. The actual text ("View Package…" vs "Payment Mode…") is decided by whether a `plan` was resolved from `planId`, not by which `leadType` was passed. E.g. a `VIEW_COURSE` call that happens to include a `planId` will produce a "Payment Mode" note.
2. **`PAYMENT_SUCCESS` can throw if `plan` is undefined.** It unconditionally reads `plan.name`, but `plan` is only set if `params.planId` was passed and resolved. If a payment-success call omits `planId`, this throws inside the `switch`, which is swallowed by the outer `try/catch` and logged as `[GenerateCRMLead] error: ...` — the lead silently never sends. Worth an explicit null-check in the new backend.
3. **Double production checks.** The gate at the top of the function (`return` if not production) already makes the second check before `sendToTeleCrm` redundant — only `!isTestingAccount` is doing real work there.
4. **`PAYMENT_FAILED` is a defined enum value with no producer.** No controller currently triggers it.
5. **Errors from the TeleCRM POST are fully swallowed** (logged only, never retried, never surfacing to the API caller or any dead-letter queue). If the new backend wants reliability guarantees (retry/backoff, alerting), that needs to be added — it doesn't exist today.

## Trigger checklist (all current call sites)

Use this list to make sure every existing trigger point is re-wired in the new backend — miss one and that lead type silently stops firing. Status below reflects the MySQL backend port (2026-09-15):

- [x] OTP login → `LOGIN` (only when customer already has `fullName` or `emailAddress`) — `src/client/auth/auth.service.ts` (`validateOtp`)
- [x] Profile completion → `SIGNUP` (only when both `firstName` and `emailAddress` present after update) — `src/client/profile/customer.controller.ts` (`updateProfileHandler`)
- [x] Package detail view → `VIEW_PACKAGE` — `src/client/package/package.controller.ts` (`getPackageDetail`)
- [x] Course detail view → `VIEW_COURSE` — `src/client/course/course.controller.ts` (`getCourseByIdHandler`)
- [x] Order creation (payment method chosen) → `PAYMENT_MODE` — `course-payment.controller.ts`, `package-payment.controller.ts`, `live-course-payment.controller.ts`, `test-series-payment.controller.ts`
- [x] Subscription activated after payment → `PAYMENT_SUCCESS` — `src/client/payment/verify.controller.ts` (course/package/live-course/test-series branches)
- [x] Payment failure → `PAYMENT_FAILED` — `src/client/payment/verify.controller.ts` (signature-mismatch branch). New in this backend; the old backend never wired a producer.
- [x] Live course detail view → `VIEW_LIVE_COURSE` (**new lead type, no old-backend equivalent**) — `src/client/live-course/live-course.controller.ts` (`getLiveCourseForClient`)
- [x] Test series detail view → `VIEW_TEST_SERIES` (**new lead type, no old-backend equivalent**) — `src/client/testSeries/testSeries.controller.ts` (`getTestSeriesDetail`)

## Notes for future changes

- Any new "moment" that should notify TeleCRM just needs a new `CRM_LEAD_TYPE` entry, a `case` in the `GenerateCRMLead` switch, and a fire-and-forget call from the relevant controller.
- Because the whole function short-circuits outside `NODE_ENV=production`, testing this integration requires either a production-like env or a temporary local override.
