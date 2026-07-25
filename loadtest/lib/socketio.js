// Minimal Socket.IO (Engine.IO v4) client over k6's raw WebSocket — k6 has no native
// Socket.IO client, so we speak the wire protocol ourselves. Verified against the live
// server's default (customer) namespace on 2026-07-24.
//
// Framing we use:
//   recv "0{...}"   Engine.IO OPEN         → send Socket.IO CONNECT with auth
//   send "40{json}" Socket.IO CONNECT      (auth payload = handshake.auth)
//   recv "40{sid}"  CONNECT ack            → namespace joined, auth OK
//   send "42[ev,pl]" EVENT                 (e.g. join_live_chat)
//   recv "42[ev,pl]" EVENT                 (chat_settings / chat_history / error / ...)
//   recv "2"        Engine.IO PING         → reply "3" PONG (keep-alive)
import ws from 'k6/ws';
import { Trend, Rate, Counter } from 'k6/metrics';
import { BASE_URL } from './http.js';

export const wsConnectMs = new Trend('ws_connect_ms', true); // open → CONNECT ack
export const wsJoinMs = new Trend('ws_join_ms', true);       // join emit → first event
export const wsConnectOk = new Rate('ws_connect_ok');        // reached CONNECT ack
export const wsJoinOk = new Rate('ws_join_ok');              // server processed the join
export const wsErrors = new Counter('ws_errors');

const WS_URL =
  BASE_URL.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';

// Open one socket, authenticate, join a live class, hold for `holdMs`, close.
// Resolves whatever ws.connect returns (status/errors) after the socket closes.
export function connectJoinHold(token, liveClassId, holdMs) {
  const openedAt = Date.now();
  let connectAckAt = 0;
  let joinSentAt = 0;

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', function () {
      // Wait for Engine.IO OPEN ("0{...}") before sending CONNECT — handled in message.
    });

    socket.on('message', function (raw) {
      const msg = String(raw);

      // Engine.IO PING → PONG.
      if (msg === '2') {
        socket.send('3');
        return;
      }

      // Engine.IO OPEN → Socket.IO CONNECT with auth payload.
      if (msg[0] === '0') {
        socket.send('40' + JSON.stringify({ token }));
        return;
      }

      // Socket.IO CONNECT ack → authenticated; emit the join.
      if (msg.startsWith('40')) {
        connectAckAt = Date.now();
        wsConnectMs.add(connectAckAt - openedAt);
        wsConnectOk.add(true);
        joinSentAt = Date.now();
        socket.send('42' + JSON.stringify(['join_live_chat', { liveClassId }]));
        return;
      }

      // Socket.IO EVENT — the server processed our join (chat_settings/chat_history,
      // or an explicit "error" for an inactive class). Either proves the pipeline
      // handled the join under load; both count as join-OK for capacity purposes.
      if (msg.startsWith('42')) {
        if (joinSentAt) {
          wsJoinMs.add(Date.now() - joinSentAt);
          wsJoinOk.add(true);
          joinSentAt = 0;
        }
        return;
      }
    });

    socket.on('error', function (e) {
      wsErrors.add(1);
      wsConnectOk.add(false);
    });

    // Hold the connection open (models a viewer watching), then close.
    socket.setTimeout(function () {
      socket.close();
    }, holdMs);
  });

  return res;
}
