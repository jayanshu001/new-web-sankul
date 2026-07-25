// Phase 1 — Smoke. Validates the SCRIPTS, not the server (§4).
// 2 VUs, 1 minute. Exit criteria: checks rate = 100%, http_req_failed = 0.
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';
import { search } from '../journeys/j3-search.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 2,
      duration: '1m',
    },
  },
  thresholds: {
    // In smoke these must be perfect — any breach is a script bug, not capacity.
    http_req_failed: ['rate==0'],
    checks: ['rate==1.0'],
  },
};

export function setup() {
  return loadTokens();
}

export default function (data) {
  const token = data.customer;
  catalog(token);
  dashboard(token);
  search(token);
}
