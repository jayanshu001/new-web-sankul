import { fmtExportDate } from "./csvExport";
import { computeEndAt } from "./planDuration";

export interface RemarkEntry {
  at: string | null;
  text: string;
  changedBy: { _id: string; name: string } | null;
}

export interface RemarkActor {
  id: number;
  name: string;
}

interface RawEntry {
  at: string | null;
  text: string;
}

interface AdminName {
  firstName: string | null;
  lastName: string | null;
}

type FindAdmins = (ids: number[]) => Promise<AdminName[]>;

const ENTRY_RE = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*([^[]*)/g;
const BY_RE = /\s*\|\s*by ([^|]*) \(#(\d+)\)$/;
const UNDATED = "0000-00-00 00:00:00";

const clean = (s: string): string =>
  s.replace(/<[^>]*>/g, "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

const cleanFree = (s: string): string => clean(s).replace(/\|/g, "/");

const newestFirst = (a: RawEntry, b: RawEntry): number => (b.at ?? UNDATED).localeCompare(a.at ?? UNDATED);

const parseRaw = (remarks: string | null | undefined): RawEntry[] => {
  const source = (remarks ?? "").trim();
  if (!source) return [];

  const matches = [...source.matchAll(ENTRY_RE)];
  if (!matches.length) return [{ at: null, text: source }];

  const entries: RawEntry[] = [];
  const head = clean(source.slice(0, matches[0].index));
  if (head) entries.push({ at: null, text: head });

  for (const match of matches) {
    const text = match[2].replace(/\s+/g, " ").trim();
    if (text) entries.push({ at: match[1], text });
  }
  return entries;
};

const build = (entries: RawEntry[]): string =>
  [...entries]
    .sort(newestFirst)
    .map((e) => (e.at ? `[${e.at}] ${e.text}` : e.text))
    .join("\n");

export const adminDisplayName = (admin: AdminName | null | undefined): string =>
  `${admin?.firstName ?? ""} ${admin?.lastName ?? ""}`.trim();

export const resolveRemarkActor = async (
  adminId: number | null | undefined,
  findAdmins: FindAdmins
): Promise<RemarkActor | null> => {
  if (!adminId) return null;
  const [admin] = await findAdmins([adminId]);
  return { id: adminId, name: adminDisplayName(admin) || "Admin" };
};

export const remarkAuditText = (what: string, remark: string | null | undefined, by: RemarkActor | null): string => {
  const note = remark ? cleanFree(remark) : "";
  let text = [cleanFree(what), note && `Remark: ${note}`].filter(Boolean).join(". ");
  if (by) text += ` | by ${cleanFree(by.name) || "Admin"} (#${by.id})`;
  return text;
};

export const appendRemarkHistory = (remarks: string | null | undefined, text: string, now: Date = new Date()): string => {
  const entries = parseRaw(remarks);
  const entry = clean(text);
  if (entry) entries.unshift({ at: fmtExportDate(now), text: entry });
  return build(entries);
};

export const appendAdminRemark = async (
  remarks: string | null | undefined,
  change: { what: string; remark?: string | null; actingAdminId?: number | null; now: Date },
  findAdmins: FindAdmins
): Promise<string> => {
  const actor = await resolveRemarkActor(change.actingAdminId, findAdmins);
  return appendRemarkHistory(remarks, remarkAuditText(change.what, change.remark, actor), change.now);
};

export const parseRemarkHistory = (remarks: string | null | undefined): RemarkEntry[] =>
  parseRaw(remarks)
    .sort(newestFirst)
    .map((e) => {
      const match = e.text.match(BY_RE);
      if (!match) return { at: e.at, text: e.text, changedBy: null };
      return { at: e.at, text: e.text.slice(0, match.index).trim(), changedBy: { _id: match[2], name: match[1] } };
    });

export const movedRemarkText = (
  from: { id: number | null; phone: string | null | undefined },
  to: { id: number; phone: string | null | undefined }
): string =>
  `Mobile number changed - subscription moved from ${from.phone || "N/A"} (customer #${from.id ?? "none"})` +
  ` to ${to.phone || "N/A"} (customer #${to.id})`;

// Deactivate sets end_at := start_at, so a zero-length window is a deactivated row.
export const isDeactivatedWindow = (s: { startAt: Date | null; endAt: Date | null }): boolean =>
  !!(s.startAt && s.endAt && s.startAt.getTime() === s.endAt.getTime());

export interface DateShift {
  activeSubscriptionId: number;
  activeEndAt: Date;
  startAt: Date;
  endAt: Date;
  days: number;
  what: string;
}

/**
 * Transferring a subscription (change product / move customer) onto a product the
 * customer already holds actively would overlap the two. Instead, the transferred row's
 * remaining time (end − max(now, start)) is queued to start when the latest active one
 * ends. Null when no active subscription overlaps it.
 */
export const planDateShift = (
  current: { startAt: Date | null; endAt: Date | null },
  actives: { id: number; startAt: Date | null; endAt: Date | null }[],
  now: Date
): DateShift | null => {
  const active = actives
    .filter((a): a is { id: number; startAt: Date | null; endAt: Date } => !!a.endAt && a.endAt > now && !isDeactivatedWindow(a))
    .sort((a, b) => b.endAt.getTime() - a.endAt.getTime())[0];
  if (!active || !current.endAt) return null;
  if (current.startAt && current.startAt >= active.endAt) return null;

  const from = current.startAt && current.startAt > now ? current.startAt : now;
  const remainingMs = Math.max(0, current.endAt.getTime() - from.getTime());
  const startAt = new Date(active.endAt.getTime());
  const endAt = new Date(startAt.getTime() + remainingMs);
  return {
    activeSubscriptionId: active.id,
    activeEndAt: active.endAt,
    startAt,
    endAt,
    days: Math.round(remainingMs / 86_400_000),
    what:
      `Dates moved after active subscription #${active.id}: ` +
      `${fmtExportDate(current.startAt) || "none"} - ${fmtExportDate(current.endAt)} -> ${fmtExportDate(startAt)} - ${fmtExportDate(endAt)}`,
  };
};

export const planDeactivation = (
  current: { startAt: Date | null; endAt: Date | null },
  now: Date
): { endAt: Date; what: string } | null => {
  const endAt = current.startAt ?? now;
  if (current.endAt?.getTime() === endAt.getTime()) return null;
  return { endAt, what: `Deactivated: end date ${fmtExportDate(current.endAt) || "none"} -> ${fmtExportDate(endAt)}` };
};

const DEACTIVATED_RE = /^Deactivated: end date (none|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) -> (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

const parseIstStamp = (stamp: string): Date => new Date(`${stamp.replace(" ", "T")}+05:30`);

export const planDeactivationRevert = (
  current: { endAt: Date | null; remarks: string | null }
): { ok: false; reason: "no_record" | "not_deactivated" } | { ok: true; endAt: Date; what: string } => {
  const lastDeactivation = parseRaw(current.remarks)
    .sort(newestFirst)
    .map((e) => e.text.match(DEACTIVATED_RE))
    .find((m): m is RegExpMatchArray => m !== null);
  if (!lastDeactivation || lastDeactivation[1] === "none") return { ok: false, reason: "no_record" };

  const [, previousEnd, deactivatedEnd] = lastDeactivation;
  if (fmtExportDate(current.endAt) !== deactivatedEnd) return { ok: false, reason: "not_deactivated" };

  return {
    ok: true,
    endAt: parseIstStamp(previousEnd),
    what: `Deactivation reverted: end date ${deactivatedEnd} -> ${previousEnd}`,
  };
};

export const planAddDays = (
  current: { endAt: Date | null },
  days: number,
  now: Date
): { endAt: Date; what: string } => {
  const from = current.endAt && current.endAt > now ? current.endAt : now;
  const endAt = computeEndAt({ startAt: from, durationMonths: days, asDays: true });
  const unit = days === 1 ? "day" : "days";
  return { endAt, what: `Added ${days} ${unit}: end date ${fmtExportDate(current.endAt) || "none"} -> ${fmtExportDate(endAt)}` };
};
