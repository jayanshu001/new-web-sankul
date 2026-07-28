/**
 * Notification deep-link target builder.
 *
 * Single source of truth for turning an admin's *semantic* notification target
 * (e.g. "open course 42", "open the NotificationScreen", "open an external URL")
 * into the exact FCM `data` fields the mobile app reads on status-bar tap.
 *
 * The app's tap-routing contract lives in the RN app
 * (`notificationHandler.ts` / `navigationRef.ts`) and is documented in
 * `docs/notifications/NOTIFICATION_DEEPLINK_ADMIN.md`. Rules enforced here:
 *   - ALL routing fields go into `data` (never only in `notification`).
 *   - Every `data` value is a string; `params` is a JSON-encoded string.
 *   - Content ids are numeric SQL primary keys, carried as text in the path.
 *
 * Routing priority in the app (first match wins):
 *   1. viewType==="link" + (deepLink|clickAction) → open URL externally
 *   2. viewType==="dialog"                        → no navigation
 *   3. screen present                             → navigate(screen, params)
 *   4. deepLink|clickAction present              → in-app deep-link navigation
 */
import { z } from "zod";

// Custom URL scheme the app registers (share redirect uses the same default).
const APP_SCHEME = process.env.APP_SCHEME || "com.gpscvideo.gpsc";

// Content entity → in-app deep-link path segment (see spec §4). Kept in sync
// with the share surfaces in `src/deeplinking/deeplinking.routes.ts`.
export const CONTENT_ENTITY_PATHS = {
  course: "course",
  package: "package",
  "live-course": "live-course",
  book: "book",
  ebook: "ebook",
  "test-series": "test-series",
} as const;
export type ContentEntity = keyof typeof CONTENT_ENTITY_PATHS;

// Parameter-less app destinations (tabs / simple screens), spec §4.
export const APP_PATHS = [
  "home",
  "library",
  "profile",
  "tests",
  "notes",
  "notifications",
] as const;
export type AppPath = (typeof APP_PATHS)[number];

// Registered Android channels (spec §3.1). Default applied by the app when omitted.
export const NOTIFICATION_CHANNELS = [
  "websankul-default",
  "websankul-social",
  "websankul-offer",
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Numeric SQL id, accepted as number or numeric string, normalised to text.
const entityId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]);

/**
 * The semantic target an admin selects. Discriminated on `kind` so the admin
 * panel can render one field-set per action type.
 */
export const notificationTargetSchema = z.discriminatedUnion("kind", [
  // Mode A (recommended): open a content detail screen by entity + SQL id.
  z.object({
    kind: z.literal("content"),
    entity: z.enum(
      Object.keys(CONTENT_ENTITY_PATHS) as [ContentEntity, ...ContentEntity[]]
    ),
    id: entityId,
  }),
  // Mode A: parameter-less app destination (tab / simple screen).
  z.object({
    kind: z.literal("appPath"),
    path: z.enum(APP_PATHS),
  }),
  // Mode A escape hatch: an already-formed deep-link/share URL (app normalises it).
  z.object({
    kind: z.literal("deepLink"),
    url: z.string().min(1),
  }),
  // Mode B: route by React-Navigation screen name + optional params object.
  z.object({
    kind: z.literal("screen"),
    screen: z.string().min(1),
    params: z.record(z.any()).optional(),
  }),
  // Mode C: open a URL outside the app (browser / WhatsApp / etc.).
  z.object({
    kind: z.literal("external"),
    url: z.string().url(),
  }),
  // Mode D: acknowledged tap with no navigation (reserved for in-app dialog).
  z.object({
    kind: z.literal("dialog"),
  }),
]);

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export interface BuiltRouting {
  /** Goes to the top-level FcmPayload.deepLink (mirrored into data.deepLink). */
  deepLink?: string;
  /** Extra FCM data keys (viewType / screen / params / channelId ...). */
  data: Record<string, string>;
}

/**
 * Resolve a semantic target into the FCM routing fields. The caller merges the
 * result into the outgoing `deepLink` + `data` before dispatch, so every
 * downstream path (immediate send, scheduled re-dispatch, feed row) is unchanged.
 */
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
      // viewType==="link" forces the app to Linking.openURL (external).
      return { deepLink: target.url, data: { viewType: "link" } };
    case "dialog":
      return { data: { viewType: "dialog" } };
  }
}

// ─── Reading routing back out (list API) ─────────────────────────────────────
//
// `buildNotificationRouting` above is the WRITE side: semantic target → the
// `deepLink` column + stringified `data` blob persisted on ws_notification and
// pushed via FCM. `extractNotificationRouting` below is its INVERSE, used by the
// client feed so a tap in the in-app Notification list routes exactly like a tap
// on the push that created it.
//
// Both directions live in this one file on purpose: the FE contract requires
// "list and push must match for the same event", and that only holds if the two
// projections are defined together. Adding a routing field to one side without
// the other is the bug this co-location is meant to make obvious.
//
// Shape note: FCM `data` values must all be strings, so the persisted blob has
// `params` as a JSON *string* and ids as numeric *strings*. The list API is
// plain JSON with no such constraint, so we hand back real types — `params` as
// an object, numeric ids as numbers — which is what the app expects from it.

/**
 * Routing fields as the LIST API exposes them: real JSON types, and every key
 * omitted entirely when the notification does not use it. Absent ≠ null here —
 * the app's router checks presence, so emitting `null` placeholders would make a
 * plain announcement look like it has a destination.
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

/** Prisma `Json` arrives as an object, but tolerate a stringified blob too. */
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
      /* not JSON — no routing to recover */
    }
  }
  return {};
};

/** Non-empty string, or undefined. Keeps `""` from being surfaced as a destination. */
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined;

/**
 * Ids are persisted as strings (FCM constraint) but are SQL integers, so hand
 * back a number when that is lossless. `streamId` is a StreamOS token that may
 * be non-numeric, hence the pass-through — never coerce blindly, and never past
 * the safe-integer boundary where a big id would silently change value.
 */
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

/**
 * Project a stored notification row into the routing fields the app's tap
 * router reads. Pure and total: an unroutable row yields `{}`, which the client
 * treats as "open the detail modal" (the documented no-routing fallback).
 */
export function extractNotificationRouting(row: {
  deepLink?: string | null;
  data?: unknown;
}): NotificationRouting {
  const data = asDataRecord(row.data);
  const routing: NotificationRouting = {};

  const viewType = str(data.viewType);
  if (viewType === "link" || viewType === "dialog") routing.viewType = viewType;

  // The column is authoritative; `data.deepLink` is the fallback for rows written
  // by producers that only populated the blob.
  const deepLink = str(row.deepLink) ?? str(data.deepLink);
  if (deepLink) routing.deepLink = deepLink;

  // Legacy alias. Surfaced only when actually stored — the app accepts either,
  // so mirroring `deepLink` into it would be an invented placeholder.
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
