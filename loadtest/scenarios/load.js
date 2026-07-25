// Phase 2 — Baseline load (§4). THE number you quote.
//
// Three concurrent scenarios in one run (§5 "the realistic setup"):
//   browse    — ramping-vus, the §8 journey mix (J1/J2/J3/J4-browse/J5-read)
//   heartbeat — constant-arrival-rate, the highest-frequency write at a FIXED RPS
//   admin     — a handful of constant admin VUs, to catch pool starvation (§8 J7)
//
// Optionally a fourth (opt-in, DISPOSABLE DB ONLY): examWrite — the J5 attempt
// lifecycle. Enable with `-e EXAM_WRITE=true`.
//
// Read numbers from the 10m HOLD only — discard the warm-up (ground rule #4).
//
// Tunables (all -e / env):
//   PEAK           peak browse VUs               (default 100)
//   HEARTBEAT_RPS  heartbeat writes/sec          (default 10)
//   ADMIN_VUS      concurrent admin VUs          (default 10)
//   EXAM_WRITE     'true' to add the write J5    (default off)
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';
import { search } from '../journeys/j3-search.js';
import { playbackBrowse, heartbeat } from '../journeys/j4-playback.js';
import { examRead, examAttempt } from '../journeys/j5-exam.js';
import { admin } from '../journeys/j7-admin.js';

const PEAK = Number(__ENV.PEAK || 100);
const HEARTBEAT_RPS = Number(__ENV.HEARTBEAT_RPS || 10);
const ADMIN_VUS = Number(__ENV.ADMIN_VUS || 10);
const EXAM_WRITE = String(__ENV.EXAM_WRITE).toLowerCase() === 'true';

// Durations default to the §9 sample; override for a quick shakeout
// (e.g. -e WARMUP=10s -e RAMP=10s -e HOLD=20s -e RUN=50s).
const WARMUP = __ENV.WARMUP || '1m';
const RAMP = __ENV.RAMP || '3m';
const HOLD = __ENV.HOLD || '10m';
const RUN = __ENV.RUN || '15m'; // ≥ warmup+ramp+hold+drain; covers constant scenarios

const browseStages = [
  { duration: WARMUP, target: Math.max(1, Math.round(PEAK / 4)) }, // warm up — discard
  { duration: RAMP, target: PEAK },                                // ramp
  { duration: HOLD, target: PEAK },                                // HOLD — read here
  { duration: '1m', target: 0 },
];

const scenarios = {
  browse: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: browseStages,
    exec: 'browseFlow',
    tags: { scenario: 'browse' },
  },
  heartbeat: {
    executor: 'constant-arrival-rate',
    rate: HEARTBEAT_RPS,
    timeUnit: '1s',
    duration: RUN,
    preAllocatedVUs: Math.max(10, HEARTBEAT_RPS * 2),
    maxVUs: Math.max(50, HEARTBEAT_RPS * 5),
    exec: 'heartbeatFlow',
    tags: { scenario: 'heartbeat' },
  },
  admin: {
    executor: 'constant-vus',
    vus: ADMIN_VUS,
    duration: RUN,
    exec: 'adminFlow',
    tags: { scenario: 'admin' },
  },
};

if (EXAM_WRITE) {
  scenarios.examWrite = {
    executor: 'constant-vus',
    vus: 3,
    duration: RUN,
    exec: 'examWriteFlow',
    tags: { scenario: 'examWrite' },
  };
}

export const options = {
  scenarios,
  thresholds: {
    // global (§7)
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    checks: ['rate>0.99'],
    // per journey
    'http_req_duration{group:catalog}': ['p(95)<300'],
    'http_req_duration{group:dashboard}': ['p(95)<400'],
    'http_req_duration{group:search}': ['p(95)<600'],
    'http_req_duration{group:write}': ['p(95)<800'],
    'http_req_duration{group:analytics}': ['p(95)<1500'],
  },
};

export function setup() {
  return loadTokens();
}

// §8 Phase-2 mix (browse portion): J1 40 · J2 25 · J4 15 · J3 10 · J5 5.
// Admin (J7 5%) is its own scenario; heartbeat writes are their own scenario.
function weightedPick() {
  const r = Math.random() * 95; // weights sum to 95 (admin's 5 is elsewhere)
  if (r < 40) return 'j1';
  if (r < 65) return 'j2';
  if (r < 80) return 'j4';
  if (r < 90) return 'j3';
  return 'j5';
}

export function browseFlow(data) {
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
  // Fixed-RPS heartbeat write — the platform's highest-frequency write.
  heartbeat(data.customer, null, 30 + Math.floor(Math.random() * 300));
}

export function adminFlow(data) {
  admin(data.admin);
}

export function examWriteFlow(data) {
  examAttempt(data.customer);
}
