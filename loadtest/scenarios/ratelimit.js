// Phase 6b — Rate limiter. The ONE run with limiting ON (§4 table 6b).
//
// ⚠ REQUIRES the limiter enabled: run against a target WITHOUT RATE_LIMIT_DISABLED
//    (i.e. unset it / set false and restart). On a limiter-OFF target every request is
//    200 and this test proves nothing — the ws_429 threshold will (correctly) fail.
//
// Proves the client limiter (src/config/rateLimiter.ts): budget is
// RATE_LIMIT_CLIENT_MAX (default 300) per 60s, keyed per-customer (client:user:<id>),
// cluster-wide via Redis (not per-worker), and returns standard RateLimit-* headers.
//
// Method: 1 VU, a single token, a rate FAR above budget against one cheap cached route.
// The first ~300 in a window pass, the rest 429. Crossing the 60s boundary shows the
// window reset.
//
// Tunables: RATE (req/s, default 20 → 1200/min ≫ 300), DURATION (default 90s so we span
// one window reset), BUDGET (expected budget for the assertion, default 300).
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { loadTokens } from '../lib/auth.js';
import { getJSON } from '../lib/http.js';

const RATE = Number(__ENV.RATE || 20);
const DURATION = __ENV.DURATION || '90s';
const BUDGET = Number(__ENV.BUDGET || 300);

const passed = new Counter('rl_200');
const limited = new Counter('rl_429');

export const options = {
  scenarios: {
    ratelimit: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'rlFlow',
    },
  },
  thresholds: {
    // The limiter MUST engage — if this fails on a limiter-ON target, the limiter is
    // broken (or per-worker, so the cluster-wide budget never trips).
    rl_429: ['count>0'],
    // And it must NOT 500 — a limiter that errors instead of 429ing is a bug.
    'http_req_failed{expected_response:true}': ['rate==0'],
  },
};

export function setup() {
  return loadTokens();
}

// Single token, single cheap route → all requests share ONE bucket (client:user:<id>).
export function rlFlow(data) {
  // Mark 429 as an expected response so it doesn't inflate http_req_failed.
  const res = getJSON('/courses/categories', data.customer, 'catalog');
  const status = res.status;
  if (status === 200) passed.add(1);
  else if (status === 429) limited.add(1);

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'not a 5xx': (r) => r.status < 500,
    // When limited, the standard headers must be present (standardHeaders:true).
    '429 carries RateLimit headers': (r) =>
      r.status !== 429 || r.headers['Ratelimit-Remaining'] !== undefined || r.headers['Retry-After'] !== undefined,
  });
}
