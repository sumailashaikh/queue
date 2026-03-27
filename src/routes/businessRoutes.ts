import { Router } from 'express';
import { createBusiness, getMyBusinesses, updateBusiness, deleteBusiness, getBusinessBySlug, getBusinessServices } from '../controllers/tenantBusinessController';
import { inviteEmployee, deactivateEmployee } from '../controllers/adminController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

router.post('/', requireAuth, createBusiness);
router.get('/me', requireAuth, getMyBusinesses);
router.put('/:id', requireAuth, updateBusiness);
router.delete('/:id', requireAuth, deleteBusiness);
router.get('/slug/:slug', getBusinessBySlug);
router.get('/:id/services', getBusinessServices);
router.post('/invite-employee', requireAuth, inviteEmployee);
router.post('/deactivate-employee/:employee_id', requireAuth, deactivateEmployee);

export default router;
