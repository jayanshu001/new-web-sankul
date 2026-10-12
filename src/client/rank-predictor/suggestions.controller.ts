import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { rankSuggestionService } from "../../modules/rank-suggestions/rank-suggestion.service";
import { success } from "../../utils/httpResponse";

/** Keyed on the session, like rank/me: it can only ever answer for the caller's own score. */
export const getMySuggestions = asyncHandler(async (req: Request, res: Response) => {
  const data = await rankSuggestionService.listForCustomer(
    BigInt(req.params.examId as string),
    Number(req.user!.id)
  );
  return success(res, data);
});
