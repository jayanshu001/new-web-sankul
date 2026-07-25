// Phase 6a — Cold vs warm cache (§4). Proves true DB cost vs cached cost of each route
// — the number you need to SIZE the database.
//
// Run it TWICE, identical, and compare (§6 table 6a):
//   redis-cli -p 6380 FLUSHDB && BASE_URL=... k6 run loadtest/scenarios/cache-cold.js \
//       --summary-export=loadtest/results/cache-cold-$(date +%F).json      # COLD
//   BASE_URL=... k6 run loadtest/scenarios/cache-cold.js \
//       --summary-export=loadtest/results/cache-warm-$(date +%F).json      # WARM (no flush)
//
// The delta per group IS the cache's value. A cold p95 that barely beats warm means the
// route isn't really cached (or the key cardinality is wrong — `scope:"user"` on a route
// that should be shared).
//
// Modest, steady load so we measure per-route cost, not saturation. Tunables:
// VUS (default 10), DURATION (default 2m).
import { loadTokens } from '../lib/auth.js';
import { catalog } from '../journeys/j1-catalog.js';
import { dashboard } from '../journeys/j2-dashboard.js';

const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '2m';

export const options = {
  scenarios: {
    cache: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      exec: 'cacheFlow',
    },
  },
  // No hard thresholds — this run is a MEASUREMENT, compared across cold/warm, not a gate.
  thresholds: {
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return loadTokens();
}

// Only the cacheable read routes (catalog = shared+user cached, dashboard = 60s user).
// Keep the mix identical between cold and warm runs so the delta is attributable to cache.
export function cacheFlow(data) {
  const token = data.customer;
  if (Math.random() < 0.6) return catalog(token);
  return dashboard(token);
}
