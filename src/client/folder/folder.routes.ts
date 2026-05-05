import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listFolders,
  createFolder,
  getFolderDetail,
  deleteFolder,
  addFolderItem,
  removeFolderItem,
} from "./folder.controller";

const router = Router();

router.use(authenticate);

router.get("/", listFolders);
router.post("/", createFolder);
router.get("/:id", getFolderDetail);
router.delete("/:id", deleteFolder);
router.post("/:id/items", addFolderItem);
router.delete("/:id/items/:itemId", removeFolderItem);

export default router;
