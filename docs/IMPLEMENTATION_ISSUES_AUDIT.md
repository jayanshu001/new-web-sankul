# New Web Sankul — Implementation and Logic Issues Audit

Audit date: 2026-07-01

Scope: Correctness, traceability, debugging quality, security footguns, and production incident response in `new-web-sankul` application code.

Related documents:

- [Scalability and API Optimization Audit](./SCALABILITY_OPTIMIZATION_AUDIT.md) — performance, hot paths, queues, sockets
- [Deployment and Operations Audit](./DEPLOYMENT_OPERATIONS_AUDIT.md) — PM2, Docker, build, env, infrastructure

Migration context: MySQL/Prisma-only runtime (`isMongoFallbackEnabled() === false`). See `docs/migration/legacy_system_migration_strategy.md`.

---

## Executive Summary

These issues are separate from pure scalability concerns. They affect whether production errors are traceable, whether webhooks fulfill payments reliably, whether auth behaves as documented, and whether clients receive safe error responses.

Highest priority:

- Payment webhook verifies signature on re-serialized JSON, not raw body.
- Many controllers bypass the central error handler and may leak internal messages.
- Public `/firebase-token` endpoint allows token overwrite by phone number.
- Optional-auth routes block requests with stale tokens.
- MongoDB-era artifacts (`db.ts`, `secondaryRead.ts`, health probes) cause observability drift.

---

## Resolution Status — updated 2026-07-01

Re-audited against current code and remediated. Summary:

| ID | Issue | Status | What changed |
|----|-------|--------|--------------|
| I0.1 | Webhook verifies re-serialized JSON | ✅ Fixed | `webhook.controller.ts` now verifies against `req.rawBody` buffer (falls back to `JSON.stringify` only if absent) + logs event/orderId on mismatch. |
| I0.2 | `/readyz` `/health` probe Mongo | ✅ Fixed | Readiness already dropped the Mongo probe; added a real MySQL `SELECT 1` (Prisma) check + Redis, and corrected stale "Pings Mongo" comments in `health.ts`. |
| I1.1 | Uneven logging/trace coverage | ◑ Improved | Payout webhook now fully logged (see I1.3); broader logging standard remains a gradual effort. |
| I1.2 | Handlers leak internal error messages | ✅ Fixed | All 35 client-controller `failure(res, getErrorMessage(err), 500)` sites now return a generic message; the real error is still logged server-side. (`asyncHandler` adoption remains a future refactor.) |
| I1.3 | Payout webhook weak observability | ✅ Fixed | Structured logs on every branch (secret/rawbody/signature/ignored/unknown/already/applied/error); catch now returns generic 500 (no `error.message` leak). |
| I1.4 | "Optional" auth blocks stale tokens | ✅ Fixed | Added `optionalAuthenticate` middleware; `tracking` + `offline/enquiry` routes use it (invalid token → continue anonymously). |
| I1.5 | Public `/firebase-token` abuse | ✅ Fixed | Route now requires `authenticate`; handler binds to `req.user.phone` (JWT) and ignores any body `phoneNumber`. |
| I1.6 | Completion-log route normalization | ○ Not changed | Low severity; the completion log already merges `route` from request context. Left as-is. |
| I1.7 | MongoDB-era artifacts | ✅ Resolved (prior work) | `db.ts`, `secondaryRead.ts`, `src/models/` deleted; `mongoose` removed from `package.json`; zero `import mongoose` in `src`. |
| I1.8 | OTP not constant-time / limiter off | ✅ Fixed | OTP compared with `crypto.timingSafeEqual`; `otpLimiter` re-enabled on `/otp/generate` + `/otp/resend`. |

Legend: ✅ fixed · ◑ partially addressed · ○ deferred (low severity).

---

## Priority 0 — Must Fix Before Production

### I0.1 Payment Webhook Signature Verification Uses Re-Serialized JSON

Evidence:

- `src/client/webhook/webhook.controller.ts:29` — `const rawBody = JSON.stringify(req.body)`.
- `src/app.ts:189–192` stores `(req as any).rawBody` in the JSON parser verify hook.
- `src/webhooks/razorpay-payout.controller.ts:22–28` correctly verifies against `rawBody` buffer.

Impact:

- Razorpay signs the raw request payload. Re-serializing JSON can change whitespace or key order.
- Valid webhooks may fail signature verification; payment fulfillment depends on client `/payment/verify` fallback.

Recommendations:

**Step 1 — Use raw body for verification:**

