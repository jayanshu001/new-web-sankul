import { z } from "zod";

export const deleteSearchHistoryParams = z.object({
  id: z.coerce.number().int().positive(),
});
