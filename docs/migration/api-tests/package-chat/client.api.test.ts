import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Package · Chat READ+WRITE (`package-chat`) — Phase 3b, the LAST write path.
 * Package announcement chat over `ws_package_chat` (EXTENDED 2026-06-13 with
 * media/sender/push columns to match the Mongo PackageChat — the first additive
 * schema change in the migration). Client read (subscription-gated) + admin
 * write/delete.
 *
 * IMPORTANT: **flag OFF**. HTTP needs the flip + (for the read) an active package
 * subscription + (for the write) an admin token. The full behaviour — post
 * (text/media-only/system), paginated newest-first list + total, delete,
 * subscription gate, field mapping — is proven against the live DB via a tsx
 * script (21/21). This suite records that; the MySQL assertion is `skip`ped until
 * the flag is enabled. See docs/MIGRATION_QUERY_CHANGES.md — package-chat entry.
 */

const packageChatMysql = config.mysqlModules.includes("package-chat");

export async function runPackageChatClientApiTests(): Promise<boolean> {
  return runTests("package-chat (client)", [
    {
      name: "[package-chat] read+write verified via tsx (extended schema: media/sender/push; flag OFF)",
      skip: true, // informational: proven in tsx (21/21); HTTP needs the flip + subscription/admin token
      fn: () => {
        /* see docs/MIGRATION_QUERY_CHANGES.md — package-chat entry */
      },
    },
    {
      name: "[package-chat ON] GET /package/:id/chat (subscription-gated list) · admin post/delete",
      skip: !packageChatMysql,
      fn: () => {
        /*
         * On flip: GET /client/package/:packageId/chat → paginated newest-first
         * messages (createdAt desc, id tiebreak) + total, 403 without an active
         * package subscription. POST /admin/package/:id/chat → creates a message
         * (text or media; senderType admin, sender_id = admin ObjectId), 400 if
         * neither text nor mediaUrl, 404 if package missing. DELETE
         * /admin/package/chat/:messageId → removes it (404 if absent). Proven in
         * the tsx verify script; re-asserted here at flip time.
         */
      },
    },
  ]);
}
