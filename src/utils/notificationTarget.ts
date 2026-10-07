// Notification routing: admin target to FCM tap-routing fields, and back.
/**
 * Maps an admin's semantic notification target to the FCM fields the app reads on
 * tap (contract: docs/notifications/NOTIFICATION_DEEPLINK_ADMIN.md). Every routing
 * field goes in `data`, every `data` value is a string (`params` JSON-encoded).
 *
 * App routing priority (first match wins):
 *   1. viewType==="link" + (deepLink|clickAction) → open URL externally
 *   2. viewType==="dialog"                        → no navigation
 *   3. screen present                             → navigate(screen, params)
 *   4. deepLink|clickAction present              → in-app deep-link navigation
 */
import { z } from "zod";

const APP_SCHEME = process.env.APP_SCHEME || "com.gpscvideo.gpsc";

// Kept in sync with the share surfaces in `src/deeplinking/deeplinking.routes.ts`.
export const CONTENT_ENTITY_PATHS = {
  course: "course",
  package: "package",
  "live-course": "live-course",
  book: "book",
  ebook: "ebook",
  "test-series": "test-series",
} as const;
export type ContentEntity = keyof typeof CONTENT_ENTITY_PATHS;

export const APP_PATHS = [
  "home",
  "library",
  "profile",
  "tests",
  "notes",
  "notifications",
] as const;

// Registered Android channels; the app applies the default when omitted.
export const NOTIFICATION_CHANNELS = [
  "websankul-default",
  "websankul-social",
  "websankul-offer",
] as const;

const entityId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]);

export const notificationTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("content"),
    entity: z.enum(
      Object.keys(CONTENT_ENTITY_PATHS) as [ContentEntity, ...ContentEntity[]]
    ),
    id: entityId,
  }),
  z.object({
    kind: z.literal("appPath"),
    path: z.enum(APP_PATHS),
  }),
  // Already-formed deep-link/share URL; the app normalises it.
  z.object({
    kind: z.literal("deepLink"),
    url: z.string().min(1),
  }),
  z.object({
    kind: z.literal("screen"),
    screen: z.string().min(1),
    params: z.record(z.any()).optional(),
  }),
  z.object({
    kind: z.literal("external"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("dialog"),
  }),
]);

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export interface BuiltRouting {
  /** Top-level FcmPayload.deepLink (mirrored into data.deepLink). */
  deepLink?: string;
  data: Record<string, string>;
}

const CONTENT_DEEPLINK_RE = new RegExp(
  `^${APP_SCHEME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}://(${Object.values(CONTENT_ENTITY_PATHS).join("|")})/(\\d+)$`
);

/**
 * Inverse of the "content" branch of `buildNotificationRouting`. Used to re-check
 * the target is still active when a scheduled notification fires.
 */
export function parseContentDeepLink(deepLink: string | null | undefined): { entity: ContentEntity; id: number } | null {
  if (!deepLink) return null;
  const match = CONTENT_DEEPLINK_RE.exec(deepLink);
  if (!match) return null;
  return { entity: match[1] as ContentEntity, id: Number(match[2]) };
}

/** Resolve a semantic target into the FCM routing fields merged into `deepLink` + `data`. */
export function buildNotificationRouting(target: NotificationTarget): BuiltRouting {
  switch (target.kind) {
    case "content": {
      const path = CONTENT_ENTITY_PATHS[target.entity];
      return { deepLink: `${APP_SCHEME}://${path}/${String(target.id)}`, data: {} };
    }
    case "appPath":
      return { deepLink: `${APP_SCHEME}://${target.path}`, data: {} };
    case "deepLink":
      return { deepLink: target.url, data: {} };
    case "screen": {
      const data: Record<string, string> = { screen: target.screen };
      if (target.params && Object.keys(target.params).length) {
        data.params = JSON.stringify(target.params);
      }
      return { data };
    }
    case "external":
      return { deepLink: target.url, data: { viewType: "link" } };
    case "dialog":
      return { data: { viewType: "dialog" } };
  }
}

// `extractNotificationRouting` is the inverse of `buildNotificationRouting`, used by
// the client feed so a list tap routes exactly like the push. Both live here because
// list and push must match: a routing field added to one side must be added to the
// other. The list API returns real JSON types (`params` object, numeric ids).

/**
 * Unused keys are omitted, never null: the app's router checks presence, so a null
 * placeholder would give a plain announcement a destination.
 */
export interface NotificationRouting {
  viewType?: "link" | "dialog";
  deepLink?: string;
  clickAction?: string;
  screen?: string;
  params?: Record<string, unknown>;
  liveCourseId?: string | number;
  sessionId?: string | number;
  streamId?: string | number;
}

// Prisma `Json` arrives as an object; tolerate a stringified blob too.
const asDataRecord = (data: unknown): Record<string, unknown> => {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (typeof data === "string" && data.trim()) {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* not JSON */
    }
  }
  return {};
};

// Keeps `""` from being surfaced as a destination.
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined;

// Number when lossless (safe integer), else the string: `streamId` may be non-numeric.

const idValue = (v: unknown): string | number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = str(v);
  if (s === undefined) return undefined;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  return s;
};

/** Pure and total: an unroutable row yields `{}` (client opens the detail modal). */
export function extractNotificationRouting(row: {
  deepLink?: string | null;
  data?: unknown;
}): NotificationRouting {
  const data = asDataRecord(row.data);
  const routing: NotificationRouting = {};

  const viewType = str(data.viewType);
  if (viewType === "link" || viewType === "dialog") routing.viewType = viewType;

  // The column is authoritative; `data.deepLink` covers producers that only wrote the blob.
  const deepLink = str(row.deepLink) ?? str(data.deepLink);
  if (deepLink) routing.deepLink = deepLink;

  // Legacy alias, surfaced only when actually stored.
  const clickAction = str(data.clickAction);
  if (clickAction) routing.clickAction = clickAction;

  const screen = str(data.screen);
  if (screen) routing.screen = screen;

  const params = asDataRecord(data.params);
  if (Object.keys(params).length) routing.params = params;

  const liveCourseId = idValue(data.liveCourseId);
  if (liveCourseId !== undefined) routing.liveCourseId = liveCourseId;

  const sessionId = idValue(data.sessionId);
  if (sessionId !== undefined) routing.sessionId = sessionId;

  const streamId = idValue(data.streamId);
  if (streamId !== undefined) routing.streamId = streamId;

  return routing;
}
