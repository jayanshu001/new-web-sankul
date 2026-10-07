// Live chat: shared Socket.io server for live-class chat, polls, presence and attendance.
import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { verifyAccessToken } from "../utils/jwtSigner";
import { resolveLiveClassId } from "../admin/live/live.guards";
import { redisClient } from "../config/redis";
import logger from "../utils/logger";
import { customerAuthRepository } from "../modules/customer-auth/customer-auth.repository";
// chat/ban/poll persist via admin-live-course.service; attendance/session via admin-live.service.
import * as liveCourseSql from "../modules/admin-live-course/admin-live-course.service";
import * as adminLiveSql from "../modules/admin-live/admin-live.service";

// Exported so admin HTTP controllers can broadcast into rooms.
export let io: SocketServer;

interface AuthenticatedSocket extends Socket {
  customerId?: string;
  userName?: string;
  // Admin sockets join rooms read-only: they receive live events but cannot vote or post.
  isAdmin?: boolean;
  // The live class this socket is currently in, plus its open attendance row.
  liveRoom?: string;
  attendanceId?: string;
}

export function roomKey(liveClassId: string) {
  return `live_chat:${liveClassId}`;
}

// Emits `chat_banned` to every socket of this customer, then disconnects them so the UI
// flips to the banned view. Cluster-wide: RemoteSocket.disconnect() routes to the owning pod.
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

