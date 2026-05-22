import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { verifyAccessToken } from "../utils/jwtSigner";
import { Types } from "mongoose";
import { Customer } from "../models/customer/Customer.model";
import { LiveChatMessage } from "../models/course/LiveChatMessage.model";
import { LiveChatBan } from "../models/course/LiveChatBan.model";
import { LivePoll } from "../models/course/LivePoll.model";
import { LivePollVote } from "../models/course/LivePollVote.model";
import { LiveSession } from "../models/course/LiveSession.model";
import { LiveSessionAttendance } from "../models/customer/LiveSessionAttendance.model";
import { resolveLiveClassId } from "../admin/live/live.guards";
import { redisClient } from "../config/redis";
import logger from "../utils/logger";

// Exported so admin HTTP controllers can broadcast poll events into rooms
export let io: SocketServer;

interface AuthenticatedSocket extends Socket {
  customerId?: string;
  userName?: string;
  // The live class this socket is currently in, plus its open attendance row.
  liveRoom?: string;
  attendanceId?: string;
}

export function roomKey(liveClassId: string) {
  return `live_chat:${liveClassId}`;
}

// Called by the admin ban endpoint. Emits `chat_banned` to every live socket
// belonging to this customer, then disconnects them so any in-flight UI state
// flips to the banned view without a refresh. Cluster-wide via the Redis
// adapter — fetchSockets() returns RemoteSocket objects from other pods, but
// RemoteSocket.disconnect() is supported and routes back to the owning pod.
export async function disconnectChatSocketsForCustomer(
  customerId: string,
  payload: { reason?: string } = {}
): Promise<void> {
  if (!io) return;
  try {
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      const cid = (s.data?.customerId as string | undefined) ?? (s as any).customerId;
      if (cid !== customerId) continue;
      s.emit("chat_banned", {
        message: "You are blocked from sending messages.",
        reason: payload.reason ?? null,
      });
      s.disconnect(true);
    }
  } catch (err) {
    logger.warn("disconnectChatSocketsForCustomer failed", {
      customerId,
      err: (err as Error).message,
    });
  }
}

// Distinct customers currently in a live class room — a customer with two tabs
// counts once. Uses Socket.io's `fetchSockets({})` which, with the Redis
// adapter attached, queries EVERY pod in the cluster and returns the union
// of socket metadata. Without the adapter this would only count sockets on
// the current pod, giving the wrong "now watching" number in production.
async function viewerCount(liveClassId: string): Promise<number> {
  if (!io) return 0;
  try {
    const sockets = await io.in(roomKey(liveClassId)).fetchSockets();
    const customers = new Set<string>();
    for (const s of sockets) {
      const cid = (s.data?.customerId as string | undefined) ?? (s as any).customerId;
      if (cid) customers.add(cid);
    }
    return customers.size;
  } catch (err) {
    logger.warn("viewerCount fetchSockets failed", {
      liveClassId,
      err: (err as Error).message,
    });
    return 0;
  }
}

// Open an attendance row for this socket's stint in a live class. Best-effort.
async function openAttendance(socket: AuthenticatedSocket, liveClassId: string) {
  try {
    const session = await LiveSession.findOne({ streamId: liveClassId }).select("_id").lean();
    const rec = await LiveSessionAttendance.create({
      streamId: liveClassId,
      liveSessionId: session?._id ?? null,
      customerId: new Types.ObjectId(socket.customerId!),
      userName: socket.userName ?? "",
      joinedAt: new Date(),
    });
    socket.attendanceId = String(rec._id);
    socket.liveRoom = liveClassId;
  } catch (err) {
    logger.error("Live attendance: open failed", { liveClassId, error: (err as Error).message });
  }
}

// Close this socket's open attendance row (idempotent — no-op if already closed).
async function closeAttendance(socket: AuthenticatedSocket) {
  const id = socket.attendanceId;
  socket.attendanceId = undefined;
  if (!id) return;
  try {
    const rec = await LiveSessionAttendance.findById(id);
    if (rec && !rec.leftAt) {
      rec.leftAt = new Date();
      rec.durationSec = Math.max(
        0,
        Math.round((rec.leftAt.getTime() - rec.joinedAt.getTime()) / 1000)
      );
      await rec.save();
    }
  } catch (err) {
    logger.error("Live attendance: close failed", { attendanceId: id, error: (err as Error).message });
  }
}

async function authenticateSocket(token: string): Promise<{ customerId: string; userName: string } | null> {
  try {
    // Keyring-aware verify so socket auth survives JWT key rotation alongside
    // HTTP requests. See utils/jwtSigner.ts + config/jwtKeys.ts.
    const decoded = verifyAccessToken<any>(token);

    if (decoded.type !== "customer") return null;

    const activeToken = await redisClient.get(`customer_session:${decoded.id}`);
    if (!activeToken || activeToken !== token) return null;

    const customer = await Customer.findById(decoded.id)
      .select("firstName middleName lastName status isAccountDeleted")
      .lean();
    if (!customer || !customer.status || customer.isAccountDeleted) return null;

    const parts = [customer.firstName, customer.middleName, customer.lastName].filter(Boolean);
    const userName = parts.length > 0 ? parts.join(" ") : `User_${decoded.id.slice(-4)}`;

    return { customerId: decoded.id, userName };
  } catch {
    return null;
  }
}

