/**
 * Camera ingest: go live from the browser camera. Browsers can't speak RTMP and StreamOS only accepts
 * RTMP, so: MediaRecorder WebM frames over WebSocket → ffmpeg (stdin) transcodes to
 * FLV/H.264+AAC → RTMP push to the session's rtmpUrl. Shares the HTTP server with
 * Socket.IO by claiming only the `/ws/camera-ingest` upgrade path. Requires `ffmpeg` on
 * the host; each connection is admin-authenticated.
 */
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "child_process";
import { redisClient } from "../config/redis";
import { verifyAccessToken } from "../utils/jwtSigner";
import logger from "../utils/logger";
import * as adminLiveSql from "../modules/admin-live/admin-live.service";
import { pushCredentialsExpired } from "../libs/streamos/streamos.provider";

const INGEST_PATH = "/ws/camera-ingest";
const ADMIN_ROLES = new Set(["admin", "super_admin", "editor"]);
// Grace period after the last chunk for ffmpeg to flush before a hard kill.
const FLUSH_GRACE_MS = 2000;

let ffmpegAvailable: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegAvailable === null) {
    ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  }
  return ffmpegAvailable;
}

// Mirrors HTTP `authenticate` for admins: valid signature, type "admin", an admin role,
// and a matching active session in Redis (the one-active-device rule).
async function verifyAdminToken(token: string): Promise<{ id: string; role: string } | null> {
  try {
    const decoded = verifyAccessToken<any>(token);
    if (decoded.type !== "admin" || !ADMIN_ROLES.has(decoded.role)) return null;
    const active = await redisClient.get(`admin_session:${decoded.id}`);
    if (!active || active !== token) return null;
    return { id: decoded.id, role: decoded.role };
  } catch {
    return null;
  }
}

interface IngestSocket extends WebSocket {
  adminId?: string;
  ff?: ChildProcessWithoutNullStreams;
  streamId?: string;
  started?: boolean;
}

function send(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

// Binary frame = media chunk for ffmpeg stdin; text = JSON control ({ type: "start" | "stop" }).
function handleMessage(ws: IngestSocket, data: RawData, isBinary: boolean) {
  if (isBinary) {
    if (ws.ff && ws.ff.stdin.writable) ws.ff.stdin.write(data as Buffer);
    return;
  }
  let msg: any;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return;
  }
  if (msg?.type === "start") {
    // Otherwise an unhandled rejection leaves the client hanging on "connecting…".
    startBroadcast(ws, msg).catch((err) => {
      logger.error("Camera ingest: startBroadcast threw", { error: (err as Error)?.message });
      send(ws, {
        type: "error",
        message: "Broadcast failed to start: " + ((err as Error)?.message ?? "unknown error"),
      });
      ws.ff = undefined;
      ws.started = false;
    });
  } else if (msg?.type === "stop") {
    stopBroadcast(ws, "client requested stop");
  }
}

export function initCameraIngest(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Coexist with Socket.IO: only claim our path, ignore everything else so
  // Socket.IO's own `upgrade` listener still handles `/socket.io/`.
  httpServer.on("upgrade", (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url || "", "http://localhost").pathname;
    } catch {
      return;
    }
    if (pathname !== INGEST_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: IngestSocket, req) => {
    // Listeners must be registered synchronously, before the async auth: `ws` drops
    // messages with no listener, and the browser sends "start" the instant the socket
    // opens. Pre-auth frames are buffered and drained once authenticated.
    let authed = false;
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!authed) {
        pending.push({ data, isBinary });
        return;
      }
      handleMessage(ws, data, isBinary);
    });
    ws.on("close", () => stopBroadcast(ws, "socket closed"));
    ws.on("error", (err) => {
      logger.warn("Camera ingest: socket error", { error: (err as Error).message });
      stopBroadcast(ws, "socket error");
    });

    // Browsers can't set WS headers, so the admin token rides in `?token=`.
    void (async () => {
      let token = "";
      try {
        token = new URL(req.url || "", "http://localhost").searchParams.get("token") || "";
      } catch {
        /* ignore */
      }
      const admin = await verifyAdminToken(token);
      if (!admin) {
        send(ws, { type: "error", message: "Unauthorized — a valid admin token is required." });
        ws.close(1008, "unauthorized");
        return;
      }
      ws.adminId = admin.id;
      authed = true;
      logger.info("Camera ingest: admin connected", { adminId: admin.id });
      send(ws, {
        type: "ready",
        message: hasFfmpeg()
          ? "Authenticated. Send a 'start' control message to begin."
          : "Authenticated, but ffmpeg is NOT installed on the server — broadcast will fail.",
        ffmpeg: hasFfmpeg(),
      });
      // Drain any frames (e.g. the browser's "start") that arrived mid-auth.
      const queued = pending.splice(0);
      for (const p of queued) handleMessage(ws, p.data, p.isBinary);
    })();
  });

  logger.info(
    `Camera ingest WebSocket ready at ${INGEST_PATH} (ffmpeg: ${hasFfmpeg() ? "found" : "MISSING"})`
  );
  return wss;
}

