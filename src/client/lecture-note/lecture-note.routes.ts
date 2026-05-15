import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  createNote,
  listNotes,
  updateNote,
  deleteNote,
} from "./lecture-note.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.post("/", createNote);
router.get("/", listNotes);
router.patch("/:id", updateNote);
router.delete("/:id", deleteNote);

export default router;
