import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  createNote,
  listNotes,
  listSavedMaterialNotes,
  deleteSavedMaterialNotes,
  updateNote,
  deleteNote,
} from "./lecture-note.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.post("/", createNote);
router.get("/saved-materials", listSavedMaterialNotes);
router.get("/", listNotes);
// Specific literal path must precede the ":id" param route so "saved-materials"
// isn't captured as a note id.
router.delete("/saved-materials", deleteSavedMaterialNotes);
router.patch("/:id", updateNote);
router.delete("/:id", deleteNote);

export default router;
