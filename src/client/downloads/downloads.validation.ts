// Client downloads: Zod schema for saving the encryption key.
import { z } from "zod";
import { DOWNLOAD_KEY_HEX_REGEX } from "../../modules/client-download-key/client-download-key.types";

// `.strict()` is load-bearing: a `userId` in the body must never be honoured, and
// rejecting unknown keys outright guarantees it. Token identity is the only identity.
export const putEncryptionKeySchema = z
  .object({
    key: z
      .string({ required_error: "key is required", invalid_type_error: "key must be a string" })
      .trim()
      .regex(DOWNLOAD_KEY_HEX_REGEX, "key must be exactly 64 hexadecimal characters"),
  })
  .strict();
