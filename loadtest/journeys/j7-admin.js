// J7 — Admin surface (group: analytics). Low concurrency, heavy queries.
// Runs CONCURRENTLY with client load in load.js — the real risk is one admin report
// starving the client-facing connection pool (§8 J7). Uses the admin token.
import { sleep } from 'k6';
import { BASE_URL, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';
import http from 'k6/http';

const ADMIN = `${BASE_URL}/api/v1/admin`;

function adminGet(path, token, ep) {
  return http.get(`${ADMIN}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    tags: { group: 'analytics', ep },
  });
}

export function admin(adminToken) {
  const dash = adminGet('/dashboard', adminToken, 'admin-dashboard');
  envelopeOk.add(checkEnvelope(dash, 'admin dashboard'));
  sleep(2);

  const subs = adminGet('/subscriptions?page=1&limit=20', adminToken, 'admin-subscriptions');
  envelopeOk.add(checkEnvelope(subs, 'admin subscriptions'));
  sleep(2);

  const customers = adminGet('/customers?page=1&limit=20', adminToken, 'admin-customers');
  envelopeOk.add(checkEnvelope(customers, 'admin customers'));
  sleep(2);
}
