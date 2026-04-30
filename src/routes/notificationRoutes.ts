import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notificationController";

const router = Router();

router.use(requireAuth);
router.get("/", listMyNotifications);
router.patch("/:id/read", markNotificationRead);
router.patch("/read-all", markAllNotificationsRead);

export default router;
