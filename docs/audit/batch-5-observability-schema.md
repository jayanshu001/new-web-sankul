# Backend Audit — Batch 5: Observability completion + Schema hardening

Closes out the Module 9 deferrals from Batch 2 and lands the Module 4 schema-hardening follow-ups. No public endpoints change; this is pure infrastructure work.

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/utils/requestContext.ts](../../src/utils/requestContext.ts) | AsyncLocalStorage store for per-request `{ traceId, userId, userRole, route, dbMs, cacheHit, cacheMiss }`. |
| [src/middlewares/requestContext.ts](../../src/middlewares/requestContext.ts) | Opens the AsyncLocalStorage scope once per request; captures matched route template at `res.on('finish')`. |

### Modified
| File | Change |
|---|---|
| [src/utils/logger.ts](../../src/utils/logger.ts) | New `requestContextFormat` merges traceId/userId/userRole/route from the AsyncLocalStorage context into every log record. Applied to both file and console transports. |
| [src/app.ts](../../src/app.ts) | Mounts `requestContextMiddleware` right after `requestLogger`. |
| [src/middlewares/authenticate.ts](../../src/middlewares/authenticate.ts) | After JWT verify, calls `updateContext({ userId, userRole })` so every downstream log line carries the authenticated identity. |
| [src/config/db.ts](../../src/config/db.ts) | Global Mongoose plugin registers pre/post hooks on every query / aggregate / save op; accumulates elapsed ms into `dbMs` on the request context. |
| [src/libs/cache.ts](../../src/libs/cache.ts) | `aside()` now also increments `cacheHit` / `cacheMiss` counters on the request context (in addition to the existing Prometheus counters). |
| [src/utils/requestLogger.ts](../../src/utils/requestLogger.ts) | "API Request Completed" log line emits `dbMs`, `cacheHit`, `cacheMiss`, `durationMs` from the context — every request now self-describes its time budget. |
| [src/models/customer/CustomerOtp.model.ts](../../src/models/customer/CustomerOtp.model.ts) | TTL index on `createdAt`, `expireAfterSeconds: 600`. |
| [src/models/referral/ReferralTransaction.model.ts](../../src/models/referral/ReferralTransaction.model.ts) | `strict: "throw"`. |
| [src/models/customer/PackageCourseSubscription.model.ts](../../src/models/customer/PackageCourseSubscription.model.ts) | `strict: "throw"`. |
| [src/models/ebook/EbookSubscription.model.ts](../../src/models/ebook/EbookSubscription.model.ts) | `strict: "throw"`. |
| [src/models/customer/LiveCourseSubscription.model.ts](../../src/models/customer/LiveCourseSubscription.model.ts) | `strict: "throw"`. |

### Endpoints affected
**None.** Both Module 9 and Module 4 work here are invisible to external callers. Behavior changes:

- Every log line now carries `traceId`, `userId`, `userRole`, `route` automatically.
- The "API Request Completed" log line includes `dbMs`, `cacheHit`, `cacheMiss`.
- OTP rows older than 10 minutes auto-delete (was: accumulated forever, ~5 MB / 100k logins).
- The 4 financial-ledger collections now reject `Model.create(...)` / `Model.updateOne(..., $set: {...})` calls that include unknown fields. **This will surface latent bugs** as 500s rather than silent drops — by design.

---

## Module 9 — Observability (completion)

### Issue (P1, Batch 2 deferral)
Every log line up to now had to manually receive `traceId` from the caller. Most callsites passed it; many didn't. There was no way to attribute a log line to a userId, route, dbMs, or cacheHit count without threading those values through every function signature.

### Design — AsyncLocalStorage request context

AsyncLocalStorage is the canonical Node 14+ pattern for per-request context. It survives `await`, `Promise.all`, `setImmediate`, `setTimeout` — every async hop within the same request keeps the same store reference. Cost: <1µs per `getStore()` call, well below the noise floor for an HTTP handler.

