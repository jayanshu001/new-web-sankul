/**
 * Standalone: mint the mock admin + customer JWTs and store them in
 * api-tests/.auth.json. Run this before hitting APIs manually, or let
 * run-all.ts / run-module.ts call it automatically.
 *
 *   yarn migration:api:auth
 */
import { generateAuthStore } from "./_lib/token-store.js";

generateAuthStore()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
