import { Router } from 'express';
import { getDailySummary } from '../controllers/analyticsController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/today', requireAuth, getDailySummary);

export default router;