The store carries six fields:
- `traceId` — set by `requestContextMiddleware` from `req.traceId`
- `userId`, `userRole` — set by `authenticate` after JWT verify
- `route` — set at `res.on('finish')` from `req.route.path` (the template, not the literal URL)
- `dbMs` — accumulated by a global Mongoose plugin in `config/db.ts`
- `cacheHit`, `cacheMiss` — incremented by `libs/cache.ts` on every aside() call

The logger reads these via a Winston format. Callers that already pass `{ traceId }` explicitly continue to work — explicit fields take precedence over context fields, so no caller breaks.

### How dbMs is captured

A global Mongoose plugin registered in `config/db.ts` before any model is compiled:

```ts
mongoose.plugin((schema) => {
  for (const op of QUERY_OPS) {
    schema.pre(op, function () { this.__startedAt = process.hrtime.bigint(); });
    schema.post(op, function () {
      const elapsed = Number(process.hrtime.bigint() - this.__startedAt) / 1_000_000;
      incrementContext("dbMs", elapsed);
    });
  }
  // Same pattern for "aggregate" and "save".
});
```

QUERY_OPS covers find, findOne, findOneAndUpdate/Delete/Replace, count, countDocuments, estimatedDocumentCount, update, updateOne, updateMany, deleteOne, deleteMany, distinct. Aggregations and saves get their own pair.

Outside a request scope (BullMQ worker, scripts, tests), `incrementContext` is a no-op — the plugin has zero effect.

### Sample log line (after this batch)

```json
{
  "level": "info",
  "message": "API Request Completed",
  "timestamp": "2026-03-15T10:23:11.428Z",
  "traceId": "9a02f9c2-...",
  "userId": "65f8ad21d44b8e0012345678",
  "userRole": "admin",
  "route": "/api/v1/admin/courses/:id",
  "method": "GET",
  "url": "/api/v1/admin/courses/65f9ce1a...",
  "ip": "10.0.4.221",
  "statusCode": 200,
  "responseTime": "47.18ms",
  "durationMs": 47.18,
  "dbMs": 31.04,
  "cacheHit": 1,
  "cacheMiss": 0,
  "body": null
}
```

You can now answer:
- "Where did the time go on this slow request?" → `dbMs` vs `durationMs - dbMs`.
- "Why is this endpoint slow under load?" → `cacheHit / (cacheHit + cacheMiss)` ratio.
- "Who triggered this 500?" → `userId` + `traceId` thread through every log line in that request, including from inside services.

### Verification

```bash
# Hit a cached endpoint twice. First request misses cache, second hits.
curl -s "http://localhost:5000/api/v1/admin/courses" -H "Authorization: Bearer $T" >/dev/null
curl -s "http://localhost:5000/api/v1/admin/courses" -H "Authorization: Bearer $T" >/dev/null

# Tail the log: second request should show cacheHit=1, cacheMiss=0, dbMs≈0
tail -n 1 logs/app-$(date +%Y-%m-%d).log | jq '{route, dbMs, cacheHit, cacheMiss, durationMs}'
```

---

## Module 4 — Schema hardening

### 4a. TTL on CustomerOtp

OTP rows were never deleted. At ~100k OTP-generating logins per month with no cleanup, the `ws_customer_otps` collection grows unbounded — measurable storage cost over time, and the index on `customerId` grows accordingly slow.

**Fix:** TTL index on `createdAt` with `expireAfterSeconds: 600` (10 minutes). Mongo's TTL monitor deletes expired rows once per minute. OTP service validity is 5 minutes; the extra 5-minute buffer keeps audit trail of the most recent OTP without permanent retention.

### 4b. strict: "throw" on financial-ledger schemas

