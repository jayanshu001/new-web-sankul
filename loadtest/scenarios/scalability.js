// Phase 6d — PM2 scalability (§4 table 6d). Proves whether the app is CPU-bound (scales
// with workers) or DB-bound (flat — more workers just add DB connections and HURT).
//
// Run the SAME fixed arrival rate twice and compare RPS/p95:
//   pm2 scale ecosystem.config.cjs 1   && k6 run loadtest/scenarios/scalability.js \
//        --summary-export=loadtest/results/scale-1.json          # single worker
//   pm2 scale ecosystem.config.cjs max && k6 run loadtest/scenarios/scalability.js \
//        --summary-export=loadtest/results/scale-max.json         # all cores
//
// Interpretation:
//   throughput scales ~linearly with workers  → CPU-bound (add workers)
//   throughput ~flat, p95 same or worse        → DB-bound (workers just add pool
//                                                 pressure; fix the query/index/pool first)
//
// Fixed ARRIVAL RATE (not VUs) so the offered load is identical regardless of how fast
// each config responds — the honest way to compare two configs.
// Tunables: RATE (req/s, default 60), DURATION (default 3m).
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';
import { search } from '../journeys/j3-search.js';
import { playbackBrowse } from '../journeys/j4-playback.js';
import { examRead } from '../journeys/j5-exam.js';

const RATE = Number(__ENV.RATE || 60);
const DURATION = __ENV.DURATION || '3m';

export const options = {
  scenarios: {
    scale: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: RATE * 2,
      maxVUs: RATE * 10,
      exec: 'scaleFlow',
    },
  },
  thresholds: {
    // Recorded for comparison, not gating — the finding is the delta between the two runs.
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  return loadTokens();
}

// Same §8 read-heavy mix so both runs exercise the identical query pattern.
function weightedPick() {
  const r = Math.random() * 95;
  if (r < 40) return 'j1';
  if (r < 65) return 'j2';
  if (r < 80) return 'j4';
  if (r < 90) return 'j3';
  return 'j5';
}

export function scaleFlow(data) {
  const token = data.customer;
  switch (weightedPick()) {
    case 'j1':
      return catalog(token);
    case 'j2':
      return dashboard(token);
    case 'j3':
      return search(token);
    case 'j4':
      return playbackBrowse(token);
    case 'j5':
      return examRead(token);
  }
}
