// Best-effort cache-revalidation ping to the public websankul-jobs-api after
// a jobs-content/taxonomy/papers/suggested-products write, so its Redis cache
// doesn't keep serving stale data for the 300–600s TTL window. Mirrors
// utils/crm.ts's shape: a thin axios call wrapped in callOutbound, caught and
// logged — never allowed to turn a successful admin write into a failure.
import axios from "axios";
import logger from "./logger";
import { callOutbound } from "../libs/outbound";
import { JOBS_API, isJobsApiCacheConfigured } from "../config/jobsApi";

// Matches the entity names understood by websankul-jobs-api's
// CacheServices.revalidate() switch (src/libs/cacheServices.ts there).
export type JobsApiCacheEntity =
  | "all"
  | "home"
  | "categories"
  | "content"
  | "job"
  | "result"
  | "admitcard"
  | "answerkey"
  | "syllabus"
  | "other"
  | "examcalendar"
  | "previouspapers"
  | "notifications"
  | "search"
  | "suggestedproducts";

// JobContentType (this repo) -> jobs-api revalidate entity name.
const CONTENT_TYPE_TO_ENTITY: Record<string, JobsApiCacheEntity> = {
  job: "job",
  result: "result",
  admit_card: "admitcard",
  answer_key: "answerkey",
  syllabus: "syllabus",
  other: "other",
  exam_calendar: "examcalendar",
};

export const jobsApiEntityForContentType = (type: string): JobsApiCacheEntity =>
  CONTENT_TYPE_TO_ENTITY[type] ?? "content";

/**
 * Fire-and-await a revalidate call — callers wrap this in their own
 * try/catch (matching the existing safeSyncSearchIndex pattern) so a
 * jobs-api outage never fails the admin request itself.
 */
export async function revalidateJobsApiCache(entity: JobsApiCacheEntity, id?: string): Promise<void> {
  if (!isJobsApiCacheConfigured()) return;
  await callOutbound(
    () =>
      axios.post(
        `${JOBS_API.BASE_URL}/cache/revalidate`,
        { entity, ...(id ? { id } : {}) },
        { headers: { "x-cache-auth-key": JOBS_API.CACHE_AUTH_KEY } }
      ),
    { label: "jobsApi.cacheRevalidate", timeoutMs: 5_000, attempts: 2 }
  );
}