Mongoose's default `strict: true` silently drops unknown fields on write. For most schemas that's fine — it's why schemas exist. But for **entitlement and money-trail rows**, a typo like `endsAt: someDate` (instead of `endAt`) means the customer's subscription silently has `endAt: null` and the entitlement immediately expires. The bug is invisible in dev (you'd have to specifically check), and you only find it via support tickets days later.

Switched 4 schemas to `strict: "throw"`:
- `ReferralTransaction` — coin / status / providerRef can't be silently misnamed; a wrong field = lost financial state.
- `PackageCourseSubscription` — `endAt` typo = customer can't access their paid course.
- `EbookSubscription` — same.
- `LiveCourseSubscription` — also covers the originalAmount / discountAmount / paidAmount money trail.

**Not** applied to:
- Catalog schemas (Course, Package, Ebook, Goal) — they have legacy fields and historical data with mixed types. `strict: "throw"` here would crash existing valid writes.
- Order schemas (BookOrder, EbookOrder, TestSeriesOrder) — out of scope this turn; the audit's "highest-risk financial rows" are the entitlements, not the orders, because orders complete in one webhook then never mutate again.

### Migration risk

`strict: "throw"` is a runtime check; it has no effect on existing documents. Only NEW writes that pass an unknown field will throw. If any current code path is silently relying on a misnamed field, this batch will surface it as a 500. **This is the desired outcome** per the audit — the bug was already there, this just makes it visible.

### Verification

```bash
# OTP TTL is live
mongosh "$MONGO_URI" --eval 'db.ws_customer_otps.getIndexes()'
# Expect an entry: { key: { createdAt: 1 }, expireAfterSeconds: 600, ... }

# strict:"throw" — confirm Mongoose rejects unknown fields
node -e "
const { ReferralTransaction } = require('./dist/models/referral/ReferralTransaction.model');
ReferralTransaction.create({ customerId: 'x', coin: 10, typoField: 'oops' })
  .catch(err => console.log('rejected:', err.message));
"
# Expect: rejected: Field \`typoField\` is not in schema and strict mode is set to throw.
```

---

## Module status after Batch 5

| Module | Status |
|---|---|
| 1. API & Routing | ✅ Done |
| 2. Controllers | ✅ Done for 6 priority domains |
| 3. Services | ✅ Done for 6 priority domains |
| 4. Database | ✅ Mostly done (TTL on OTP + strict:throw on 4 ledgers landed; cursor pagination still outstanding) |
| 5. Redis Caching | ✅ Done |
| 6. Queues | ✅ Done for the one queue |
| 7. Auth & Security | ✅ Done |
| 8. Video Delivery | ✅ Done |
| 9. Observability | ✅ Done (AsyncLocalStorage + dbMs + cacheHit; pino / OTel still optional) |
| 10. Performance | ✅ Mostly done |
| 11. Resilience | ✅ Done |
| 12. Testing & CI | ⏸️ Awaiting CI provider + framework choice |
| 13. Scalability | ⏸️ Awaiting production capacity numbers |

---

## Constraint compliance

- ✅ No public API response shape changes.
- ✅ Every authenticated route still requires Bearer token.
- ✅ Video URL contract untouched.
- ✅ Plan duration / `setMonth` semantics untouched.
- ✅ Downloads composition untouched.
- ⚠️ **New behavior**: writes to the 4 financial-ledger schemas now throw on unknown fields. Existing reads + existing documents are unaffected. If any caller is silently relying on a misnamed field, that callsite will start returning 500 — and that's a real bug worth fixing.

---

## What's still open

**Module 9 — optional further work**
- Winston → pino migration (~5x faster, structured by default). Touches every log call indirectly; needs careful field-shape preservation. Worth a dedicated turn.
- OpenTelemetry traces. Requires choosing a tracing backend (Jaeger / Tempo / Honeycomb).

**Module 4 — optional further work**
- Cursor-based pagination on high-cardinality collections (LiveSessionAttendance, ReferralTransaction). Skip/limit pagination is fine up to ~1k pages; beyond that the count query gets expensive.

**Module 6 — preemptive scaffolding**
- SLA-tiered queues (realtime / default / bulk / low-priority). Only `notification-scheduler` exists today, so this is design-ahead work.

**Modules 12 (Testing & CI) and 13 (Scalability)** — still need external context (CI provider, framework choice, production capacity numbers) before I can plan them well.
