// src/utils/requestContext.ts
//
// AsyncLocalStorage-backed per-request context. Once seeded (by the
// requestContext middleware), any code path executed during the request —
// including inside controllers, services, mongoose middleware, Promise.all
// branches, etc. — can read or update the context without threading it
// manually through every function signature.
//
// What it carries:
//   - traceId   — the request id (mirror of requestLogger's `traceId`)
//   - userId    — set by `authenticate` middleware after JWT verify
//   - route     — the matched Express route template (filled at request end)
//   - dbMs      — accumulated milliseconds spent in Mongo calls
//   - cacheHit  — counter, incremented inside libs/cache.ts on each hit
//   - cacheMiss — counter, incremented inside libs/cache.ts on each miss
//
// Logger reads this lazily via a Winston format so every log line gets
// these fields automatically — no caller changes required.
//
// Note: AsyncLocalStorage's overhead in modern Node is negligible (<1µs/op);
// it's the canonical recommended pattern from the Node TSC for request-
// scoped context.

import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  traceId?: string;
  userId?: string;
  userRole?: string;
  route?: string;
  /** Cumulative milliseconds spent in Mongo for this request. */
  dbMs: number;
  /** Number of cache hits served from libs/cache.aside during this request. */
  cacheHit: number;
  /** Number of cache misses that fell through to the loader. */
  cacheMiss: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with a fresh request context. Called once per request from the
 * middleware. The context lives for as long as the request handler chain.
 */
export const runWithContext = <T>(seed: Partial<RequestContext>, fn: () => T): T => {
  const ctx: RequestContext = {
    dbMs: 0,
    cacheHit: 0,
    cacheMiss: 0,
    ...seed,
  };
  return storage.run(ctx, fn);
};

/**
 * Read the current context. Returns undefined if called outside any request
 * (e.g. during BullMQ worker startup, scripts, tests).
 */
export const getContext = (): RequestContext | undefined => storage.getStore();

/**
 * Mutate the current context. Safe to call without a context (no-ops).
 * Used by:
 *   - authenticate middleware to set userId/userRole after JWT verify
 *   - libs/cache.ts to increment cacheHit/cacheMiss counters
 *   - mongoose middleware to accumulate dbMs
 */
export const updateContext = (patch: Partial<RequestContext>): void => {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx, patch);
};

/**
 * Increment a numeric counter on the current context. Safe outside a context.
 */
export const incrementContext = (key: "dbMs" | "cacheHit" | "cacheMiss", by = 1): void => {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx[key] += by;
};
