// Phase 3 — Stress (§4). Find the CEILING and the FAILURE MODE.
//
// Uses `ramping-arrival-rate` (NOT VU-based) — the plan is explicit: VU executors
// self-throttle when the server slows and hide the problem. Arrival-rate holds a
// target RPS regardless of response time, so `dropped_iterations` becomes the honest
// "server can't keep up" signal.
//
// Steps 2× → 3× → 4× the Phase-2 peak RPS, 2m per step (§4). Set PEAK_RPS from your
// VALID Phase-2 baseline throughput — NOT a guess, NOT the dev-server number.
//
// While it runs, watch (§6): Prisma pool timeouts, MySQL `too many connections`
// (SHOW STATUS LIKE 'Threads_connected'), `dropped_iterations`, PM2 restarts.
//
// Exit: ceiling RPS documented (where p95 crosses SLO or errors >1%), failure mode
// characterized as graceful (slow but 200) vs ugly (500s / pool timeouts / restarts).
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';
import { search } from '../journeys/j3-search.js';
import { playbackBrowse } from '../journeys/j4-playback.js';
import { examRead } from '../journeys/j5-exam.js';

// Baseline peak RPS to multiply. Default is a placeholder — override with your real
// Phase-2 throughput: e.g. `-e PEAK_RPS=200`.
const PEAK_RPS = Number(__ENV.PEAK_RPS || 40);
const STEP = __ENV.STEP || '2m';
const RAMP = __ENV.RAMP || '30s';

// 2× → 3× → 4×, each reached over RAMP then held for STEP.
const stages = [
  { target: PEAK_RPS * 2, duration: RAMP },
  { target: PEAK_RPS * 2, duration: STEP },
  { target: PEAK_RPS * 3, duration: RAMP },
  { target: PEAK_RPS * 3, duration: STEP },
  { target: PEAK_RPS * 4, duration: RAMP },
  { target: PEAK_RPS * 4, duration: STEP },
  { target: 0, duration: '30s' },
];

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: PEAK_RPS,
      timeUnit: '1s',
      stages,
      // Give k6 enough VUs to actually issue the target rate as latency climbs;
      // if these cap out, dropped_iterations rises — itself a saturation signal.
      preAllocatedVUs: PEAK_RPS * 4,
      maxVUs: PEAK_RPS * 20,
      exec: 'stressFlow',
    },
  },
  thresholds: {
    // Abort once it's clearly broken so we don't hammer a dead server (§7).
    http_req_failed: [
      { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' },
    ],
    // Recorded, not gating — Phase 3 is about the curve, not a pass/fail.
    http_req_duration: ['p(95)<3000'],
  },
};

export function setup() {
  return loadTokens();
}

// Same §8 read-heavy mix as Phase 2's browse (no exam-write here — stress reruns
// must be comparable and side-effect-free; the heartbeat write stays in load.js).
function weightedPick() {
  const r = Math.random() * 100;
  if (r < 42) return 'j1'; // 40/95 renormalized
  if (r < 68) return 'j2';
  if (r < 84) return 'j4';
  if (r < 95) return 'j3';
  return 'j5';
}

export function stressFlow(data) {
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
