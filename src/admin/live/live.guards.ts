import { LiveSession } from "../../models/course/LiveSession.model";

/**
 * `liveClassId` is the Streamos `streamId` string of a LiveSession.
 * Returns the streamId only while the underlying session is CREATED (i.e. live
 * on Streamos). Returns null for blank ids, missing sessions, or sessions that
 * have not started yet (SCHEDULED) or have already finished (ENDED / READY).
 * Past chat is still available via the REST history route.
 */
export async function resolveLiveClassId(liveClassId: unknown): Promise<string | null> {
  if (typeof liveClassId !== "string" || !liveClassId.trim()) return null;
  const streamId = liveClassId.trim();

  const session = await LiveSession.findOne({ streamId }).select("status").lean();
  if (!session || session.status !== "CREATED") return null;
  return streamId;
}
