import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { Customer } from "../models/customer/Customer.model";
import { LiveChatMessage } from "../models/course/LiveChatMessage.model";
import { LivePoll } from "../models/course/LivePoll.model";
import { LivePollVote } from "../models/course/LivePollVote.model";
import { redisClient } from "../config/redis";
import logger from "../utils/logger";

// Exported so admin HTTP controllers can broadcast poll events into rooms
export let io: SocketServer;

interface AuthenticatedSocket extends Socket {
  customerId?: string;
  userName?: string;
}

export function roomKey(liveClassId: string) {
  return `live_chat:${liveClassId}`;
}

async function authenticateSocket(token: string): Promise<{ customerId: string; userName: string } | null> {
  try {
    const secret = process.env.JWT_ACCESS_SECRET as string;
    const decoded = jwt.verify(token, secret) as any;

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
    next();
  });

  io.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("Live chat: client connected", { socketId: socket.id, customerId: socket.customerId });

    // ── Join room ─────────────────────────────────────────────────────────────
    socket.on("join_live_chat", async ({ liveClassId }: { liveClassId: string }) => {
      if (!liveClassId || typeof liveClassId !== "string" || !liveClassId.trim()) {
        socket.emit("error", { message: "liveClassId is required" });
        return;
      }

      socket.join(roomKey(liveClassId));

      try {
        const history = await LiveChatMessage.find({ liveClassId })
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
      if (!liveClassId || typeof liveClassId !== "string") {
        socket.emit("error", { message: "liveClassId is required" }); return;
      }
      const text = typeof message === "string" ? message.trim() : "";
      if (!text) { socket.emit("error", { message: "Message cannot be empty" }); return; }
      if (text.length > 2000) { socket.emit("error", { message: "Message too long (max 2000 characters)" }); return; }

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
    socket.on("leave_live_chat", ({ liveClassId }: { liveClassId: string }) => {
      if (liveClassId) socket.leave(roomKey(liveClassId));
    });

    socket.on("disconnect", () => {
      logger.info("Live chat: client disconnected", { socketId: socket.id, customerId: socket.customerId });
    });
  });

  return io;
}
