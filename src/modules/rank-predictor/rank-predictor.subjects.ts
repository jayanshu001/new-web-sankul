import { buildAnswerReview, acceptedOptionsOf } from "./rank-predictor.scoring";
import {
  ANSWER_VERDICT,
  OTHER_SUBJECT,
  type AnswerKeyMap,
  type AnswerMap,
  type MarkingScheme,
  type ResolvedSubject,
  type ScoreWithSubjects,
  type SubjectScoreRow,
  type SyllabusSubject,
} from "./rank-predictor.types";

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

const inQuestionOrder = (questions: Iterable<string>): string[] =>
  [...questions].sort((a, b) => Number(a) - Number(b));

/**
 * A syllabus with no question ranges, on a sheet that prints no sections, gives
 * nothing to match on — so the paper is cut in syllabus order (subject 1 first,
 * then 2, 3 …). Each subject gets a share of the questions in proportion to its
 * marks of the paper total, or an equal share when the marks are not all set.
 * Largest-remainder rounding makes the shares add up to every question.
 */
const splitInSyllabusOrder = (syllabus: SyllabusSubject[], questions: string[]): ResolvedSubject[] => {
  const byMarks = syllabus.every((subject) => (subject.marks ?? 0) > 0);
  const weights = syllabus.map((subject) => (byMarks ? (subject.marks as number) : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (questions.length * weight) / totalWeight);
  const counts = exact.map(Math.floor);
  let spare = questions.length - counts.reduce((sum, count) => sum + count, 0);
  exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (spare-- > 0) counts[index] += 1;
    });

  let from = 0;
  return syllabus.map((subject, index) => {
    const covered = questions.slice(from, from + counts[index]);
    from += counts[index];
    return { name: subject.name, questions: covered, marks: subject.marks ?? null };
  });
};

/**
 * Which questions each subject covers.
 *
 * With a syllabus, a subject reads its question range if it has one, else the
 * sheet section of that name; a question belongs to the first subject that claims
 * it, and any left over fall under "Other" so the parts always add to the whole.
 * With no syllabus, the subjects are simply the sections printed on the sheet — and
 * none at all when the sheet printed no sections.
 */
export const resolveSubjects = (
  syllabus: SyllabusSubject[],
  questionNumbers: string[],
  sectionByQuestion: Record<string, string | null | undefined>
): ResolvedSubject[] => {
  const questions = inQuestionOrder(questionNumbers);

  if (!syllabus.length) {
    const bySection = new Map<string, string[]>();
    for (const question of questions) {
      const section = sectionByQuestion[question];
      if (!section) continue;
      bySection.set(section, [...(bySection.get(section) ?? []), question]);
    }
    return [...bySection].map(([name, covered]) => ({ name, questions: covered, marks: null }));
  }

  const nothingToMatch =
    syllabus.every((subject) => subject.from_question === undefined && subject.to_question === undefined) &&
    questions.every((question) => !sectionByQuestion[question]);
  if (nothingToMatch) return splitInSyllabusOrder(syllabus, questions);

  const claimed = new Set<string>();
  const resolved: ResolvedSubject[] = syllabus.map((subject) => {
    const sectionName = subject.section ?? subject.name;
    const hasRange = subject.from_question !== undefined || subject.to_question !== undefined;

    const covered = questions.filter((question) => {
      if (claimed.has(question)) return false;
      if (hasRange) {
        const number = Number(question);
        return number >= (subject.from_question ?? 1) && number <= (subject.to_question ?? Infinity);
      }
      const section = sectionByQuestion[question];
      return Boolean(section) && sameName(section as string, sectionName);
    });

    covered.forEach((question) => claimed.add(question));
    return { name: subject.name, questions: covered, marks: subject.marks ?? null };
  });

  const leftover = questions.filter((question) => !claimed.has(question));
  if (leftover.length) resolved.push({ name: OTHER_SUBJECT, questions: leftover, marks: null });

  return resolved;
};

/**
 * What each question's marks are multiplied by. A subject with a configured
 * `marks` is rescaled so its questions add up to it — each is worth
 * marks / (questions that count), the penalty scaled by the same factor — and
 * every other question is left at 1. The one definition, shared by scoring and by
 * the per-question review, so the two can never disagree.
 */
export const questionFactorsOf = (
  answerKey: AnswerKeyMap,
  scheme: MarkingScheme,
  subjects: ResolvedSubject[]
): Map<string, number> => {
  const factors = new Map<string, number>();

  for (const subject of subjects) {
    const scorable = subject.questions.filter(
      (question) => question in answerKey && acceptedOptionsOf(answerKey[question]) !== null
    ).length;
    const rescales = subject.marks !== null && scorable > 0 && scheme.marksCorrect > 0;
    const factor = rescales ? (subject.marks as number) / scorable / scheme.marksCorrect : 1;

    for (const question of subject.questions) factors.set(question, factor);
  }

  return factors;
};

/** Scores a sheet and splits the result by subject. It tallies the same review
 * items `scoreSubmission` does — one definition of "correct" — and only applies
 * the factors above. Cancelled questions count toward nothing, as everywhere else. */
export const scoreWithSubjects = (
  answers: AnswerMap,
  answerKey: AnswerKeyMap,
  scheme: MarkingScheme,
  subjects: ResolvedSubject[]
): ScoreWithSubjects => {
  const total: ScoreWithSubjects = { correct: 0, wrong: 0, unanswered: 0, rawScore: 0, subjects: [] };
  const owner = new Map<string, ResolvedSubject>();
  for (const subject of subjects) for (const question of subject.questions) owner.set(question, subject);

  const factors = questionFactorsOf(answerKey, scheme, subjects);
  const rows = new Map<string, SubjectScoreRow>();
  for (const subject of subjects) {
    const scorable = subject.questions.filter(
      (question) => question in answerKey && acceptedOptionsOf(answerKey[question]) !== null
    ).length;
    rows.set(subject.name, {
      subject: subject.name,
      correct: 0,
      wrong: 0,
      unanswered: 0,
      score: 0,
      maxMarks: subject.marks ?? scorable * scheme.marksCorrect,
    });
  }

  for (const item of buildAnswerReview(answers, answerKey, scheme)) {
    if (item.verdict === ANSWER_VERDICT.CANCELLED) continue;

    const subject = owner.get(String(item.questionNo));
    const row = subject ? rows.get(subject.name) : undefined;
    const marks = item.marks * (factors.get(String(item.questionNo)) ?? 1);

    if (item.verdict === ANSWER_VERDICT.CORRECT) {
      total.correct += 1;
      if (row) row.correct += 1;
    } else if (item.verdict === ANSWER_VERDICT.WRONG) {
      total.wrong += 1;
      if (row) row.wrong += 1;
    } else {
      total.unanswered += 1;
      if (row) row.unanswered += 1;
    }

    total.rawScore += marks;
    if (row) row.score += marks;
  }

  total.subjects = [...rows.values()];
  return total;
};
