import {
  ANSWER_VERDICT,
  CANCELLED_QUESTION,
  SKIP_OPTION,
  type AnswerKeyEntry,
  type AnswerKeyMap,
  type AnswerMap,
  type AnswerReviewItem,
  type MarkingScheme,
  type ScoreResult,
} from "./rank-predictor.types";

/** The options that score for one question, or null when it is cancelled. */
export const acceptedOptionsOf = (entry: AnswerKeyEntry): number[] | null => {
  if (entry === CANCELLED_QUESTION) return null;
  return Array.isArray(entry) ? entry : [entry];
};

export const cancelledCountOf = (answerKey: AnswerKeyMap): number =>
  Object.values(answerKey).filter((entry) => entry === CANCELLED_QUESTION).length;

export const buildAnswerReview = (
  answers: AnswerMap,
  answerKey: AnswerKeyMap,
  scheme: MarkingScheme
): AnswerReviewItem[] =>
  Object.entries(answerKey)
    .map(([questionNo, entry]) => {
      const chosen = answers[questionNo] ?? null;
      const accepted = acceptedOptionsOf(entry);

      // Checked before the skip rule: a cancelled question is out of the paper
      // whatever was marked on it, E included.
      if (accepted === null) {
        return {
          questionNo: Number(questionNo),
          chosen,
          correctOptions: [],
          verdict: ANSWER_VERDICT.CANCELLED,
          marks: 0,
        };
      }

      if (chosen === null || chosen === SKIP_OPTION) {
        return {
          questionNo: Number(questionNo),
          chosen,
          correctOptions: accepted,
          verdict: ANSWER_VERDICT.UNANSWERED,
          marks: 0,
        };
      }

      // Any accepted option scores in full — "A & B" means either is right.
      const isCorrect = accepted.includes(chosen);

      return {
        questionNo: Number(questionNo),
        chosen,
        correctOptions: accepted,
        verdict: isCorrect ? ANSWER_VERDICT.CORRECT : ANSWER_VERDICT.WRONG,
        marks: isCorrect ? scheme.marksCorrect : -scheme.marksWrong,
      };
    })
    .sort((a, b) => a.questionNo - b.questionNo);

export const scoreSubmission = (
  answers: AnswerMap,
  answerKey: AnswerKeyMap,
  scheme: MarkingScheme
): ScoreResult => {
  const result: ScoreResult = { correct: 0, wrong: 0, unanswered: 0, rawScore: 0 };

  for (const item of buildAnswerReview(answers, answerKey, scheme)) {
    // Cancelled counts toward nothing, so correct + wrong + unanswered is the
    // number of questions this score is out of — see toRankScoreDto.
    if (item.verdict === ANSWER_VERDICT.CANCELLED) continue;
    if (item.verdict === ANSWER_VERDICT.CORRECT) result.correct += 1;
    else if (item.verdict === ANSWER_VERDICT.WRONG) result.wrong += 1;
    else result.unanswered += 1;

    result.rawScore += item.marks;
  }

  return result;
};

export const percentileFor = (rank: number, total: number): number => {
  if (total <= 0 || rank <= 0) return 0;
  if (total === 1) return 100;
  return Math.round(((total - rank) / (total - 1)) * 10000) / 100;
};

export const lowConfidencePct = (lowConfidenceCount: number, totalQuestions: number): number =>
  totalQuestions <= 0 ? 0 : (lowConfidenceCount / totalQuestions) * 100;

export const normalizePaperSeries = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];

  const series = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const letter = value.trim().toUpperCase();
    if (letter) series.add(letter);
  }

  return [...series].sort();
};
