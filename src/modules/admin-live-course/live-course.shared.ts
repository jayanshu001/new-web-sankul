// Live courses: id parsing and small DTO/helpers shared by the live-course service files.
import type { LiveCourseOrder, LiveCourseSubscription, LiveSession } from "@prisma/client";
import { parsePositiveInt } from "../../utils/parseId";

/**
 * A subscription row read with its order; any DTO carrying amount / gateway ids / code
 * snapshots needs this shape. `order` is nullable only because the FK is.
 */
export type LiveSubWithOrder = LiveCourseSubscription & { order: LiveCourseOrder | null };

export const parseLiveId = parsePositiveInt;

export const idStrOrNull = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);
export const jArr = (v: any): any[] => (Array.isArray(v) ? v : []);

// Synthetic ids for JSON schedule folders/entries (addressed by `_id`).
let _seq = 0;
export const synthId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(_seq++).toString(36)}${Math.floor(performance.now()).toString(36)}`;

export const toSessionDto = (s: LiveSession) => ({
  _id: String(s.id),
  title: s.title ?? null,
  subject: s.subject ?? null,
  scheduledAt: s.scheduledAt ?? null,
  endAt: s.endAt ?? null,
  status: s.status,
  streamId: s.streamId ?? null,
  hlsUrl: s.hlsUrl ?? null,
  recordings: jArr(s.recordings),
  createdAt: s.createdAt ?? null,
  updatedAt: s.updatedAt ?? null,
});

// StreamOS sometimes appends stray quote chars to recording paths; strip them.
export const sanitizeRecPath = <T extends string | null | undefined>(p: T): T =>
  (typeof p === "string" ? (p.replace(/(?:"|%22|%2522)+$/i, "") as T) : p);
