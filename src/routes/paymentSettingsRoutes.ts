import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware";
import {
  getPaymentSettingsByBusiness,
  savePaymentSettings,
} from "../controllers/paymentSettingsController";

const router = Router();

router.post("/", requireAuth, savePaymentSettings);
router.get("/:businessId", requireAuth, getPaymentSettingsByBusiness);

export default router;

