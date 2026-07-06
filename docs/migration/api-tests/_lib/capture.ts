/**
 * HTTP capture layer for the migration API tests.
 *
 * Every request that goes through `_lib/http.ts` is recorded here: method, path,
 * headers (Authorization redacted to a Bearer marker), query, request body, and
 * the response status + body. When a module's suite passes, the runner asks for
 * the captured calls and writes docs/migration/api-tests/<module>/API_DOC.md so
 * each documented endpoint shows real header / request / response examples.
 */

export type CapturedCall = {
  method: string;
  /** path without the origin (e.g. /api/v1/admin/cms/faqs) */
  path: string;
  query?: Record<string, string | number | undefined>;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  responseStatus: number;
  responseBody: unknown;
};

let currentModule: string | null = null;
const byModule = new Map<string, CapturedCall[]>();

/** Mark the start of a module's capture window (called by the runner). */
export function beginCapture(moduleName: string): void {
  currentModule = moduleName;
  if (!byModule.has(moduleName)) byModule.set(moduleName, []);
}

/** Stop recording for the active module. */
export function endCapture(): void {
  currentModule = null;
}

/** Drain and return all calls captured for a module. */
export function takeCaptured(moduleName: string): CapturedCall[] {
  const calls = byModule.get(moduleName) ?? [];
  byModule.delete(moduleName);
  return calls;
}

/** Redact the bearer token so docs never leak a real JWT. */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = k.toLowerCase() === "authorization" ? "Bearer <token>" : v;
  }
  return out;
}

/** Called by http.ts after each request completes. No-op outside a capture window. */
export function record(call: CapturedCall): void {
  if (!currentModule) return;
  byModule.get(currentModule)!.push({
    ...call,
    requestHeaders: redactHeaders(call.requestHeaders),
  });
}
