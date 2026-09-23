import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3Audio } from "../../middlewares/upload";
import {
  createAudioNote,
  listAudioNotes,
  updateAudioNote,
  deleteAudioNote,
} from "./lecture-audio-note.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.post("/", uploadS3Audio.single("audio"), createAudioNote);
router.get("/", listAudioNotes);
router.patch("/:id", updateAudioNote);
router.delete("/:id", deleteAudioNote);

export default router;
