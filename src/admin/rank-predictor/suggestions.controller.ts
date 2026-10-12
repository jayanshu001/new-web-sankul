import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { rankSuggestionService } from "../../modules/rank-suggestions/rank-suggestion.service";
import { success } from "../../utils/httpResponse";
import { bigIntParam } from "./rank-predictor.helpers";

/**
 * A new cover arrives as the multipart `image` file; an unchanged one is sent
 * back as its URL in the `image` text field, so a PUT still replaces the row whole.
 * Runs between the upload and `validate`, so the schema sees the stored URL.
 */
export const applySuggestionImage = (req: Request, _res: Response, next: NextFunction) => {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  const image = files?.image?.[0];
  if (image?.location) {
    req.body = { ...req.body, image: image.location };
  }
  next();
};

export const listSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const suggestions = await rankSuggestionService.listForExam(bigIntParam(req, "examId"));
  return success(res, { suggestions });
});

export const createSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const data = await rankSuggestionService.create(bigIntParam(req, "examId"), req.body);
  return success(res, data, "Suggestion added.", 201);
});

export const updateSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const data = await rankSuggestionService.update(bigIntParam(req, "id"), req.body);
  return success(res, data, "Suggestion updated.");
});

export const deleteSuggestion = asyncHandler(async (req: Request, res: Response) => {
  await rankSuggestionService.delete(bigIntParam(req, "id"));
  return success(res, {}, "Suggestion deleted.");
});
