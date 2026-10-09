// Live courses: class reminders, live chat (history, bans, settings) and polls.
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import { adminAuthRepository } from "../admin-auth/admin-auth.repository";
import { deriveRole } from "../admin-auth/admin-auth.transformer";
import { idStrOrNull } from "./live-course.shared";

const toReminderDto = (r: any, session?: any) => ({
  id: String(r.id),
  liveSessionId: idStrOrNull(r.liveSessionId),
  liveCourseId: idStrOrNull(r.liveCourseId),
  minutesBefore: r.minutesBefore,
  remindAt: r.remindAt ?? null,
  sessionScheduledAt: r.sessionScheduledAt ?? null,
  status: r.status ?? null,
  ...(session ? { session: { _id: String(session.id), title: session.title ?? null, scheduledAt: session.scheduledAt ?? null, status: session.status, subject: session.subject ?? "", streamId: session.streamId ?? null } } : {}),
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

export const listRemindersForCustomer = async (customerId: number) => {
  const rows = await repo.remindersForCustomer(customerId);
  const sessions = new Map((await repo.sessionsByIds([...new Set(rows.map((r) => r.liveSessionId).filter((x): x is number => x != null))])).map((s) => [s.id, s]));
  return rows.map((r) => toReminderDto(r, r.liveSessionId != null ? sessions.get(r.liveSessionId) : undefined));
};

export const getReminderForSession = async (customerId: number, liveSessionId: number) => {
  const r = await repo.reminderForSession(customerId, liveSessionId);
  if (!r) return null;
  const s = (await repo.sessionsByIds([liveSessionId]))[0];
  return toReminderDto(r, s);
};

// `isAdmin` + `role` let the FE style admin messages identically on history reload and
// live `new_message`. No stored role column (only is_admin + admin_id), so `role` is
// resolved from the admin's current spatie roles at read time; customers get null.
const toChatMessageDto = (m: any, role: string | null = null) => ({ _id: String(m.id), customerId: idStrOrNull(m.customerId), userName: m.userName ?? null, message: m.message ?? null, isAdmin: !!m.isAdmin, role: m.isAdmin ? role : null, isPrivate: !!m.isPrivate, targetCustomerId: idStrOrNull(m.targetCustomerId), createdAt: m.createdAt ?? null });

/**
 * One live class's chat listing. `scope` selects one mode so public and private
 * threads never render as one mixed array:
 *   - omitted             → every message, both modes (admin history default)
 *   - { isPrivate:false } → the public timeline
 *   - { isPrivate:true }  → the private thread, narrowed by `viewerId` for a student
 *                           (own messages, host replies to them, host messages to
 *                           nobody) and unnarrowed for the host.
 * Always chronological (oldest → newest).
 */
export const getChatHistory = async (
  liveClassId: string,
  limit: number,
  before?: Date,
  scope?: { isPrivate?: boolean; viewerId?: number | null }
) => {
  const rows = await repo.chatHistory(liveClassId, limit, before, scope);
  // Batch-resolve the current role of every admin author on this page (one pivot query).
  const adminIds = Array.from(
    new Set(rows.filter((r: any) => r.isAdmin && r.adminId != null).map((r: any) => String(r.adminId)))
  );
  const roleByAdminId = new Map<string, string>();
  if (adminIds.length) {
    try {
      const rolesMap = await adminAuthRepository.findRolesForMany(adminIds.map((id) => BigInt(id)));
      for (const [id, roles] of rolesMap) roleByAdminId.set(id, deriveRole(roles.map((r) => r.name)));
    } catch {
      /* best-effort: fall back to a generic admin role below */
    }
  }
  const roleFor = (m: any): string | null =>
    m.isAdmin ? (m.adminId != null ? roleByAdminId.get(String(m.adminId)) ?? "admin" : "admin") : null;
  return rows.reverse().map((m: any) => toChatMessageDto(m, roleFor(m))); // chronological order
};

export const getChatBanStatus = async (customerId: number) => {
  const ban = await repo.chatBanForCustomer(customerId);
  return ban ? { isBanned: true, reason: ban.reason ?? null, bannedAt: ban.createdAt ?? null } : { isBanned: false, reason: null, bannedAt: null };
};

/**
 * Persist a customer live-chat message (socket `send_message`): like
 * sendAdminChatMessage but writes customerId and isAdmin:false. Returns the shape the
 * socket emits as `new_message`.
 */
export const sendCustomerChatMessage = async (input: { liveClassId: string; customerId: number | null; userName?: string | null; message: string; isPrivate?: boolean }) => {
  const now = new Date();
  // isPrivate is the mode active at send time and is never rewritten when the host
  // toggles later, so both histories coexist and are served one at a time.
  const created = await repo.createChatMessage({ liveClassId: input.liveClassId, customerId: input.customerId, adminId: null, isAdmin: false, isPrivate: !!input.isPrivate, userName: input.userName ?? "", message: input.message, createdAt: now, updatedAt: now });
  return { _id: String(created.id), liveClassId: created.liveClassId, customerId: idStrOrNull(created.customerId), userName: created.userName, message: created.message, isPrivate: created.isPrivate, createdAt: created.createdAt };
};

/** Socket send_message guard. */
export const isCustomerChatBanned = async (customerId: number): Promise<boolean> =>
  !!(await repo.chatBanForCustomer(customerId));

export const sendAdminChatMessage = async (input: { liveClassId: string; adminId: number | null; userName?: string | null; message: string; isPrivate?: boolean; targetCustomerId?: number | null }) => {
  const now = new Date();
  // targetCustomerId addresses a private reply to one student (they and the admins see
  // it, nobody else). Left null, a private host message goes to the whole room: private
  // mode hides students from each other, not the host from the class.
  const created = await repo.createChatMessage({ liveClassId: input.liveClassId, customerId: null, adminId: input.adminId, isAdmin: true, isPrivate: !!input.isPrivate, targetCustomerId: input.isPrivate ? input.targetCustomerId ?? null : null, userName: input.userName ?? "Admin", message: input.message, createdAt: now, updatedAt: now });
  return { _id: String(created.id), liveClassId: created.liveClassId, userName: created.userName, message: created.message, isAdmin: true, isPrivate: created.isPrivate, targetCustomerId: idStrOrNull(created.targetCustomerId), createdAt: created.createdAt };
};

export const deleteChatMessage = async (id: number, deletedBy: number | null): Promise<"not_found" | "already" | { liveClassId: string; deletedAt: Date }> => {
  const existing = await repo.findChatMessage(id);
  if (!existing) return "not_found";
  if (existing.deletedAt) return "already";
  const deletedAt = new Date();
  await repo.softDeleteChatMessage(id, deletedBy);
  return { liveClassId: existing.liveClassId, deletedAt };
};

export const listChatBans = async () => {
  const bans = await repo.listChatBans();
  const custs = new Map((await repo.customersByIds([...new Set(bans.map((b) => b.customerId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  // liveClassId is a LiveSession StreamOS streamId; resolve it so the panel can show the session.
  const sessions = new Map((await repo.sessionsByStreamIds([...new Set(bans.map((b) => b.liveClassId).filter((x): x is string => !!x && x.trim() !== ""))])).map((s) => [s.streamId, s]));
  return bans.map((b) => {
    const c = b.customerId != null ? custs.get(b.customerId) : undefined;
    const s = b.liveClassId ? sessions.get(b.liveClassId) : undefined;
    return {
      _id: String(b.id),
      liveClassId: b.liveClassId,
      customerId: idStrOrNull(b.customerId),
      customer: c ? { _id: String(c.id), fullName: c.fullName ?? null, emailAddress: c.emailAddress ?? null, phoneNumber: c.phoneNumber } : null,
      liveSession: s ? { _id: String(s.id), title: s.title ?? null, subject: s.subject ?? null, scheduledAt: s.scheduledAt ?? null, status: s.status } : null,
      reason: b.reason ?? null,
      createdAt: b.createdAt ?? null,
    };
  });
};

export const banCustomerFromChat = async (liveClassId: string, customerId: number, bannedBy: number | null, reason: string | null): Promise<"already" | any> => {
  if (await repo.chatBanForCustomer(customerId)) return "already";
  const b = await repo.banCustomer(liveClassId, customerId, bannedBy, reason);
  return { _id: String(b.id), liveClassId: b.liveClassId, customerId: String(customerId), reason: b.reason ?? null, createdAt: b.createdAt };
};

export const unbanCustomerFromChat = async (customerId: number): Promise<boolean> => {
  const r = await repo.unbanCustomer(customerId);
  return r.count > 0;
};

export interface ChatSettings {
  chatEnabled: boolean;
  privateChat: boolean;
}

/** Defaults: chat on, public. */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { chatEnabled: true, privateChat: false };

/** Defaults when no row is saved. */
export const getChatSettings = async (liveClassId: string): Promise<ChatSettings> => {
  const row = await repo.chatSettingFor(liveClassId);
  return row
    ? { chatEnabled: row.chatEnabled, privateChat: row.privateChat }
    : { ...DEFAULT_CHAT_SETTINGS };
};

/** Upserts a partial patch; returns the full updated object. */
export const updateChatSettings = async (
  liveClassId: string,
  patch: { chatEnabled?: boolean; privateChat?: boolean }
): Promise<ChatSettings> => {
  const row = await repo.upsertChatSetting(liveClassId, patch);
  return { chatEnabled: row.chatEnabled, privateChat: row.privateChat };
};

const toPollDto = (p: any, options: any[]) => ({
  _id: String(p.id),
  liveClassId: p.liveClassId,
  question: p.question,
  options: options.map((o) => ({ text: o.text, votes: o.votes })),
  totalVotes: p.totalVotes,
  isActive: p.isActive,
  createdBy: idStrOrNull(p.createdBy),
  createdByName: p.createdByName ?? null,
  closedAt: p.closedAt ?? null,
  createdAt: p.createdAt ?? null,
});

const loadPollWithOptions = async (p: any) => toPollDto(p, await repo.pollOptions(p.id));

export const getActivePoll = async (liveClassId: string, customerId: number) => {
  const poll = await repo.activePoll(liveClassId);
  if (!poll) return { poll: null, myVote: null };
  const dto = await loadPollWithOptions(poll);
  const vote = await repo.pollVoteFor(poll.id, customerId);
  return { poll: dto, myVote: vote ? vote.optionIndex : null };
};

/**
 * Record a student's vote (socket `submit_vote`). Validates the poll is active and the
 * option index in range, then returns the full fresh poll DTO so the socket can
 * broadcast exact tallies on `poll_update`. String results map to the socket's error
 * emits. One vote per (poll, customer), locked server-side: a second submit returns
 * "already_voted" and changes nothing. A new poll is a new pollId.
 */
export const submitPollVote = async (
  pollId: number,
  customerId: number,
  optionIndex: number
): Promise<
  | Awaited<ReturnType<typeof loadPollWithOptions>>
  | "not_found"
  | "closed"
  | "invalid_option"
  | "already_voted"
> => {
  const poll = await repo.findPoll(pollId);
  if (!poll) return "not_found";
  if (!poll.isActive) return "closed";
  const options = await repo.pollOptions(pollId);
  if (optionIndex < 0 || optionIndex >= options.length) return "invalid_option";
  // Check + insert + counter bumps run in one transaction, so two concurrent submits from
  // the same customer cannot both count.
  if (!(await repo.recordPollVoteOnce(pollId, customerId, optionIndex))) return "already_voted";
  const fresh = await repo.findPoll(pollId);
  return loadPollWithOptions(fresh ?? poll);
};

export const getPollsByClass = async (liveClassId: string) => {
  const polls = await repo.pollsByClass(liveClassId);
  return Promise.all(polls.map(loadPollWithOptions));
};

export const getPollResults = async (pollId: number): Promise<"not_found" | any> => {
  const poll = await repo.findPoll(pollId);
  return poll ? loadPollWithOptions(poll) : "not_found";
};

export const createPoll = async (input: { liveClassId: string; question: string; options: string[]; createdBy: number | null; createdByName?: string | null }) => {
  // Close any currently active poll for the class first.
  const existingActive = await repo.activePoll(input.liveClassId);
  if (existingActive) await repo.closePoll(existingActive.id);
  const now = new Date();
  const created = await repo.createPollWithOptions(
    { liveClassId: input.liveClassId, question: input.question, totalVotes: 0, isActive: true, createdBy: input.createdBy, createdByName: input.createdByName ?? null, createdAt: now, updatedAt: now },
    input.options.map((text) => ({ text, votes: 0 }))
  );
  return { poll: await loadPollWithOptions(created), closedPollId: existingActive ? String(existingActive.id) : null };
};

export const updatePoll = async (pollId: number, patch: { question?: string; isActive?: boolean }): Promise<"not_found" | any> => {
  if (!(await repo.findPoll(pollId))) return "not_found";
  const data: any = { updatedAt: new Date() };
  if (patch.question !== undefined) data.question = patch.question;
  if (patch.isActive !== undefined) { data.isActive = patch.isActive; if (!patch.isActive) data.closedAt = new Date(); }
  const updated = await repo.updatePoll(pollId, data);
  return loadPollWithOptions(updated);
};

/**
 * Only permitted while the poll is active with zero votes. Guard failures return
 * strings the controller maps to HTTP codes/messages; otherwise the poll DTO with
 * reloaded options.
 */
export const updatePollWithOptions = async (
  pollId: number,
  patch: { question?: string; options?: string[] }
): Promise<"not_found" | "closed" | "has_votes" | any> => {
  const poll = await repo.findPoll(pollId);
  if (!poll) return "not_found";
  if (!poll.isActive) return "closed";
  if (poll.totalVotes > 0) return "has_votes";
  const updated = await repo.updatePollWithOptions(pollId, {
    question: patch.question,
    options: patch.options ? patch.options.map((text) => ({ text, votes: 0 })) : undefined,
  });
  return loadPollWithOptions(updated);
};

export const closePoll = async (pollId: number): Promise<"not_found" | any> => {
  if (!(await repo.findPoll(pollId))) return "not_found";
  return loadPollWithOptions(await repo.closePoll(pollId));
};

export const deletePoll = async (pollId: number): Promise<boolean> => {
  if (!(await repo.findPoll(pollId))) return false;
  await repo.deletePoll(pollId);
  return true;
};
