import { Router } from 'express';
import { createBusiness, getMyBusinesses, updateBusiness, deleteBusiness } from '../controllers/tenantBusinessController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/', requireAuth, createBusiness);
router.get('/me', requireAuth, getMyBusinesses);
router.put('/:id', requireAuth, updateBusiness);
router.delete('/:id', requireAuth, deleteBusiness);

export default router;
