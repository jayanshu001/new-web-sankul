# Backend Audit — Batch 4: Cleanup follow-ups (JWT keyring, token revocation, outbound migration)

Closes out the open follow-ups from Batches 2 & 3:

- **C1.** Finishes the JWT keyring migration started in Batch 3 — admin / educator / promoter auth services + both socket handlers now sign and verify through the keyring.
- **C2.** Adds a refresh-token revocation list (revoke-by-cutoff design) and `logout-all-devices` endpoints across all 4 auth surfaces.
- **C3.** Wraps the remaining outbound callsites in `callOutbound` — IFSC lookup, RazorpayX payouts, VideoCrypt resolver, S3 deletes, FCM push.

After this batch, **the only top-level audit modules with significant work remaining are 12 (Testing/CI), 13 (Scalability), and the Module 9 logger augmentation deferral**.

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/libs/tokenRevocation.ts](../../src/libs/tokenRevocation.ts) | Revoke-by-cutoff: per-user timestamp in Redis; tokens with `iat * 1000 < cutoff` are rejected by `authenticate`. |
| [src/middlewares/logoutAllDevices.ts](../../src/middlewares/logoutAllDevices.ts) | Factory producing a `logout-all-devices` handler for any user type; one source of truth for the revocation contract. |

### Modified
| File | Change |
|---|---|
| [src/admin/auth/admin.auth.service.ts](../../src/admin/auth/admin.auth.service.ts) | 5 `jwt.sign` / `jwt.verify` callsites → keyring (`signAccessToken` / `signRefreshToken` / `verifyRefreshToken`). |
| [src/educator/auth/educator.auth.service.ts](../../src/educator/auth/educator.auth.service.ts) | Same migration. |
| [src/promoter/auth/promoter.auth.service.ts](../../src/promoter/auth/promoter.auth.service.ts) | Same migration. |
| [src/socket/livechat.socket.ts](../../src/socket/livechat.socket.ts) | `jwt.verify` → `verifyAccessToken`. |
| [src/socket/camera-ingest.ts](../../src/socket/camera-ingest.ts) | `jwt.verify` → `verifyAccessToken`. |
| [src/middlewares/authenticate.ts](../../src/middlewares/authenticate.ts) | Reads token `iat` + checks `isRevoked(type, userId, iat)` before letting the request through. |
| [src/admin/auth/admin.auth.routes.ts](../../src/admin/auth/admin.auth.routes.ts) | New `POST /logout-all-devices`. |
| [src/educator/auth/educator.auth.routes.ts](../../src/educator/auth/educator.auth.routes.ts) | Same. |
| [src/promoter/auth/promoter.auth.routes.ts](../../src/promoter/auth/promoter.auth.routes.ts) | Same. |
| [src/client/auth/auth.routes.ts](../../src/client/auth/auth.routes.ts) | Same. |
| [src/client/referral/ifsc.ts](../../src/client/referral/ifsc.ts) | Razorpay IFSC lookup → `callOutbound`. |
| [src/client/payment/razorpayx.ts](../../src/client/payment/razorpayx.ts) | All RazorpayX `xPost` calls → `callOutbound` (path-scoped label). |
| [src/utils/videoResolver.ts](../../src/utils/videoResolver.ts) | VideoCrypt resolve `axios.post` → `callOutbound`. |
| [src/middlewares/upload.ts](../../src/middlewares/upload.ts) | `deleteFromS3FileUrl` send wrapped in `callOutbound`. |
| [src/utils/fcm.ts](../../src/utils/fcm.ts) | `messaging.sendEachForMulticast` per-batch → `callOutbound`. |

---

## C1 — JWT keyring migration (completion)

