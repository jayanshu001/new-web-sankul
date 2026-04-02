# API Caching Policy (new-web-sankul)

This file documents caching rules, endpoints, cache keys, and invalidation behaviors. Update this file whenever a new cacheable API is implemented or the caching strategy changes.

## 1. Redis setup
- `src/config/redis.ts` provides a singleton `redisClient` using `ioredis`.
- Redis must be reachable at `REDIS_HOST` / `REDIS_PORT` and optional `REDIS_PASSWORD`.

## 2. Current Cacheable APIs

### 2.1 GET /api/v1/client/goals
- Service: `src/client/goal/goal.client.service.ts` : `getActiveGoals`
- Cache key: `cache:client:goals:active`
- TTL: 1 hour (3600 sec)
- Hit/miss logs: `getActiveGoals cache hit` / `getActiveGoals cache written`
- Invalidated by:
  - `src/admin/goal/goal.admin.service.ts` on `createGoal`, `updateGoal`, `deleteGoal` (`redisClient.del(ADMIN_GOALS_CACHE_KEY, ACTIVE_GOALS_CACHE_KEY)`)

### 2.2 GET /api/v1/client/goals/my-goals
- Service: `src/client/goal/goal.client.service.ts` : `getMySelectedGoals(customerId, traceId)`
- Cache key: `cache:client:goals:selected:${customerId}`
- TTL: 5 minutes (300 sec)
- Hit/miss logs: `getMySelectedGoals cache hit` / `getMySelectedGoals cache written`
- Invalidated by:
  - `src/client/profile/customer.service.ts` on `updateCustomerProfile` (delete key)

### 2.3 GET /api/v1/admin/goals
- Service: `src/admin/goal/goal.admin.service.ts` : `getGoals`
- Cache key: `cache:admin:goals:list`
- TTL: 10 minutes (600 sec)
- Hit/miss logs: `getGoals service cache hit` / `getGoals service cache written`
- Invalidated by:
  - `createGoal`, `updateGoal`, `deleteGoal` in `src/admin/goal/goal.admin.service.ts`

## 3. APIs excluded from caching (no implement)
- Auth endpoints: OTP/validate/login/refresh/logout → security and freshness required
- write endpoints: create/update/delete profile/goals/admin users
- token-dependent user data (for now)

## 4. Cache keys summary
- `cache:client:goals:active`
- `cache:client:goals:selected:${customerId}`
- `cache:admin:goals:list`

## 5. Future caching additions
- Per-user profile snapshot: `cache:client:profile:${customerId}` with invalidation on profile update
- Admin role/permission read endpoints (with TTL)
- More selective query caching using parametrized key (e.g., `cache:admin:goals:filter:${md5(query)}`)

## 6. Validation checklist after changes
- API returns expected data.
- Relevant cache keys are populated and evicted properly.
- Cache hits are testable using logging events.
- Typecheck passes (`npm run typecheck`).