// Emits `chat_unbanned` to every socket of this customer (cluster-wide) to re-enable input.
export async function emitChatUnbannedForCustomer(customerId: string): Promise<void> {
  if (!io) return;
  try {
    const sockets = await io.fetchSockets();
    for (const s of sockets) {
      const cid = (s.data?.customerId as string | undefined) ?? (s as any).customerId;
      if (cid !== customerId) continue;
      s.emit("chat_unbanned", {
        message: "You can send messages again.",
        unbannedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.warn("emitChatUnbannedForCustomer failed", {
      customerId,
      err: (err as Error).message,
    });
  }
}

// Distinct customers in a room (two tabs count once). With the Redis adapter,
// fetchSockets() spans every pod; without it the count would be this pod's only.
export async function viewerCount(liveClassId: string): Promise<number> {
  if (!io) return 0;
  try {
    const sockets = await io.in(roomKey(liveClassId)).fetchSockets();
    const customers = new Set<string>();
    for (const s of sockets) {
      const cid = (s.data?.customerId as string | undefined) ?? (s as any).customerId;
      // Admin watchers (customerId "admin:<id>") don't count as viewers.
      if (cid && !cid.startsWith("admin:")) customers.add(cid);
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

// `viewer_stats` for the admin Viewers tab: active = in-room now (= viewer_count.count),
// unique = distinct joiners this session, joins = total join events. liveClassId is the
// attendance streamId. Best-effort: a stats failure must never break presence, so
// viewer_count is emitted separately.
async function emitViewerStats(liveClassId: string) {
  if (!io) return;
  try {
    const [active, counts] = await Promise.all([
      viewerCount(liveClassId),
      adminLiveSql.getViewerStatsCounts(liveClassId),
    ]);
    io.to(roomKey(liveClassId)).emit("viewer_stats", {
      active,
      unique: counts.unique,
      joins: counts.joins,
    });
  } catch (err) {
    logger.warn("viewer_stats emit failed", { liveClassId, err: (err as Error).message });
  }
}

// Private-chat viewer message: never fans out to other viewers; goes to every admin
// socket in the room (moderation) and echoes to the sender. Cluster-wide.
async function emitPrivateViewerMessage(
  liveClassId: string,
  senderSocket: AuthenticatedSocket,
  payload: Record<string, any>
) {
  if (!io) return;
  senderSocket.emit("new_message", payload);
  try {
    const sockets = await io.in(roomKey(liveClassId)).fetchSockets();
    for (const s of sockets) {
      const isAdmin = (s.data?.isAdmin as boolean | undefined) ?? false;
      if (isAdmin && s.id !== senderSocket.id) s.emit("new_message", payload);
    }
  } catch (err) {
    logger.warn("private-chat admin fan-out failed", { liveClassId, err: (err as Error).message });
  }
}

/**
 * Host message (posted over REST) while chat is private. Private mode hides students
 * from each other, not the host from the class: addressed (targetCustomerId) → that
 * student + every admin; unaddressed → the whole room, like a public message.
 */
export async function emitPrivateAdminMessage(
  liveClassId: string,
  targetCustomerId: string | null,
  payload: Record<string, any>
): Promise<void> {
  if (!io) return;
  if (!targetCustomerId) {
    io.to(roomKey(liveClassId)).emit("new_message", payload);
    return;
  }
  try {
    const sockets = await io.in(roomKey(liveClassId)).fetchSockets();
    for (const s of sockets) {
      const isAdmin = (s.data?.isAdmin as boolean | undefined) ?? false;
      const cid = s.data?.customerId as string | undefined;
      if (isAdmin || cid === targetCustomerId) s.emit("new_message", payload);
    }
  } catch (err) {
    logger.warn("private-chat admin message fan-out failed", { liveClassId, err: (err as Error).message });
  }
}

// History is served one mode at a time. Both modes live in ws_live_chat_message (by
// is_private) and survive a toggle, which only replaces what clients render. A joiner
// gets the full thread for the current mode so a late joiner sees the same timeline.
// ponytail: flat cap, no pagination. A class that ever exceeds this needs a
// windowed `before` fetch on the socket path like the REST endpoint already has.
const MAX_CHAT_HISTORY = 1000;

/**
 * Public mode: the whole public timeline. Private mode: admins get the entire thread;
 * a viewer gets their own messages, host replies addressed to them, and unaddressed
 * host messages. An unparseable viewer id gets an empty list (fail closed), never the
 * unscoped thread.
 */
async function historyForViewer(
  liveClassId: string,
  privateChat: boolean,
  isAdmin: boolean,
  customerId: string | undefined
) {
  if (!privateChat) {
    return liveCourseSql.getChatHistory(liveClassId, MAX_CHAT_HISTORY, undefined, { isPrivate: false });
  }
  if (isAdmin) {
    return liveCourseSql.getChatHistory(liveClassId, MAX_CHAT_HISTORY, undefined, { isPrivate: true });
  }
  const viewerId = liveCourseSql.parseLiveId(String(customerId));
  if (viewerId == null) return [];
  return liveCourseSql.getChatHistory(liveClassId, MAX_CHAT_HISTORY, undefined, { isPrivate: true, viewerId });
}

/**
 * Pushes a mode-scoped `chat_history` (a full replace on clients) after `chat_settings`
 * on a toggle. Private mode is one query filtered per socket in memory, not one per student.
 */
export async function broadcastChatHistoryForMode(
  liveClassId: string,
  privateChat: boolean
): Promise<void> {
  if (!io) return;
  try {
    if (!privateChat) {
      const messages = await liveCourseSql.getChatHistory(liveClassId, MAX_CHAT_HISTORY, undefined, { isPrivate: false });
      io.to(roomKey(liveClassId)).emit("chat_history", { liveClassId, privateChat: false, messages });
      return;
    }

    const all = await liveCourseSql.getChatHistory(liveClassId, MAX_CHAT_HISTORY, undefined, { isPrivate: true });
    const sockets = await io.in(roomKey(liveClassId)).fetchSockets();
    for (const sock of sockets) {
      const isAdmin = (sock.data?.isAdmin as boolean | undefined) ?? false;
      const cid = sock.data?.customerId as string | undefined;
      // Same three-way rule as the query in chatHistory: own messages, replies
      // addressed to me, and host messages addressed to nobody.
      const messages = isAdmin
        ? all
        : all.filter(
            (m: any) =>
              m.customerId === cid ||
              m.targetCustomerId === cid ||
              (m.isAdmin && m.targetCustomerId === null)
          );
      sock.emit("chat_history", { liveClassId, privateChat: true, messages });
    }
  } catch (err) {
    logger.error("chat_history mode broadcast failed", { liveClassId, privateChat, error: (err as Error).message });
  }
}

// Best-effort.
async function openAttendance(socket: AuthenticatedSocket, liveClassId: string) {
  try {
    socket.attendanceId = await adminLiveSql.openAttendanceSql({
      streamId: liveClassId,
      customerId: adminLiveSql.parseAlId(String(socket.customerId)),
      userName: socket.userName ?? "",
    });
    socket.liveRoom = liveClassId;
  } catch (err) {
    logger.error("Live attendance: open failed", { liveClassId, error: (err as Error).message });
  }
}

// Idempotent.
async function closeAttendance(socket: AuthenticatedSocket) {
  const id = socket.attendanceId;
  socket.attendanceId = undefined;
  if (!id) return;
  try {
    const nid = adminLiveSql.parseAlId(id);
    if (nid != null) await adminLiveSql.closeAttendanceSql(nid, new Date());
  } catch (err) {
    logger.error("Live attendance: close failed", { attendanceId: id, error: (err as Error).message });
  }
}

// Customer, or read-only admin, handshake auth; null rejects the connection.
async function authenticateSocket(
  token: string
): Promise<{ customerId: string; userName: string; isAdmin: boolean } | null> {
  try {
    const decoded = verifyAccessToken<any>(token);

    // Admin tokens join read-only: no customer lookup, barred from submit_vote / send_message.
    if (decoded.type === "admin") {
      // Same 1-active-device rule as REST `authenticate` + camera-ingest.
      const activeAdminToken = await redisClient.get(`admin_session:${decoded.id}`);
      if (!activeAdminToken || activeAdminToken !== token) {
        logger.warn("Live chat auth rejected: admin single-device session pointer mismatch", {
          id: decoded.id, pointerPresent: !!activeAdminToken, tokenTail: token.slice(-6),
        });
        return null;
      }
      const adminName = (decoded.email as string) || `Admin_${String(decoded.id).slice(-4)}`;
      return { customerId: `admin:${decoded.id}`, userName: adminName, isAdmin: true };
    }

    if (decoded.type !== "customer") {
      logger.warn("Live chat auth rejected: token type is not customer/admin", {
        type: decoded.type, id: decoded.id, tokenTail: token.slice(-6),
      });
      return null;
    }

    // Mirrors the `customer_session` pointer check in middlewares/authenticate.ts.
    const activeToken = await redisClient.get(`customer_session:${decoded.id}`);
    if (!activeToken || activeToken !== token) {
      logger.warn("Live chat auth rejected: single-device session pointer mismatch", {
        id: decoded.id,
        pointerPresent: !!activeToken,
        pointerMatches: activeToken === token,
        pointerTail: activeToken ? activeToken.slice(-6) : null,
        tokenTail: token.slice(-6),
      });
      return null;
    }

    const numId = Number(decoded.id);
    if (!Number.isInteger(numId) || numId <= 0) {
      logger.warn("Live chat auth rejected: non-numeric id on MySQL backend", { id: decoded.id });
      return null;
    }
    // findLoginableById already filters status=true & not deleted.
    const row = await customerAuthRepository.findLoginableById(numId);
    if (!row) {
      logger.warn("Live chat auth rejected: customer not found/disabled in MySQL", { id: decoded.id });
      return null;
    }
    const userName = (row.fullName ?? "").trim() || `User_${decoded.id.slice(-4)}`;

    return { customerId: decoded.id, userName, isAdmin: false };
  } catch (err) {
    logger.warn("Live chat auth rejected: token verify threw", {
      error: (err as Error).message, tokenTail: token.slice(-6),
    });
    return null;
  }
}

// Creates the shared Socket.io server (Redis adapter) and wires the live-chat events.
export function initLiveChatSocket(httpServer: HttpServer, allowedOrigins: string[]) {
  io = new SocketServer(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
    path: "/socket.io",
    transports: ["websocket", "polling"],
  });

  // Redis adapter so broadcasts reach sockets on every pod. Pub/sub needs dedicated
  // connections (a subscribed connection can't run other commands), so duplicate the
  // shared client rather than block its cache/session traffic.
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

  io.use(async (socket: AuthenticatedSocket, next) => {
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.headers?.authorization as string)?.replace("Bearer ", "");

    if (!token) return next(new Error("Authentication token required"));

    const auth = await authenticateSocket(token);
    if (!auth) return next(new Error("Invalid or expired token"));

    socket.customerId = auth.customerId;
    socket.userName = auth.userName;
    socket.isAdmin = auth.isAdmin;
    // socket.data is what cross-pod fetchSockets() can see (RemoteSocket).
    socket.data.customerId = auth.customerId;
    socket.data.userName = auth.userName;
    socket.data.isAdmin = auth.isAdmin;
    next();
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("Live chat: client connected", { socketId: socket.id, customerId: socket.customerId });

    socket.on("join_live_chat", async ({ liveClassId }: { liveClassId: string }) => {
      const streamId = await resolveLiveClassId(liveClassId);
      if (!streamId) {
        socket.emit("error", { message: "No live session for this id" });
        return;
      }

      if (socket.liveRoom && socket.liveRoom !== liveClassId) {
        const prev = socket.liveRoom;
        socket.leave(roomKey(prev));
        await closeAttendance(socket);
        socket.liveRoom = undefined;
        if (!socket.isAdmin) {
          io.to(roomKey(prev)).emit("user_left", {
            liveClassId: prev,
            customerId: socket.customerId,
            userName: socket.userName,
            leftAt: new Date().toISOString(),
          });
        }
        io.to(roomKey(prev)).emit("viewer_count", { liveClassId: prev, count: await viewerCount(prev) });
        await emitViewerStats(prev);
      }

      socket.join(roomKey(liveClassId));
      // Admins watch read-only: no attendance row, no presence broadcast.
      if (!socket.isAdmin) {
        await openAttendance(socket, liveClassId);
      } else {
        socket.liveRoom = liveClassId;
      }

      try {
        const settings = await liveCourseSql.getChatSettings(liveClassId);
        socket.emit("chat_settings", settings);
      } catch (err) {
        logger.warn("chat_settings emit on join failed", { liveClassId, err: (err as Error).message });
      }

      try {
        // Reuse `settings` from above so the settings and listing a client gets share a mode.
        const mode = await liveCourseSql.getChatSettings(liveClassId);
        const history = await historyForViewer(liveClassId, mode.privateChat, !!socket.isAdmin, socket.customerId);
        socket.emit("chat_history", { liveClassId, privateChat: mode.privateChat, messages: history });
        logger.info("Live chat: user joined", { room: roomKey(liveClassId), customerId: socket.customerId, privateChat: mode.privateChat, messages: history.length });
      } catch (err) {
        logger.error("Live chat: history load failed", { liveClassId, error: (err as Error).message });
      }

      try {
        const cid = liveCourseSql.parseLiveId(String(socket.customerId));
        const r = await liveCourseSql.getActivePoll(liveClassId, cid ?? 0);
        if (r.poll) {
          socket.emit("active_poll", { poll: r.poll, myVote: r.myVote });
        }
      } catch (err) {
        logger.error("Live chat: active poll load failed", { liveClassId, error: (err as Error).message });
      }

      // Admins are invisible watchers; announce real viewers only.
      if (!socket.isAdmin) {
        io.to(roomKey(liveClassId)).emit("user_joined", {
          liveClassId,
          customerId: socket.customerId,
          userName: socket.userName,
          joinedAt: new Date().toISOString(),
        });
      }
      io.to(roomKey(liveClassId)).emit("viewer_count", {
        liveClassId,
        count: await viewerCount(liveClassId),
      });
      await emitViewerStats(liveClassId);
    });

    socket.on("submit_vote", async ({ pollId, optionIndex }: { pollId: string; optionIndex: number }) => {
      if (socket.isAdmin) {
        socket.emit("error", { message: "Admins cannot vote" });
        return;
      }
      if (!pollId || typeof optionIndex !== "number") {
        socket.emit("error", { message: "pollId and optionIndex are required" });
        return;
      }

      try {
        const pid = liveCourseSql.parseLiveId(String(pollId));
        const cid = liveCourseSql.parseLiveId(String(socket.customerId));
        if (pid == null) { socket.emit("error", { message: "Poll not found" }); return; }
        if (cid == null) { socket.emit("error", { message: "Failed to submit vote" }); return; }
        const r = await liveCourseSql.submitPollVote(pid, cid, optionIndex);
        if (r === "not_found") { socket.emit("error", { message: "Poll not found" }); return; }
        if (r === "closed") { socket.emit("error", { message: "Poll is closed" }); return; }
        if (r === "invalid_option") { socket.emit("error", { message: "Invalid option" }); return; }
        // The FE disables options after voting; this guards modified clients and races.
        if (r === "already_voted") { socket.emit("error", { message: "You have already voted on this poll." }); return; }

        // Full poll so tallies re-render in place. The FE expects different shapes per
        // event: poll_update = the raw poll, poll_updated = a { poll } envelope (as the
        // admin updatePoll controller emits). Sending raw on poll_updated breaks re-voting.
        io.to(roomKey(r.liveClassId)).emit("poll_update", r);
        io.to(roomKey(r.liveClassId)).emit("poll_updated", { poll: r });
        logger.info("Live poll: vote recorded", { pollId, optionIndex, customerId: socket.customerId });
      } catch (err: any) {
        logger.error("Live poll: vote failed", { pollId, error: err.message });
        socket.emit("error", { message: "Failed to submit vote" });
      }
    });

    socket.on("send_message", async ({ liveClassId, message }: { liveClassId: string; message: string }) => {
      if (socket.isAdmin) {
        socket.emit("error", { message: "Admins cannot send chat messages" });
        return;
      }
      const streamId = await resolveLiveClassId(liveClassId);
      if (!streamId) {
        socket.emit("error", { message: "No live session for this id" }); return;
      }
      const text = typeof message === "string" ? message.trim() : "";
      if (!text) { socket.emit("error", { message: "Message cannot be empty" }); return; }
      if (text.length > 2000) { socket.emit("error", { message: "Message too long (max 2000 characters)" }); return; }

      // Same chat-ban enforcement as the HTTP path.
      const banCustId = liveCourseSql.parseLiveId(String(socket.customerId));
      const banned = banCustId != null && (await liveCourseSql.isCustomerChatBanned(banCustId));
      if (banned) {
        socket.emit("chat_banned", { message: "You are blocked from sending messages." });
        return;
      }

      // Enforced server-side, never trusted from the client. chatEnabled=false blocks
      // viewer sends (admins post via REST); privateChat=true skips the public fan-out.
      const chatSettings = await liveCourseSql.getChatSettings(liveClassId);
      if (!chatSettings.chatEnabled) {
        socket.emit("chat_disabled", { liveClassId, message: "Chat is currently disabled by the host." });
        return;
      }

      try {
        const saved = await liveCourseSql.sendCustomerChatMessage({
          liveClassId,
          customerId: banCustId,
          userName: socket.userName!,
          message: text,
          // Stored so the private thread replays after a toggle or reconnect.
          isPrivate: chatSettings.privateChat,
        });
        const messagePayload = {
          _id: saved._id,
          liveClassId,
          customerId: socket.customerId,
          userName: socket.userName,
          // Same shape as the admin path and history DTO.
          isAdmin: false,
          role: null,
          message: text,
          // Lets a client route the event, or drop a cross-mode one.
          isPrivate: chatSettings.privateChat,
          targetCustomerId: null,
          createdAt: saved.createdAt,
        };
        if (chatSettings.privateChat) {
          await emitPrivateViewerMessage(liveClassId, socket, messagePayload);
        } else {
          io.to(roomKey(liveClassId)).emit("new_message", messagePayload);
        }
        logger.info("Live chat: message sent", { liveClassId, customerId: socket.customerId, privateChat: chatSettings.privateChat });
      } catch (err) {
        logger.error("Live chat: message save failed", { liveClassId, error: (err as Error).message });
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("leave_live_chat", async ({ liveClassId }: { liveClassId: string }) => {
      if (!liveClassId) return;
      socket.leave(roomKey(liveClassId));
      await closeAttendance(socket);
      if (socket.liveRoom === liveClassId) socket.liveRoom = undefined;
      if (!socket.isAdmin) {
        io.to(roomKey(liveClassId)).emit("user_left", {
          liveClassId,
          customerId: socket.customerId,
          userName: socket.userName,
          leftAt: new Date().toISOString(),
        });
      }
      io.to(roomKey(liveClassId)).emit("viewer_count", {
        liveClassId,
        count: await viewerCount(liveClassId),
      });
      await emitViewerStats(liveClassId);
    });

    socket.on("disconnect", async () => {
      // socket.io has already removed this socket from its rooms, so viewerCount() excludes it.
      if (socket.liveRoom) {
        const room = socket.liveRoom;
        socket.liveRoom = undefined;
        await closeAttendance(socket);
        if (!socket.isAdmin) {
          io.to(roomKey(room)).emit("user_left", {
            liveClassId: room,
            customerId: socket.customerId,
            userName: socket.userName,
            leftAt: new Date().toISOString(),
          });
        }
        io.to(roomKey(room)).emit("viewer_count", { liveClassId: room, count: await viewerCount(room) });
        await emitViewerStats(room);
      }
      logger.info("Live chat: client disconnected", { socketId: socket.id, customerId: socket.customerId });
    });
  });

  return io;
}
