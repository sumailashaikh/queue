
import { Router } from 'express';
import { createService, getServices, getMyServices, deleteService } from '../controllers/serviceController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Public
router.get('/business/:businessId', getServices);

// Protected (Owner)
router.post('/', requireAuth, createService);
router.get('/my', requireAuth, getMyServices);
router.delete('/:id', requireAuth, deleteService);

export default router;
