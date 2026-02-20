import { Router } from 'express';
import * as serviceProviderController from '../controllers/serviceProviderController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// All routes require authentication
router.use(requireAuth);

router.post('/', serviceProviderController.createServiceProvider);
router.get('/', serviceProviderController.getServiceProviders);
router.patch('/:id', serviceProviderController.updateServiceProvider);
router.delete('/:id', serviceProviderController.deleteServiceProvider);
router.post('/:id/services', serviceProviderController.assignProviderServices);
router.get('/:id/availability', serviceProviderController.getProviderAvailability);
router.put('/:id/availability', serviceProviderController.updateProviderAvailability);
router.patch('/assignments/:id', serviceProviderController.assignProviderToEntry);

export default router;
