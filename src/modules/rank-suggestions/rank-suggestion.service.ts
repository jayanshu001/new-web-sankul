import { HttpError } from "../../middlewares/errorHandler";
import { RANK_ERROR } from "../rank-predictor/rank-predictor.types";
import { rankSuggestionRepository } from "./rank-suggestion.repository";
import { toRankSuggestionDto } from "./rank-suggestion.transformer";
import type {
  MyRankSuggestionsDto,
  RankSuggestionDto,
  RankSuggestionInput,
} from "./rank-suggestion.types";

const NOT_FOUND_MESSAGE = "Suggestion not found.";

const requireExam = async (examId: bigint) => {
  const exam = await rankSuggestionRepository.findExam(examId);
  if (!exam) {
    throw new HttpError(404, "Paper not found.", { error: RANK_ERROR.EXAM_NOT_FOUND });
  }
  return exam;
};

/**
 * A product carries no title, image or button text of its own — the catalog supplies
 * them — and a link carries no product, so the fields of the other kind are
 * cleared rather than stored and silently ignored.
 */
const normalize = (input: RankSuggestionInput): RankSuggestionInput =>
  input.kind === "product"
    ? { ...input, url: null, title: null, image: null, ctaLabel: null }
    : { ...input, productType: null, productId: null };

/** Lower bound inclusive, upper bound exclusive, so bands 70–95 and 95+ never overlap. */
const matchesScore = (suggestion: RankSuggestionDto, score: number): boolean =>
  (suggestion.min_marks === null || score >= suggestion.min_marks) &&
  (suggestion.max_marks === null || score < suggestion.max_marks);

export const rankSuggestionService = {
  listForExam: async (examId: bigint): Promise<RankSuggestionDto[]> => {
    await requireExam(examId);
    const rows = await rankSuggestionRepository.listForExam(examId);
    return rows.map(toRankSuggestionDto);
  },

  create: async (examId: bigint, input: RankSuggestionInput): Promise<RankSuggestionDto> => {
    await requireExam(examId);
    return toRankSuggestionDto(await rankSuggestionRepository.create(examId, normalize(input)));
  },

  update: async (id: bigint, input: RankSuggestionInput): Promise<RankSuggestionDto> => {
    if (!(await rankSuggestionRepository.findById(id))) {
      throw new HttpError(404, NOT_FOUND_MESSAGE);
    }
    return toRankSuggestionDto(await rankSuggestionRepository.update(id, normalize(input)));
  },

  delete: async (id: bigint): Promise<void> => {
    if (!(await rankSuggestionRepository.findById(id))) {
      throw new HttpError(404, NOT_FOUND_MESSAGE);
    }
    await rankSuggestionRepository.delete(id);
  },

  /**
   * The caller's own suggestions, matched on the raw marks of their scored
   * sheet. An inactive paper answers 404 like every other client read of it;
   * no score yet (not uploaded, in review, no key) is an empty list.
   */
  listForCustomer: async (examId: bigint, customerId: number): Promise<MyRankSuggestionsDto> => {
    const exam = await requireExam(examId);
    if (!exam.isActive) {
      throw new HttpError(404, "That paper is not open right now.", { error: RANK_ERROR.EXAM_NOT_FOUND });
    }

    const scoreRow = await rankSuggestionRepository.findRawScore(examId, customerId);
    if (!scoreRow) {
      return { score: null, suggestions: [] };
    }

    const score = Number(scoreRow.rawScore);
    const rows = await rankSuggestionRepository.listForExam(examId, true);

    return {
      score,
      suggestions: rows.map(toRankSuggestionDto).filter((suggestion) => matchesScore(suggestion, score)),
    };
  },
};
