// Phase 6c — Graceful shutdown (§4 table 6c). Proves a rolling restart drops ZERO
// requests: `/readyz` flips to 503, in-flight requests drain, no 502s.
//
// Procedure (k6 can't trigger the restart — you do, mid-run):
//   1. Start this scenario:  BASE_URL=... k6 run loadtest/scenarios/shutdown.js
//   2. ~30s in, in another shell:  pm2 reload ecosystem.config.cjs
//   3. Watch: readyz_503 should register (drain observed), http_502 must stay 0.
//
// The boot flow drains via /readyz=503 (see CLAUDE.md / src/index.ts); keep-alive is
// 65s > LB timeout so the LB stops routing before sockets close. This test is what
// verifies that actually holds under live traffic.
//
// Tunables: RATE (steady req/s, default 30), DURATION (default 3m — leave room to
// trigger the reload and watch recovery), READYZ_HZ (readyz polls/s, default 2).
import { check } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { loadTokens } from '../lib/auth.js';
import { BASE_URL, getJSON } from '../lib/http.js';

const RATE = Number(__ENV.RATE || 30);
const DURATION = __ENV.DURATION || '3m';
const READYZ_HZ = Number(__ENV.READYZ_HZ || 2);

const badGateway = new Counter('http_502'); // the failure this test hunts — must stay 0
const readyDraining = new Counter('readyz_503'); // proof the drain state was observed

export const options = {
  scenarios: {
    // Steady client traffic across the reload.
    traffic: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: RATE,
      maxVUs: RATE * 4,
      exec: 'trafficFlow',
    },
    // Poll /readyz so we can SEE the 503 drain window (health routes sit above the limiter).
    readyz: {
      executor: 'constant-arrival-rate',
      rate: READYZ_HZ,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 2,
      maxVUs: 5,
      exec: 'readyzFlow',
    },
  },
  thresholds: {
    // The whole point: a graceful reload drops nothing.
    http_502: ['count==0'],
    // Non-502 failures should also stay near zero (some in-flight resets at the exact
    // swap instant are tolerable; 502s are not).
    http_req_failed: ['rate<0.02'],
  },
};

export function setup() {
  return loadTokens();
}

export function trafficFlow(data) {
  const res = getJSON('/courses/categories', data.customer, 'catalog');
  if (res.status === 502) badGateway.add(1);
  check(res, {
    'no 502 (bad gateway)': (r) => r.status !== 502,
    'served (200) or cleanly retryable (503)': (r) => r.status === 200 || r.status === 503,
  });
}

export function readyzFlow() {
  const res = http.get(`${BASE_URL}/readyz`, { tags: { group: 'health' } });
  if (res.status === 503) readyDraining.add(1);
}
