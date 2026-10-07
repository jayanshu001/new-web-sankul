// Request context: AsyncLocalStorage-backed per-request store, seeded by the requestContext
// middleware. The logger reads it via a Winston format so every log line
// carries these fields.

import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  traceId?: string;
  userId?: string;
  userRole?: string;
  route?: string;
  dbMs: number;
  cacheHit: number;
  cacheMiss: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(seed: Partial<RequestContext>, fn: () => T): T => {
  const ctx: RequestContext = {
    dbMs: 0,
    cacheHit: 0,
    cacheMiss: 0,
    ...seed,
  };
  return storage.run(ctx, fn);
};

/** Undefined outside a request (workers, scripts, tests). */
export const getContext = (): RequestContext | undefined => storage.getStore();

/** No-op outside a request context. */
export const updateContext = (patch: Partial<RequestContext>): void => {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx, patch);
};

export const incrementContext = (key: "dbMs" | "cacheHit" | "cacheMiss", by = 1): void => {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx[key] += by;
};
