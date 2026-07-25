// J3 — Search & pagination (group: search). Varied terms incl. Gujarati/Hindi.
import { sleep } from 'k6';
import { getJSON, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';
import { searchTerms, pick } from '../lib/data.js';

export function search(token) {
  const g = 'search';
  const term = encodeURIComponent(pick(searchTerms) || 'gpsc');

  const global = getJSON(`/search?search=${term}&page=1&limit=10`, token, g);
  envelopeOk.add(checkEnvelope(global, 'global search'));
  sleep(1);

  const coursePage = getJSON(`/courses?search=${term}&page=1&limit=10`, token, g);
  envelopeOk.add(checkEnvelope(coursePage, 'course search'));
  sleep(1);
}
