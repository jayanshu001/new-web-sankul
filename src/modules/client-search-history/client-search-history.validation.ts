import { z } from "zod";

// DELETE /client/search/history/:id — id is a positive integer (MySQL PK).
export const deleteSearchHistoryParams = z.object({
  id: z.coerce.number().int().positive(),
});
