import { Router } from 'express';
import { createBusiness, getMyBusinesses, updateBusiness, deleteBusiness, getBusinessBySlug } from '../controllers/tenantBusinessController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/', requireAuth, createBusiness);
router.get('/me', requireAuth, getMyBusinesses);
router.put('/:id', requireAuth, updateBusiness);
router.delete('/:id', requireAuth, deleteBusiness);
router.get('/slug/:slug', getBusinessBySlug);

export default router;
