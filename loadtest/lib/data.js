// Seeded, STABLE test data. SharedArray is mandatory (§9) — without it every VU
// copies the dataset and the generator OOMs at high VU counts.
//
// IDs harvested 2026-07-24 from the local staging-clone DB via the client API.
// Re-harvest if the target dataset changes (see loadtest/README.md).
import { SharedArray } from 'k6/data';

export const courseIds = new SharedArray('courseIds', () => [114]);

export const packageIds = new SharedArray('packageIds', () => [
  990093, 990092, 94, 91, 88,
]);

export const examIds = new SharedArray('examIds', () => [300002]);

export const examCategoryIds = new SharedArray('examCategoryIds', () => [
  147, 146, 59, 137, 133, 138, 87, 80, 79, 85,
]);

// A lecture the seed customer (472335) has purchased — required for the J4 heartbeat.
// scope.kind + scope.id are the container the video is played inside (see
// progress.controller.ts progressSchemaMysql).
export const playback = new SharedArray('playback', () => [
  { videoId: 33141, scope: { kind: 'course', id: '114' } },
]);

// Varied terms incl. Gujarati/Hindi so we don't test a single cached query (J3, §8).
export const searchTerms = new SharedArray('searchTerms', () => [
  'gpsc',
  'maths',
  'reasoning',
  'ગુજરાતી',
  'વિજ્ઞાન',
  'हिंदी',
  'सामान्य ज्ञान',
  'current affairs',
]);

export function pick(arr) {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}
