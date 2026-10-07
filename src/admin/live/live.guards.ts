// Admin live sessions: resolves a chat liveClassId to a currently live session.
import { resolveLiveClassIdSql } from "../../modules/admin-live/admin-live.service";

/**
 * `liveClassId` is the session's StreamOS `streamId`. Returns it only while the
 * session is CREATED (live); null otherwise. Past chat is served by the REST history route.
 */
export async function resolveLiveClassId(liveClassId: unknown): Promise<string | null> {
  if (typeof liveClassId !== "string" || !liveClassId.trim()) return null;
  const streamId = liveClassId.trim();

  return resolveLiveClassIdSql(streamId);
}
