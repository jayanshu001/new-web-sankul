// Jobs API cache: revalidation ping to websankul-jobs-api after a jobs write so its Redis cache
// doesn't serve stale data for its 300-600s TTL.
import axios from "axios";
import logger from "./logger";
import { callOutbound } from "../libs/outbound";
import { JOBS_API, isJobsApiCacheConfigured } from "../config/jobsApi";

// Must match websankul-jobs-api's CacheServices.revalidate() switch.
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

/** Callers must catch, so a jobs-api outage never fails the admin write. */
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
