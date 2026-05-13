import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { videoFolderController, materialFolderController } from "./folder.controller";

type Controller = typeof videoFolderController;

function buildRouter(c: Controller) {
  const router = Router();
  router.use(authenticate);
  router.get("/", c.list);
  router.post("/", c.create);
  router.get("/all-items", c.allItems);
  router.get("/:id", c.detail);
  router.patch("/:id", c.update);
  router.delete("/:id", c.remove);
  router.post("/:id/items", c.addItem);
  router.delete("/:id/items/:itemId", c.removeItem);
  return router;
}

export const videoFolderRouter = buildRouter(videoFolderController);
export const materialFolderRouter = buildRouter(materialFolderController);