```typescript
const rawBody = (req as any).rawBody as Buffer;
if (!rawBody || !signature || !verifySignature(rawBody.toString("utf8"), signature)) {
  return res.status(400).json({ success: false, message: "Invalid signature" });
}
```

**Step 2 — Add logs for signature mismatch** (event, order id, trace id — no payload/secret).

**Step 3 — Add webhook replay/idempotency tests** with real raw payload fixtures.

---

### I0.2 `/readyz` and `/health` Still Probe MongoDB (Code Fix Required)

Evidence:

- `src/middlewares/health.ts:78–99` — readiness checks Mongoose, not Prisma.
- `src/index.ts:58` — only `connectPrisma()` runs at boot.

Impact:

- `/readyz` returns 503 permanently in MySQL-only mode.
- `/health` always reports `mongoDB: "disconnected"`.

> Full fix steps and staging smoke test are in [Scalability Audit § P0.1](./SCALABILITY_OPTIMIZATION_AUDIT.md#p01-readyz-still-probes-mongodb-instead-of-mysql).

---

## Priority 1 — High Impact Logic Issues

### I1.1 Logging and Trace Coverage Is Uneven Across the Codebase

Evidence:

- Strong global request logging via `src/utils/requestLogger.ts`, but inconsistent service-boundary logging.
- `src/webhooks/razorpay-payout.controller.ts` has minimal structured logging on key branches.

Impact:

- During incidents, request logs may show endpoint failure without internal branch/provider context.
- Async flows (notification dispatch, payment verification, webhook fulfillment) are harder to trace end-to-end.

Recommendations:

**Step 1 — Define a logging standard:** `invoked`, validation decisions, side-effect success, failure — with `traceId`, `userId`, `entityId`, `operation`, `durationMs`.

**Step 2 — Add service-level logs** around DB writes, queue ops, payment transitions, FCM sends, S3 operations.

**Step 3 — Keep payloads scrubbed;** avoid logging full bodies on success paths.

---

### I1.2 Many Handlers Bypass the Central Error Handler

Evidence:

- Controllers catch errors and return `failure(res, getErrorMessage(err), 500)` — e.g. `customer.controller.ts:160`, promoter/search/referral controllers.
- `src/middlewares/errorHandler.ts` centralizes structured logging and throttled 5xx email alerts, but manual catches bypass it.

Impact:

- Inconsistent 5xx handling; some errors skip central email alerts.
- Internal exception messages can leak to clients.

Recommendations:

**Step 1 — Introduce `asyncHandler` wrapper** and let thrown errors reach `errorHandler`.

**Step 2 — Use `HttpError` for expected 4xx;** reserve 500 for unexpected failures with generic client message.

**Step 3 — Standardize error response shape** across controllers.

---

### I1.3 Payout Webhook Has Weak Observability

Evidence:

- `src/webhooks/razorpay-payout.controller.ts` — limited structured logging on branches.
- Returns `500` with `error.message` in catch block.

Impact:

- Payout/referral money movement is harder to audit.
- Raw error messages can leak implementation details.

Recommendations:

**Step 1 — Add logger coverage** to every branch: missing secret, invalid signature, ignored id, success, refund failure.

**Step 2 — Include `traceId`, `event`, `providerRef`, `transactionId`, `customerId`, status transitions.

**Step 3 — Route unexpected errors** through central error handler; return generic 500 to client.

---

### I1.4 Optional Authentication Middleware Is Not Actually Optional for Invalid Tokens

Evidence:

- Best-effort auth patterns in tracking/offline enquiry routes call `authenticate()` when Authorization header exists.
- `authenticate()` sends 401 for invalid/expired tokens instead of continuing anonymously.

Impact:

- Public requests with stale mobile tokens fail unexpectedly.
- Implementation does not match route comments.

Recommendations:

**Step 1 — Create `optionalAuthenticate` middleware** that attaches `req.user` when valid and silently continues when missing or invalid.

**Step 2 — Use strict `authenticate` only** where invalid tokens should block.

---

### I1.5 Public Firebase Token Update Can Be Abused

Evidence:

- `src/client/profile/customer.routes.ts:63` — `PATCH /firebase-token` is public.
- `updateFirebaseTokenHandler` updates by `phoneNumber` without authenticated user context.
- Safer authenticated endpoint exists: `PUT /device-token`.

Impact:

- Anyone who knows a phone number could overwrite push tokens.
- Notification delivery can be poisoned or misdirected.

Recommendations:

**Step 1 — Deprecate phone-number based public endpoint;** require authenticated `/device-token` after login.

**Step 2 — If public sync is required,** gate with short-lived post-OTP proof token.

**Step 3 — Add rate limiting and audit logs** for any public token-sync endpoint.

---

### I1.6 Request Route Context May Not Be Present in Completion Logs

Evidence:

- `src/app.ts` mounts `requestLogger` before `requestContextMiddleware`.
- Completion log listener can run before route normalization on `finish`.

Impact:

- Completed request logs may contain `url` but not normalized route template.
- Aggregating logs by route is noisier.

Recommendations:

**Step 1 — Capture normalized route inside `requestLogger`** before writing completion log.

**Step 2 — Align log `route` field with metrics route normalization.**

---

### I1.7 MongoDB-Era Artifacts Cause Observability Drift

Evidence:

- `src/config/db.ts` — Mongoose connection + timing plugin; never imported at runtime.
- `src/libs/secondaryRead.ts` — Mongoose replica helper; zero call sites.
- `src/models/*.model.ts` — ~100+ legacy Mongoose models still compiled.
- `package.json:81` — `mongoose` dependency retained.
- Controllers still `import mongoose` for `ObjectId.isValid()` in several files.

Impact:

- `dbMs` in request context is never incremented for Prisma queries.
- Dead code increases build size and confuses operators.
- Risk of accidental Mongo code paths if fallback is re-enabled.

Recommendations:

**Step 1 — Fix health probes** to use Prisma (see I0.2 / Scalability Audit P0.1).

**Step 2 — Add Prisma `$use` middleware** for query timing → `incrementContext("dbMs", elapsed)`.

**Step 3 — Replace `mongoose.Types.ObjectId.isValid()`** with a shared `isValidId()` utility.

**Step 4 — Archive or delete unused `src/models/`** after confirming zero runtime imports.

**Step 5 — Remove `mongoose` from `package.json`** once all references are gone.

---

### I1.8 OTP Validation Is Not Constant-Time

Evidence:

- `auth.service.ts` uses plain string comparison for OTP (`row.otp !== otp`).

Impact:

- Timing side-channel on short numeric OTP (rate limits are the primary defense; both OTP IP limiter and this are currently weakened).

Recommendations:

**Step 1 — Use `crypto.timingSafeEqual`** on fixed-length buffers.

**Step 2 — Re-enable `otpLimiter`** (see Scalability Audit P0.4).

**Step 3 — Add phone-number based Redis throttling** in `auth.service.ts`.

---

## Suggested Fix Plan

### Phase 1 — Before Production (blockers)

| Step | Action | Files | Status |
|------|--------|-------|--------|
| 1.1 | Fix payment webhook raw body verification | `src/client/webhook/webhook.controller.ts` | ✅ Done |
| 1.2 | Fix `/readyz` MySQL probe | `src/middlewares/health.ts` | ✅ Done |
| 1.3 | Re-enable OTP limiter + timing-safe compare | `auth.routes.ts`, `auth.service.ts` | ✅ Done |
| 1.4 | Secure or deprecate public `/firebase-token` | `customer.routes.ts`, `customer.controller.ts` | ✅ Done |

### Phase 2 — Hardening

| Step | Action | Status |
|------|--------|--------|
| 2.1 | Introduce `asyncHandler`; route errors through `errorHandler` | ◑ `asyncHandler` exists + used in admin; client 500s now return generic messages (full refactor pending) |
| 2.2 | Add structured logs to payout webhook branches | ✅ Done |
| 2.3 | Implement `optionalAuthenticate` for best-effort routes | ✅ Done |
| 2.4 | Fix request completion log route normalization | ○ Deferred (low severity) |
| 2.5 | Add Prisma query timing middleware for `dbMs` | ○ Deferred |

### Phase 3 — Cleanup

| Step | Action | Status |
|------|--------|--------|
| 3.1 | Remove `db.ts`, `secondaryRead.ts`, unused Mongoose models | ✅ Done (prior Mongo-removal) |
| 3.2 | Remove `mongoose` dependency | ✅ Done (prior Mongo-removal) |
| 3.3 | Standardize logging standard across services | ◑ Ongoing |

---

## Document History

| Date | Version | Notes |
|------|---------|-------|
| 2026-07-01 | 1.0 | Split from `SCALABILITY_OPTIMIZATION_AUDIT.md` |
| 2026-07-01 | 1.1 | Re-audited against current code + remediated: I0.1, I0.2, I1.2, I1.3, I1.4, I1.5, I1.8 fixed; I1.7 already resolved (Mongo removed); I1.1 improved; I1.6 deferred. See Resolution Status. |
