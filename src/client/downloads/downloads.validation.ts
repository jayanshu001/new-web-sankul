import { z } from "zod";
import { DOWNLOAD_KEY_HEX_REGEX } from "../../modules/client-download-key/client-download-key.types";

/**
 * Body for PUT /api/v1/client/downloads/encryption-key
 *
 * `.strict()` is load-bearing here, not stylistic: the spec says a `userId` in
 * the body must never be honoured, and rejecting unknown keys outright is a
 * stronger guarantee than remembering to ignore them. Token identity is the only
 * identity.
 */
export const putEncryptionKeySchema = z
  .object({
    key: z
      .string({ required_error: "key is required", invalid_type_error: "key must be a string" })
      .trim()
      .regex(DOWNLOAD_KEY_HEX_REGEX, "key must be exactly 64 hexadecimal characters"),
  })
  .strict();

export type PutEncryptionKeyBody = z.infer<typeof putEncryptionKeySchema>;
