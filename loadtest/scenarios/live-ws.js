// Phase 4 (J6) — Socket.IO connection storm. A SEPARATE ws scenario, because HTTP VUs
// won't exercise Socket.IO (§8 J6). Models the burst when a live class starts: hundreds
// of clients open a socket, authenticate, and join the live-chat room within seconds.
//
// Each VU = one client: connect → auth → join_live_chat → hold → close.
//
// Proves: how many concurrent Socket.IO connections the server accepts, the connect +
// join round-trip latency under a storm, and whether the Redis adapter / attendance
// writes keep up. Watch server-side: open file handles, RSS, Redis ops/sec.
//
// Tunables: SOCKETS (peak concurrent sockets, default 500), RAMP (default 20s),
// HOLD_S (seconds each socket stays open, default 30), LIVE_CLASS_ID (default "1").
import { check } from 'k6';
import { loadTokens } from '../lib/auth.js';
import {
  connectJoinHold,
  wsConnectOk,
  wsJoinOk,
} from '../lib/socketio.js';

const SOCKETS = Number(__ENV.SOCKETS || 500);
const RAMP = __ENV.RAMP || '20s';
const HOLD = __ENV.HOLD || '2m';        // sustained-storm duration (tunable for shakeout)
const HOLD_S = Number(__ENV.HOLD_S || 30);
const LIVE_CLASS_ID = __ENV.LIVE_CLASS_ID || '1';

export const options = {
  scenarios: {
    live_ws: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: RAMP, target: SOCKETS }, // the connection storm
        { duration: HOLD, target: SOCKETS }, // sustained concurrent sockets
        { duration: '20s', target: 0 },      // drain
      ],
      exec: 'liveWsFlow',
    },
  },
  thresholds: {
    ws_connect_ok: ['rate>0.95'],   // sockets that reached the CONNECT ack
    ws_join_ok: ['rate>0.95'],      // joins the server processed
    ws_connect_ms: ['p(95)<2000'],  // handshake latency under storm
    ws_session_duration: ['p(95)<60000'],
  },
};

export function setup() {
  return loadTokens();
}

export function liveWsFlow(data) {
  const res = connectJoinHold(data.customer, LIVE_CLASS_ID, HOLD_S * 1000);
  check(res, {
    'ws handshake status 101': (r) => r && r.status === 101,
  });
}
