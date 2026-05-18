import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  createNote,
  listNotes,
  listSavedMaterialNotes,
  updateNote,
  deleteNote,
} from "./lecture-note.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.post("/", createNote);
router.get("/saved-materials", listSavedMaterialNotes);
router.get("/", listNotes);
router.patch("/:id", updateNote);
router.delete("/:id", deleteNote);

export default router;
