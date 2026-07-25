// J1 — Browse / catalog (group: catalog). Read-only, mostly cached.
import { sleep } from 'k6';
import { getJSON, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';

export function catalog(token) {
  const g = 'catalog';

  const courses = getJSON('/courses', token, g);
  envelopeOk.add(checkEnvelope(courses, 'courses list'));
  sleep(1);

  const cats = getJSON('/courses/categories', token, g);
  envelopeOk.add(checkEnvelope(cats, 'course categories'));
  sleep(1);

  const packages = getJSON('/packages', token, g);
  envelopeOk.add(checkEnvelope(packages, 'packages list'));
  sleep(1);

  const ebooks = getJSON('/ebooks', token, g);
  envelopeOk.add(checkEnvelope(ebooks, 'ebooks list'));
  sleep(1);
}
