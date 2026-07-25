// Shared HTTP helpers for all k6 journeys.
// - BASE_URL from env (default local dev server)
// - tagged request wrapper so §7 per-group thresholds work
// - envelope check helper matching utils/httpResponse.ts
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API = `${BASE_URL}/api/v1/client`;

export function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  };
}

// GET with a mandatory `group` tag (§9 convention).
export function getJSON(path, token, group, extraTags = {}) {
  const params = authHeaders(token);
  params.tags = { group, ...extraTags };
  return http.get(`${API}${path}`, params);
}

// POST JSON with a mandatory `group` tag. Sets Content-Type so app.ts's JSON body
// parser fires (it only parses when Content-Type explicitly says JSON — see app.ts).
export function postJSON(path, token, group, payload, extraTags = {}) {
  const params = authHeaders(token);
  params.headers['Content-Type'] = 'application/json';
  params.tags = { group, ...extraTags };
  return http.post(`${API}${path}`, JSON.stringify(payload), params);
}

// Smoke-level correctness: reachable, parses, and not an auth/validation failure.
// Deliberately lenient — response envelopes vary across endpoints (some use the full
// httpResponse.ts `{success,code,data,message,messages}`, some `{success,data,pagination}`,
// some a bare `{dashboard:[...]}`). Per-endpoint contract assertions belong in the
// Phase-2 journeys, not the smoke helper.
export function checkEnvelope(res, name) {
  let body = null;
  try {
    body = res.json();
  } catch (_) {
    body = null;
  }
  return check(res, {
    [`${name}: status 200`]: (r) => r.status === 200,
    [`${name}: JSON parses`]: () => body !== null && typeof body === 'object',
    // Some endpoints omit `success`; only fail when it is explicitly false.
    [`${name}: not an error envelope`]: () => body !== null && body.success !== false,
  });
}
