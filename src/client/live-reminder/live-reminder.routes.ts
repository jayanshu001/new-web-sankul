import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  setLiveSessionReminder,
  listMyLiveSessionReminders,
  getMyReminderForSession,
  removeLiveSessionReminder,
} from "./live-reminder.controller";

const router = Router();

router.use(authenticate, requireRole("customer"));

router.post("/",                      setLiveSessionReminder);      // POST   /api/v1/client/live-reminders
router.get("/",                       listMyLiveSessionReminders);  // GET    /api/v1/client/live-reminders
router.get("/session/:liveSessionId", getMyReminderForSession);     // GET    /api/v1/client/live-reminders/session/:liveSessionId
router.delete("/:liveSessionId",      removeLiveSessionReminder);   // DELETE /api/v1/client/live-reminders/:liveSessionId

export default router;
