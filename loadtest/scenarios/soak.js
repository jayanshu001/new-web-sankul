// Phase 5 — Soak (§4). The ONLY phase that finds leaks — memory, sockets, handles,
// Redis keys, connection pool, log-disk fill. Modest, steady, LONG.
//
// k6: constant-vus at 50–70% of peak, duration 2h (4h if you can). Add a steady
// heartbeat write so the pool/row-lock paths are exercised the whole time too.
//
// Watch (over the whole run, not a snapshot): RSS trending up in `pm2 monit`; p95
// creeping upward hour over hour; Redis key count; open handles.
// Exit: RSS and p95 FLAT across the run (no monotonic trend).
//
// Tunables: SOAK_VUS (default 30), HEARTBEAT_RPS (default 5), DURATION (default 2h).
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';
import { search } from '../journeys/j3-search.js';
import { playbackBrowse, heartbeat } from '../journeys/j4-playback.js';
import { examRead } from '../journeys/j5-exam.js';

const SOAK_VUS = Number(__ENV.SOAK_VUS || 30);
const HEARTBEAT_RPS = Number(__ENV.HEARTBEAT_RPS || 5);
const DURATION = __ENV.DURATION || '2h';

export const options = {
  scenarios: {
    browse: {
      executor: 'constant-vus',
      vus: SOAK_VUS,
      duration: DURATION,
      exec: 'soakFlow',
      tags: { scenario: 'browse' },
    },
    heartbeat: {
      executor: 'constant-arrival-rate',
      rate: HEARTBEAT_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(10, HEARTBEAT_RPS * 2),
      maxVUs: Math.max(30, HEARTBEAT_RPS * 4),
      exec: 'heartbeatFlow',
      tags: { scenario: 'heartbeat' },
    },
  },
  thresholds: {
    // Soak is about STABILITY, not peak speed. These should hold flat the whole run;
    // a creeping p95 that eventually crosses them is exactly the leak we're hunting.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return loadTokens();
}

// Same read-heavy §8 mix as Phase 2 browse.
function weightedPick() {
  const r = Math.random() * 95;
  if (r < 40) return 'j1';
  if (r < 65) return 'j2';
  if (r < 80) return 'j4';
  if (r < 90) return 'j3';
  return 'j5';
}

export function soakFlow(data) {
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

export function heartbeatFlow(data) {
  heartbeat(data.customer, null, 30 + Math.floor(Math.random() * 300));
}
