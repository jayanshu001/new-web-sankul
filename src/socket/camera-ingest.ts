/**
 * Camera-ingest WebSocket bridge — "go live from the browser camera".
 *
 * Browsers cannot speak RTMP, and Streamos only accepts RTMP ingest. This
 * module bridges the gap:
 *
 *   browser getUserMedia → MediaRecorder (WebM/VP8+Opus)
 *     → binary WebSocket frames → THIS server
 *     → ffmpeg (stdin pipe) transcodes WebM → FLV/H.264+AAC
 *     → RTMP push to the LiveSession's Streamos rtmpUrl
 *
 * It shares the main HTTP server with Socket.IO by handling only the
 * `/ws/camera-ingest` upgrade path and leaving every other path alone.
 *
 * Requires `ffmpeg` on the server host (same dependency as
 * scripts/go-live-from-camera.ts). Each connection is admin-authenticated.
 */
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "child_process";
import { redisClient } from "../config/redis";
import { verifyAccessToken } from "../utils/jwtSigner";
import { LiveSession } from "../models/course/LiveSession.model";
import logger from "../utils/logger";

const INGEST_PATH = "/ws/camera-ingest";
const ADMIN_ROLES = new Set(["admin", "super_admin", "editor"]);
// Grace period after the last chunk for ffmpeg to flush before a hard kill.
const FLUSH_GRACE_MS = 2000;

// Cached one-shot `ffmpeg -version` probe.
let ffmpegAvailable: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegAvailable === null) {
    ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  }
  return ffmpegAvailable;
}

// Verify an admin JWT the same way the HTTP `authenticate` middleware does:
// valid signature, type === "admin", an admin role, and a matching active
// session in Redis (the 1-active-device rule).
async function verifyAdminToken(token: string): Promise<{ id: string; role: string } | null> {
  try {
    // Keyring-aware verify so camera-ingest socket auth survives key rotation.
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

// Routes one decoded WebSocket frame: binary = media chunk → ffmpeg stdin;
// text = JSON control message ({ type: "start" | "stop" }).
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
    // startBroadcast is async — a rejection here would otherwise be a silent
    // unhandled rejection that leaves the client hanging on "connecting…".
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
    // CRITICAL: register the message/close/error listeners SYNCHRONOUSLY, before
    // the async auth below. `ws` drops 'message' events that arrive with no
    // listener attached — and the browser sends its "start" frame the instant
    // the socket opens, i.e. *during* the auth round-trip. Frames that land
    // pre-auth are buffered here and drained the moment we're authenticated.
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

    // Authenticate (async). Browsers can't set WS headers, so the admin token
    // rides in the query string: ws://host/ws/camera-ingest?token=<token>
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
  if (ws.started) return; // already broadcasting on this socket

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

  const session = await LiveSession.findOne({ streamId })
    .select("streamId rtmpUrl status")
    .lean();
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

  // MediaRecorder gives us WebM (VP8/Opus). Transcode to FLV/H.264+AAC and push
  // RTMP — same encoder settings as scripts/go-live-from-camera.ts.
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