async function startBroadcast(ws: IngestSocket, msg: any) {
  if (ws.started) return;

  if (!hasFfmpeg()) {
    logger.warn("Camera ingest: start rejected — ffmpeg missing");
    send(ws, { type: "error", message: "ffmpeg is not installed on the server — cannot broadcast." });
    return;
  }

  const streamId = String(msg?.streamId || "").trim();
  if (!streamId) {
    logger.warn("Camera ingest: start rejected — no streamId", { adminId: ws.adminId });
    send(ws, { type: "error", message: "start: 'streamId' is required." });
    return;
  }
  logger.info("Camera ingest: start requested", { adminId: ws.adminId, streamId });

  const session = await adminLiveSql.findSessionByStreamId(streamId);
  if (!session) {
    logger.warn("Camera ingest: start rejected — session not found", { streamId });
    send(ws, { type: "error", message: `No live session found for streamId ${streamId}.` });
    return;
  }
  if (session.status !== "CREATED") {
    logger.warn("Camera ingest: start rejected — session not live", { streamId, status: session.status });
    send(ws, {
      type: "error",
      message: `Session is ${session.status}; only a CREATED (live) session can receive a broadcast.`,
    });
    return;
  }
  if (!session.rtmpUrl) {
    logger.warn("Camera ingest: start rejected — no rtmpUrl", { streamId });
    send(ws, { type: "error", message: "Session has no rtmpUrl — (re)start it first." });
    return;
  }
  // StreamOS ingest credentials expire ~24h after minting; fail with an actionable
  // message instead of handing ffmpeg a dead URL that fails opaquely minutes later.
  if (pushCredentialsExpired(session.pushExpiresAt)) {
    logger.warn("Camera ingest: start rejected — push credentials expired", {
      streamId,
      pushExpiresAt: session.pushExpiresAt,
    });
    send(ws, {
      type: "error",
      message: "Encoder credentials for this session have expired. Press Go Live again to mint fresh ones.",
    });
    return;
  }

  // Same encoder settings as scripts/go-live-from-camera.ts.
  const ff = spawn("ffmpeg", [
    "-fflags", "+genpts",
    "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-pix_fmt", "yuv420p", "-g", "60", "-r", "30",
    "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-f", "flv", session.rtmpUrl,
  ]);

  ws.ff = ff;
  ws.streamId = streamId;
  ws.started = true;

  // EPIPE on stdin just means ffmpeg already exited — handled by 'exit' below.
  ff.stdin.on("error", () => {
    /* ignore */
  });
  ff.stderr.on("data", (d: Buffer) => {
    const line = d.toString();
    if (/error|failed|invalid|unable/i.test(line)) {
      logger.warn("Camera ingest: ffmpeg", { streamId, line: line.trim().slice(0, 300) });
    }
  });
  ff.on("exit", (code) => {
    logger.info("Camera ingest: ffmpeg exited", { streamId, code });
    send(ws, { type: "stopped", code, message: `ffmpeg exited (code ${code}).` });
    ws.ff = undefined;
    ws.started = false;
  });
  ff.on("error", (err) => {
    logger.error("Camera ingest: ffmpeg spawn failed", { error: err.message });
    send(ws, { type: "error", message: "Failed to start ffmpeg: " + err.message });
    ws.ff = undefined;
    ws.started = false;
  });

  logger.info("Camera ingest: broadcast started", { adminId: ws.adminId, streamId });
  send(ws, { type: "started", streamId, message: "Broadcasting — ffmpeg is pushing to Streamos." });
}

function stopBroadcast(ws: IngestSocket, reason: string) {
  const ff = ws.ff;
  if (!ff) return;
  ws.ff = undefined;
  ws.started = false;
  logger.info("Camera ingest: stopping broadcast", { streamId: ws.streamId, reason });
  // Closing stdin lets ffmpeg flush and exit cleanly; hard-kill if it lingers.
  try {
    ff.stdin.end();
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      ff.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, FLUSH_GRACE_MS);
}
