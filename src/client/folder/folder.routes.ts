// Client saved folders: shared router for video and material folders.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { videoFolderController, materialFolderController } from "./folder.controller";

type Controller = typeof videoFolderController;

/**
 * Shared router for `/client/video-folders/*` and `/client/material-folders/*`.
 * These tables also back Saved Materials/Videos and the profile dashboard `downloads`
 * count (countSavedItems reads ws_folder_item), so the mobile "unused attach-folder
 * APIs" handoff is not the whole story. addItem is the only writer to ws_folder_item.
 * Confirm web/admin usage before deleting any route.
 */
function buildRouter(c: Controller) {
  const router = Router();
  router.use(authenticate);

  // Disabled per UNUSED_ATTACH_FOLDER_APIS.md (mobile handoff); kept commented so they
  // can be re-enabled, handlers are intact. Accepted breakage: with addItem off no new
  // saved item can be created, so the dashboard `downloads` count decays as content
  // is deleted.
  // router.get("/", c.list);
  // router.post("/", c.create);
  // router.patch("/:id", c.update);
  // router.delete("/:id", c.remove);
  // router.post("/:id/items", c.addItem);
  // router.delete("/:id/items/:itemId", c.removeItem);

  // Static path must stay above `/:id` or "all-items" is captured as an id.
  router.get("/all-items", c.allItems);
  router.get("/:id", c.detail);

  return router;
}

export const videoFolderRouter = buildRouter(videoFolderController);
export const materialFolderRouter = buildRouter(materialFolderController);
