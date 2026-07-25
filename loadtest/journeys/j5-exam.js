// J5 — Exam attempt lifecycle (group: write + analytics). Stateful, contention-prone.
//
// Two exports:
//  - examRead:    detail + questions + heavy my/analytics aggregate. Read-only, safe
//                 for the Phase-2 load mix.
//  - examAttempt: the full start → answer → submit write lifecycle. Creates rows —
//                 DISPOSABLE DB ONLY (§8 J5). Wired into its own opt-in scenario, not
//                 the default mix.
import { check, sleep } from 'k6';
import { getJSON, postJSON, checkEnvelope } from '../lib/http.js';
import { envelopeOk } from '../lib/metrics.js';
import { examIds, pick } from '../lib/data.js';

export function examRead(token) {
  const examId = pick(examIds);
  if (!examId) return;

  const detail = getJSON(`/quizzes/${examId}/detail`, token, 'write', { ep: 'exam-detail' });
  envelopeOk.add(checkEnvelope(detail, 'exam detail'));
  sleep(1);

  const questions = getJSON(`/quizzes/${examId}/questions`, token, 'write', { ep: 'exam-questions' });
  envelopeOk.add(checkEnvelope(questions, 'exam questions'));
  sleep(1);

  // Heavy aggregate — its own group so §7's analytics threshold applies.
  const analytics = getJSON('/quizzes/my/analytics', token, 'analytics', { ep: 'exam-analytics' });
  envelopeOk.add(checkEnvelope(analytics, 'exam analytics'));
  sleep(1);
}

// Full stateful lifecycle. Each VU owns its own attemptId (§8). DISPOSABLE DB ONLY.
export function examAttempt(token) {
  const examId = pick(examIds);
  if (!examId) return;

  // Pull real question + answer ids from the live response (never hard-coded).
  const qRes = getJSON(`/quizzes/${examId}/questions`, token, 'write', { ep: 'exam-questions' });
  let questions = [];
  try {
    const d = qRes.json('data');
    questions = d?.list || d?.questions || (Array.isArray(d) ? d : []);
  } catch (_) {
    questions = [];
  }
  if (!questions.length) return;

  const start = postJSON(`/quizzes/${examId}/attempts/start`, token, 'write', {}, { ep: 'attempt-start' });
  let attemptId = null;
  try {
    const d = start.json('data');
    attemptId = d?.attemptId || d?._id || d?.id || null;
  } catch (_) {
    attemptId = null;
  }
  check(start, { 'attempt start ok': (r) => r.status === 200 && attemptId !== null });
  if (!attemptId) return;
  sleep(1);

  // Answer each question (~1 per question) — the lock-contention hot path.
  for (const q of questions) {
    const qid = q._id || q.id;
    const answerId = (q.answers && q.answers[0] && (q.answers[0]._id || q.answers[0].id)) || null;
    const ans = postJSON(
      `/quizzes/${examId}/attempts/${attemptId}/answer`,
      token,
      'write',
      { questionId: String(qid), answerId: answerId ? String(answerId) : null },
      { ep: 'attempt-answer' },
    );
    envelopeOk.add(check(ans, { 'answer saved': (r) => r.status === 200 }));
    sleep(0.5);
  }

  const submit = postJSON(
    `/quizzes/${examId}/attempts/${attemptId}/submit`,
    token,
    'write',
    { timing: '10:00' },
    { ep: 'attempt-submit' },
  );
  envelopeOk.add(check(submit, { 'submit ok': (r) => r.status === 200 }));
  sleep(1);
}
