// J4 — Video / lecture playback (group: write). Contract-critical.
// The heartbeat is the platform's highest-frequency write; in load.js it gets its
// own constant-arrival-rate scenario. This function models one "play a lecture"
// interaction: fetch the encrypted lecture URL, then post a progress heartbeat.
import { check, sleep } from 'k6';
import { getJSON, postJSON, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';
import { playback, pick } from '../lib/data.js';

export function playbackBrowse(token) {
  const g = 'write';
  const item = pick(playback);
  if (!item) return;

  // Encrypted lecture URL contract (§8 J4 / video URL contract rule).
  // lectureQuerySchema wants: id=<videoId>, type=course|package, course=<id>/package=<id>.
  const containerParam = item.scope.kind === 'package' ? 'package' : 'course';
  const lecture = getJSON(
    `/courses/lecture?id=${item.videoId}&type=${containerParam}&${containerParam}=${item.scope.id}`,
    token,
    g,
    { ep: 'lecture' },
  );
  envelopeOk.add(checkEnvelope(lecture, 'lecture url'));
  sleep(1);

  heartbeat(token, item, 30);
  sleep(1);

  const mine = getJSON('/learning/progress/my', token, g, { ep: 'progress-my' });
  envelopeOk.add(checkEnvelope(mine, 'progress my'));
  sleep(1);
}

// Single heartbeat write. Used both inside the browse journey and by the dedicated
// constant-arrival-rate heartbeat scenario in load.js.
export function heartbeat(token, item, positionSec) {
  const it = item || pick(playback);
  if (!it) return null;
  const res = postJSON(
    `/courses/lectures/${it.videoId}/progress`,
    token,
    'write',
    {
      positionSec,
      durationSec: 600,
      scope: { kind: it.scope.kind, id: it.scope.id },
    },
    { ep: 'heartbeat' },
  );
  envelopeOk.add(
    check(res, {
      'heartbeat: status 200': (r) => r.status === 200,
      'heartbeat: acked': (r) => {
        try {
          return r.json('success') === true;
        } catch (_) {
          return false;
        }
      },
    }),
  );
  return res;
}
