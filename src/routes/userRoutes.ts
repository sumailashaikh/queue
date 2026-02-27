import { Router } from 'express';
import { getProfile, updateProfile, updateUiLanguage } from '../controllers/userController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.get('/me', requireAuth, getProfile);
router.put('/me', requireAuth, updateProfile);
router.put('/language', requireAuth, updateUiLanguage);

export default router;
