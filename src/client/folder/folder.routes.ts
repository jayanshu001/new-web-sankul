import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { videoFolderController, materialFolderController } from "./folder.controller";

type Controller = typeof videoFolderController;

/**
 * Shared router for `/client/video-folders/*` and `/client/material-folders/*`.
 *
 * DO NOT DELETE ANY ROUTE HERE without re-auditing. The mobile app's
 * "unused attach-folder APIs" handoff lists most of this surface as dead
 * because offline downloads went device-local (Redux `foldersByUser` /
 * `downloads` slice, no post-download attach call). That claim is scoped to
 * the mobile Downloads hub ONLY — it is NOT true of the backend, because these
 * same tables back a second, still-live feature:
 *
 *   Saved Materials / Saved Videos → profile dashboard `downloads` count
 *   (dashboard.controller.ts → folderSql.countSavedItems, reading ws_folder_item).
 *
 * Audited call sites, per route:
 *   GET  /              list      LIVE — Downloads hub reads `name` + `itemCount`
 *                                 (docs/client/FOLDER_SUMMARY_LISTING.md §0).
 *   POST /              create    Not called by mobile (folders are local now);
 *                                 still the only way to mint a server folder.
 *   GET  /all-items     allItems  LIVE — mints per-item mediaToken
 *                                 (MATERIAL_MEDIA_TOKEN_FRONTEND.md,
 *                                 CLIENT_MEDIA_ACCESS.md). FE is migrating the
 *                                 *hub* off it; other screens still use it.
 *   GET  /:id           detail    LIVE — folder detail + pagination, incl. legacy
 *                                 cloud folder ids the mobile handoff calls out.
 *   PATCH  /:id         update    Not called by mobile.
 *   DELETE /:id         remove    Not called by mobile.
 *   POST   /:id/items   addItem   The ONLY write path into ws_folder_item
 *                                 (client-folder.service.ts:146). Removing it
 *                                 freezes Saved Materials/Videos and decays the
 *                                 dashboard `downloads` count toward 0.
 *   DELETE /:id/items/:itemId  removeItem  Counterpart un-save.
 *
 * So the only genuinely mobile-dead handlers are create/update/remove/addItem/
 * removeItem, and addItem/removeItem are load-bearing for the save feature on
 * whatever client still saves. Confirm web/admin before deprecating any of it.
 */
function buildRouter(c: Controller) {
  const router = Router();
  router.use(authenticate);

  // ─── DISABLED 2026-08-06 per UNUSED_ATTACH_FOLDER_APIS.md (mobile handoff) ───
  // Commented out, NOT deleted — re-enable by uncommenting the line. The
  // controller + service implementations behind each are fully intact in
  // folder.controller.ts / modules/client-folder/client-folder.service.ts.
  // Each now 404s (no route matches), same as deletion from a client's view.
  //
  // Known breakage accepted with this change — see the audit block above:
  //   · list    — FOLDER_SUMMARY_LISTING.md:51-52 directs FE onto this for the
  //               Downloads hub. That doc and the handoff contradict each other.
  //   · addItem — sole writer to ws_folder_item. With it off, no new Saved
  //               Material/Video can ever be created, and the profile dashboard
  //               `downloads` count decays toward 0 as referenced content is
  //               deleted (countSavedItems only counts rows that still hydrate).
  //
  // router.get("/", c.list);
  // router.post("/", c.create);
  // router.patch("/:id", c.update);
  // router.delete("/:id", c.remove);
  // router.post("/:id/items", c.addItem);
  // router.delete("/:id/items/:itemId", c.removeItem);
  // ─────────────────────────────────────────────────────────────────────────────

  // STILL ACTIVE. The handoff explicitly keeps folder detail (legacy cloud
  // folder ids); `/all-items` it never mentions, and it mints per-item
  // mediaToken for material screens (CLIENT_MEDIA_ACCESS.md:74).
  // Static path — must stay above `/:id` or "all-items" is captured as an id.
  router.get("/all-items", c.allItems);
  router.get("/:id", c.detail);

  return router;
}

export const videoFolderRouter = buildRouter(videoFolderController);
export const materialFolderRouter = buildRouter(materialFolderController);
