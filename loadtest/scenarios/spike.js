// Phase 4 — Spike (§4). The burst this platform actually has: everyone opens the app
// when a live class starts. Exercises cold-cache stampede on shared routes.
//
// k6: ramping-vus 10 → 500 in 20s, hold 2m, drop to 10, hold 2m.
// Watch (§6): N identical DB queries on a single cache miss (stampede), and whether the
// service RECOVERS in the post-spike hold or stays degraded.
// Exit: error rate returns to baseline within 60s of the drop.
//
// For a TRUE cold-cache stampede, flush Redis right before the run:
//   redis-cli -p 6380 FLUSHDB && k6 run loadtest/scenarios/spike.js
//
// Tunables: SPIKE (peak VUs, default 500), RAMP (default 20s), HOLD (default 2m).
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';
import { live } from '../journeys/j6-live.js';

const SPIKE = Number(__ENV.SPIKE || 500);
const RAMP = __ENV.RAMP || '20s';
const HOLD = __ENV.HOLD || '2m';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: RAMP, target: SPIKE }, // the burst
        { duration: HOLD, target: SPIKE }, // sustained peak
        { duration: '20s', target: 10 },   // drop
        { duration: HOLD, target: 10 },    // RECOVERY window — watch error rate return
      ],
      exec: 'spikeFlow',
    },
  },
  thresholds: {
    // Recorded, not hard-gated — a spike is expected to hurt; the question is recovery.
    http_req_failed: ['rate<0.10'],
    http_req_duration: ['p(95)<3000'],
    checks: ['rate>0.95'],
    // Shared cached route — the stampede target; should stay cheap once warm.
    'http_req_duration{group:catalog}': ['p(95)<1000'],
  },
};

export function setup() {
  return loadTokens();
}

// App-open profile: the routes a client hits the instant a live class goes live —
// dashboard + catalog (shared cached) + the live-course list. Concentrated so a single
// cold cache key gets stampeded.
export function spikeFlow(data) {
  const token = data.customer;
  const r = Math.random() * 100;
  if (r < 45) return catalog(token);
  if (r < 80) return dashboard(token);
  return live(token);
}
