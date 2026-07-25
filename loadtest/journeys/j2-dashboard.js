// J2 — Logged-in home / dashboard (group: dashboard). Fan-out route.
import { sleep } from 'k6';
import { getJSON, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';

export function dashboard(token) {
  const g = 'dashboard';

  const dash = getJSON('/dashboard', token, g);
  envelopeOk.add(checkEnvelope(dash, 'dashboard'));
  sleep(1);

  const unread = getJSON('/notifications/count', token, g);
  envelopeOk.add(checkEnvelope(unread, 'notification count'));
  sleep(1);

  const subs = getJSON('/my-subscriptions', token, g);
  envelopeOk.add(checkEnvelope(subs, 'my subscriptions'));
  sleep(1);
}
