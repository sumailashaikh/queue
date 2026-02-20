import { Router } from 'express';
import { getDailySummary, getProviderAnalytics } from '../controllers/analyticsController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/today', requireAuth, getDailySummary);
router.get('/provider-analytics', requireAuth, getProviderAnalytics);

export default router;
