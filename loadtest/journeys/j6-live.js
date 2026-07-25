// J6 — Live session (group: live). Phase 4's main target.
// HTTP reads only here. The Socket.IO connection-storm test needs a SEPARATE k6
// `ws` scenario (§8 J6) — HTTP VUs won't exercise it; that lands with Phase 4/spike.
import { sleep } from 'k6';
import { getJSON, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';

export function live(token) {
  const g = 'live';

  const courses = getJSON('/live-courses', token, g, { ep: 'live-courses' });
  envelopeOk.add(checkEnvelope(courses, 'live courses'));
  sleep(1);
}