Batch 3 landed the keyring infrastructure and migrated **customer auth only**. The remaining auth surfaces kept calling `jwt.sign(payload, JWT_SECRET)` directly — functionally correct (the keyring's legacy secret == `JWT_ACCESS_SECRET`), but those mints lacked the `kid` header. A rotation step (`JWT_ACCESS_KEYS=v2:<new>,v1:<old>` with `JWT_ACCESS_CURRENT_KID=v2`) would silently downgrade admin/educator/promoter tokens to legacy verification, defeating the purpose of rotation for them.

This batch fixes that:

- **5 callsites in each** of admin, educator, promoter auth services — login sign × 2, refresh verify, refresh sign × 2.
- **2 socket handlers** — `livechat.socket.ts` (`authenticateSocket`) and `camera-ingest.ts` (`verifyAdminToken`).
- All now use `signAccessToken` / `verifyAccessToken` / `signRefreshToken` / `verifyRefreshToken`, which embed/read the `kid` header.

The unused `JWT_SECRET` / `JWT_REFRESH_SECRET` constants are removed; the env vars themselves stay in place (they're now the keyring's `legacySecret`).

### Impact
- **Security:** key rotation now genuinely works end-to-end. The playbook documented in [batch-3-resilience-jwt.md](./batch-3-resilience-jwt.md) applies uniformly to every JWT-issuing surface.
- **No behavior change** for existing tokens. Legacy tokens (no `kid`) still verify against the ring's `legacySecret`, which equals the existing `JWT_ACCESS_SECRET`.

---

## C2 — Refresh-token revocation list

### Why this matters

Before this batch the only way to "log out" was the existing single-device session pointer (`{type}_session:{userId}` in Redis). If an admin's laptop was stolen and they wanted to invalidate every outstanding token, the only option was to wait for the JWT TTL to expire (1 day for admin access, 30 days for admin refresh). That window is unacceptable.

### Design — revoke by cutoff (not jti)

Stored as `revoke:{type}:{userId}` → unix millis. The `authenticate` middleware reads this on every request and rejects any token whose `iat * 1000 < cutoff`. Properties:

- **No token format change.** `iat` is already on every JWT (jsonwebtoken auto-includes it).
- **One Redis GET per request.** Most users have no key → fail-open fast path.
- **Coarse on purpose.** "Logout all devices" / "password change" should invalidate everything. For single-device logout the existing session-pointer check stays in place; both fire independently.
- **Bounded TTL.** Cutoff key expires after 60 days (the longest refresh TTL in the system) — by which time every token issued before the cutoff has expired anyway.

### `authenticate` middleware diff
```ts
const userType = (decoded.type ?? "customer") as UserType;
if (await isRevoked(userType, decoded.id, decoded.iat)) {
  return failure(res, "Session was revoked. Please log in again.", 401);
}
```

Placed AFTER `verifyAccessToken` and BEFORE the single-device pointer check, so a revoked token is rejected even if the user has a fresh device-pointer entry.

### `logout-all-devices` endpoints

Single handler factory ([logoutAllDevices.ts](../../src/middlewares/logoutAllDevices.ts)) consumed by all 4 auth surfaces:

| Surface | Route | Cleanup |
|---|---|---|
| Customer | `POST /api/v1/client/auth/logout-all-devices` | `CustomerAccessToken.updateMany({active:true}, {active:false})` |
| Admin | `POST /api/v1/admin/auth/logout-all-devices` | `AdminAccessToken.updateMany(...)` |
| Educator | `POST /api/v1/educator/auth/logout-all-devices` | `EducatorAccessToken.updateMany(...)` |
| Promoter | `POST /api/v1/promoter/auth/logout-all-devices` | `PromoterAccessToken.updateMany(...)` |

Each endpoint:
1. Sets the per-user cutoff in Redis (`revoke:{type}:{userId} = Date.now()`).
2. Deletes the single-device session pointer (`{type}_session:{userId}`).
3. Flags every active access-token row in the per-type DB collection as inactive (so refresh attempts ALSO fail at the DB layer, not just Redis).

Step 3 is `extraTeardown` — the factory itself is type-agnostic.

### Fail-open behavior

If Redis is unreachable when `logout-all-devices` runs, the cutoff write fails. The handler still returns 200 (the client should discard its token locally regardless), and we log a warn. The DB-layer cleanup in step 3 still runs, so the refresh-token path is still blocked even when the cutoff isn't set.

### Verification

```bash
# 1. Log in as a user, get a token T.
# 2. Hit a protected endpoint with T — succeeds.
curl -s -H "Authorization: Bearer $T" localhost:5000/api/v1/admin/courses | jq .success
# true

# 3. Logout-all-devices with T.
curl -s -X POST -H "Authorization: Bearer $T" localhost:5000/api/v1/admin/auth/logout-all-devices
# { "success": true, "message": "Logged out from all devices." }

# 4. Re-hit the protected endpoint with T — now 401.
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $T" localhost:5000/api/v1/admin/courses
# 401

# Redis state
redis-cli GET revoke:admin:$ADMIN_ID
# (a unix millis timestamp)
```

---

## C3 — Outbound migration (remaining callsites)

Each of these had hand-rolled (or zero) timeout / no retry / no breaker. Now they share the central `callOutbound` plumbing with the SMS/email/Razorpay calls from Batch 3.

| Callsite | Label | Timeout | Attempts | Notes |
|---|---|---|---|---|
| `ifsc.lookupIfsc` | `ifsc.razorpay` | 4s | 2 | 404 → `null` (legitimate "no such IFSC"); does not count toward breaker. |
| `razorpayx.xPost` | `razorpayx{path}` | 6s | 3 | Path-scoped breaker — a payout outage doesn't open the breaker for contact/fund-account creates. |
| `videoResolver.resolveAws` (VideoCrypt POST) | `videocrypt.resolve` | 15s | 3 | Lecture URLs are cached 24h downstream, so a transient blip is invisible to users with warm cache. |
| `upload.deleteFromS3FileUrl` | `s3.delete` | 5s | 2 | Lazy-imported to avoid bootstrap circular import. Best-effort caller already swallows exceptions. |
| `fcm.sendEachForMulticast` | `fcm.sendMulticast` | 10s | 3 | Per-device invalid-token errors live inside successful responses; retries don't help those (correctly). |

### Why this matters

Before this migration, a VideoCrypt outage would freeze each lecture request for 15s (the only timeout). Multiply by hundreds of concurrent viewers and the Node event loop saturates. With `callOutbound`, the 5th consecutive failure opens the breaker; subsequent calls fail in <1ms with `CircuitOpenError`. The dependent endpoint can return a clean 503 instead of dragging the whole process down.

---

## Module status after Batch 4

| Module | Status |
|---|---|
| 1. API & Routing | ✅ Done |
| 2. Controllers | ✅ Done for 6 priority domains |
| 3. Services | ✅ Done for 6 priority domains |
| 4. Database | ✅ Mostly done (TTL/strict throw outstanding) |
| 5. Redis Caching | ✅ Done |
| 6. Queues | ✅ Done for the one queue; SLA-tiered queues deferred until more job types exist |
| 7. Auth & Security | ✅ Done — keyring everywhere, revocation list landed, OTP timing fix, env validation, CORS hardening |
| 8. Video Delivery | ✅ Done (no drift) |
| 9. Observability | ⚠️ RED metrics + PII scrubbing done; AsyncLocalStorage + pino migration deferred |
| 10. Performance | ✅ Mostly done; event-loop profiling deferred |
| 11. Resilience | ✅ Done — healthz/readyz, graceful shutdown, outbound wrapper, ALL named callsites migrated |
| 12. Testing & CI | ⏸️ Not started |
| 13. Scalability | ⏸️ Not started |

---

## Constraint compliance

- ✅ No public API response shape changes.
- ✅ Every authenticated route still requires Bearer token.
- ✅ Video URL contract untouched.
- ✅ Plan duration / `setMonth` semantics untouched.
- ✅ Downloads composition untouched.
- ⚠️ **New endpoints:** `POST /api/v1/{client,admin,educator,promoter}/auth/logout-all-devices`. Clients can ignore them until ready to surface a UI button; existing single-device logout still works.
- ⚠️ **Behavior change:** `authenticate` now does one extra Redis GET per request (the revocation cutoff check). The key only exists for users who've recently invoked logout-all-devices, so the hot-path cost is `GET → nil` (sub-ms).

---

## What's left

**Module 9 (deferred from Batches 2–3):**
- AsyncLocalStorage request context (`requestId`, `userId`, `route`, `latencyMs`, `dbMs`, `cacheHit` auto-injected into every log line).
- Mongoose middleware to capture `dbMs` per request.
- Winston → pino migration (~5x throughput, structured by default).
- OpenTelemetry traces (HTTP → Mongo → Redis → queue producer/consumer).

**Module 12 — Testing & CI:** Needs your CI provider context (GitHub Actions / GitLab CI / something else?). Plus test framework choice (Jest / Vitest), and the Testcontainers setup for Mongo + Redis.

**Module 13 — Scalability:** Needs concrete production capacity numbers (current peak RPS, concurrent live sessions, storage growth/month). Without those, planning shard keys and HPA thresholds is guesswork.

**Module 4 follow-ups:**
- `strict: "throw"` on schemas (catches silent field drops).
- TTL indexes on OTP / signed-URL / ephemeral session collections.
- Cursor-based pagination on the high-cardinality collections (test-series, video-watch events).

**Module 6 follow-up:**
- Separate queues by SLA (`realtime` / `default` / `bulk` / `low-priority`) — preemptive scaffolding for when more job types arrive beyond `notification-scheduler`.