export function initLiveChatSocket(httpServer: HttpServer, allowedOrigins: string[]) {
  io = new SocketServer(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  // Redis adapter for multi-pod broadcasting. Without this, a chat message
  // sent through pod A's socket never reaches viewers connected to pod B —
  // each pod's in-memory Adapter only knows about its own sockets.
  //
  // Dedicated pub/sub connections: Redis pub/sub mode blocks a connection
  // from issuing other commands while subscribed, so reusing the shared
  // `redisClient` (which serves cache/session/breaker traffic) would lock
  // those reads. ioredis's .duplicate() preserves the host/port/password/
  // retry config of the shared client without duplicating that wiring.
  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  pubClient.on("error", (err) =>
    logger.error("Socket.io pub client error", { err: (err as Error).message })
  );
  subClient.on("error", (err) =>
    logger.error("Socket.io sub client error", { err: (err as Error).message })
  );
  io.adapter(createAdapter(pubClient, subClient));
  logger.info("Live chat: Socket.io Redis adapter attached.");

  // Only customer tokens are accepted — admin manages polls via REST API
  io.use(async (socket: AuthenticatedSocket, next) => {
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.headers?.authorization as string)?.replace("Bearer ", "");

    if (!token) return next(new Error("Authentication token required"));

    const auth = await authenticateSocket(token);
    if (!auth) return next(new Error("Invalid or expired token"));

    socket.customerId = auth.customerId;
    socket.userName = auth.userName;
    // Also stash on socket.data so the Redis adapter's fetchSockets() can
    // see the customerId on RemoteSocket objects from OTHER pods. Local
    // socket reads continue to use socket.customerId; only cross-pod reads
    // need socket.data.
    socket.data.customerId = auth.customerId;
    socket.data.userName = auth.userName;
    next();
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("Live chat: client connected", { socketId: socket.id, customerId: socket.customerId });

    // ── Join room ─────────────────────────────────────────────────────────────
    socket.on("join_live_chat", async ({ liveClassId }: { liveClassId: string }) => {
      const streamId = await resolveLiveClassId(liveClassId);
      if (!streamId) {
        socket.emit("error", { message: "No live session for this id" });
        return;
      }

      // If this socket was already in another live room, cleanly leave it first
      // (close its attendance row, notify that room).
      if (socket.liveRoom && socket.liveRoom !== liveClassId) {
        const prev = socket.liveRoom;
        socket.leave(roomKey(prev));
        await closeAttendance(socket);
        socket.liveRoom = undefined;
        io.to(roomKey(prev)).emit("user_left", {
          liveClassId: prev,
          customerId: socket.customerId,
          userName: socket.userName,
          leftAt: new Date().toISOString(),
        });
        io.to(roomKey(prev)).emit("viewer_count", { liveClassId: prev, count: await viewerCount(prev) });
      }

      socket.join(roomKey(liveClassId));
      await openAttendance(socket, liveClassId);

      try {
        const history = await LiveChatMessage.find({ liveClassId, deletedAt: null })
          .sort({ createdAt: 1 })
          .limit(50)
          .select("customerId adminId isAdmin userName message createdAt")
          .lean();
        socket.emit("chat_history", { liveClassId, messages: history });
        logger.info("Live chat: user joined", { room: roomKey(liveClassId), customerId: socket.customerId });
      } catch (err) {
        logger.error("Live chat: history load failed", { liveClassId, error: (err as Error).message });
      }

      // Send active poll to the joining user (if one exists)
      try {
        const activePoll = await LivePoll.findOne({ liveClassId, isActive: true })
          .select("question options totalVotes createdByName createdAt")
          .lean();

        if (activePoll) {
          const existingVote = await LivePollVote.findOne({
            pollId: activePoll._id,
            customerId: new Types.ObjectId(socket.customerId!),
          }).lean();

          socket.emit("active_poll", {
            poll: activePoll,
            myVote: existingVote ? existingVote.optionIndex : null,
          });
        }
      } catch (err) {
        logger.error("Live chat: active poll load failed", { liveClassId, error: (err as Error).message });
      }

      // ── Presence: tell the room someone joined + the new viewer count ──────
      io.to(roomKey(liveClassId)).emit("user_joined", {
        liveClassId,
        customerId: socket.customerId,
        userName: socket.userName,
        joinedAt: new Date().toISOString(),
      });
      io.to(roomKey(liveClassId)).emit("viewer_count", {
        liveClassId,
        count: await viewerCount(liveClassId),
      });
    });

    // ── Vote on a poll (students only) ────────────────────────────────────────
    socket.on("submit_vote", async ({ pollId, optionIndex }: { pollId: string; optionIndex: number }) => {
      if (!pollId || typeof optionIndex !== "number") {
        socket.emit("error", { message: "pollId and optionIndex are required" });
        return;
      }

      try {
        const poll = await LivePoll.findById(pollId);
        if (!poll) { socket.emit("error", { message: "Poll not found" }); return; }
        if (!poll.isActive) { socket.emit("error", { message: "Poll is closed" }); return; }
        if (optionIndex < 0 || optionIndex >= poll.options.length) {
          socket.emit("error", { message: "Invalid option" }); return;
        }

        // Unique index on {pollId, customerId} prevents double voting
        await LivePollVote.create({
          pollId: new Types.ObjectId(pollId),
          customerId: new Types.ObjectId(socket.customerId!),
          optionIndex,
        });

        const updated = await LivePoll.findByIdAndUpdate(
          pollId,
          { $inc: { [`options.${optionIndex}.votes`]: 1, totalVotes: 1 } },
          { new: true }
        ).select("options totalVotes").lean();

        if (!updated) return;

        // Broadcast live counts to everyone in the room
        io.to(roomKey(poll.liveClassId)).emit("poll_update", {
          pollId,
          options: updated.options,
          totalVotes: updated.totalVotes,
        });

        logger.info("Live poll: vote recorded", { pollId, optionIndex, customerId: socket.customerId });
      } catch (err: any) {
        if (err?.code === 11000) {
          socket.emit("error", { message: "You have already voted on this poll" });
        } else {
          logger.error("Live poll: vote failed", { pollId, error: err.message });
          socket.emit("error", { message: "Failed to submit vote" });
        }
      }
    });

    // ── Send chat message ─────────────────────────────────────────────────────
    socket.on("send_message", async ({ liveClassId, message }: { liveClassId: string; message: string }) => {
      const streamId = await resolveLiveClassId(liveClassId);
      if (!streamId) {
        socket.emit("error", { message: "No live session for this id" }); return;
      }
      const text = typeof message === "string" ? message.trim() : "";
      if (!text) { socket.emit("error", { message: "Message cannot be empty" }); return; }
      if (text.length > 2000) { socket.emit("error", { message: "Message too long (max 2000 characters)" }); return; }

      // Global chat ban — same enforcement as the http path. Reject early and
      // let the client render the "you're banned" state.
      const banned = await LiveChatBan.exists({ customerId: socket.customerId });
      if (banned) {
        socket.emit("chat_banned", { message: "You are blocked from sending messages." });
        return;
      }

      try {
        const saved = await LiveChatMessage.create({
          liveClassId,
          customerId: new Types.ObjectId(socket.customerId!),
          userName: socket.userName!,
          message: text,
        });

        io.to(roomKey(liveClassId)).emit("new_message", {
          _id: saved._id,
          liveClassId,
          customerId: socket.customerId,
          userName: socket.userName,
          message: text,
          createdAt: saved.createdAt,
        });

        logger.info("Live chat: message sent", { liveClassId, customerId: socket.customerId });
      } catch (err) {
        logger.error("Live chat: message save failed", { liveClassId, error: (err as Error).message });
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // ── Leave room ────────────────────────────────────────────────────────────
    socket.on("leave_live_chat", async ({ liveClassId }: { liveClassId: string }) => {
      if (!liveClassId) return;
      socket.leave(roomKey(liveClassId));
      await closeAttendance(socket);
      if (socket.liveRoom === liveClassId) socket.liveRoom = undefined;
      io.to(roomKey(liveClassId)).emit("user_left", {
        liveClassId,
        customerId: socket.customerId,
        userName: socket.userName,
        leftAt: new Date().toISOString(),
      });
      io.to(roomKey(liveClassId)).emit("viewer_count", {
        liveClassId,
        count: await viewerCount(liveClassId),
      });
    });

    socket.on("disconnect", async () => {
      // If still in a live room, close the attendance row and notify the room.
      // By the time `disconnect` fires, socket.io has already removed this
      // socket from its rooms, so viewerCount() below already excludes it.
      if (socket.liveRoom) {
        const room = socket.liveRoom;
        socket.liveRoom = undefined;
        await closeAttendance(socket);
        io.to(roomKey(room)).emit("user_left", {
          liveClassId: room,
          customerId: socket.customerId,
          userName: socket.userName,
          leftAt: new Date().toISOString(),
        });
        io.to(roomKey(room)).emit("viewer_count", { liveClassId: room, count: await viewerCount(room) });
      }
      logger.info("Live chat: client disconnected", { socketId: socket.id, customerId: socket.customerId });
    });
  });

  return io;
}
