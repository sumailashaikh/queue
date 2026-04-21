import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware";
import {
  getEmployeeAppointmentsToday,
  getEmployeeAppointmentsUpcoming,
  getEmployeeTasks,
  getEmployeeTodaySummary,
} from "../controllers/employeeController";

const router = Router();

router.get("/my-tasks", requireAuth, getEmployeeTasks);
router.get("/appointments/today", requireAuth, getEmployeeAppointmentsToday);
router.get("/appointments/upcoming", requireAuth, getEmployeeAppointmentsUpcoming);
router.get("/today-summary", requireAuth, getEmployeeTodaySummary);

export default router;

