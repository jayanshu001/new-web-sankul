import {
  ANSWER_VERDICT,
  SKIP_OPTION,
  type AnswerKeyMap,
  type AnswerMap,
  type AnswerReviewItem,
  type MarkingScheme,
  type ScoreResult,
} from "./rank-predictor.types";

export const buildAnswerReview = (
  answers: AnswerMap,
  answerKey: AnswerKeyMap,
  scheme: MarkingScheme
): AnswerReviewItem[] =>
  Object.entries(answerKey)
    .map(([questionNo, correctOption]) => {
      const chosen = answers[questionNo] ?? null;

      if (chosen === null || chosen === SKIP_OPTION) {
        return {
          questionNo: Number(questionNo),
          chosen,
          correctOption,
          verdict: ANSWER_VERDICT.UNANSWERED,
          marks: 0,
        };
      }

      const isCorrect = chosen === correctOption;

      return {
        questionNo: Number(questionNo),
        chosen,
        correctOption,
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
