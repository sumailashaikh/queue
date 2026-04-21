import { Router } from 'express';
import * as serviceProviderController from '../controllers/serviceProviderController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// All routes require authentication
router.use(requireAuth);

router.post('/', serviceProviderController.createServiceProvider);
router.get('/me', serviceProviderController.getMyProviderProfile); // ADD ME
router.get('/leaves/status', serviceProviderController.getBulkLeaveStatus);
router.get('/leaves/pending-count', serviceProviderController.getPendingLeaveRequestsCount);
router.get('/leaves/alerts', serviceProviderController.getLeaveAlerts);
router.get('/', serviceProviderController.getServiceProviders);
router.patch('/:id', serviceProviderController.updateServiceProvider);
router.delete('/:id', serviceProviderController.deleteServiceProvider);
router.post('/:id/services', serviceProviderController.assignProviderServices);
router.get('/:id/availability', serviceProviderController.getProviderAvailability);
router.put('/:id/availability', serviceProviderController.updateProviderAvailability);
router.get('/:id/day-offs', serviceProviderController.getProviderDayOffs);
router.post('/:id/day-offs', serviceProviderController.addProviderDayOff);
router.delete('/day-offs/:dayOffId', serviceProviderController.deleteProviderDayOff);
router.get('/:id/block-times', serviceProviderController.getProviderBlockTimes);
router.post('/:id/block-times', serviceProviderController.addProviderBlockTime);
router.delete('/block-times/:blockId', serviceProviderController.deleteProviderBlockTime);
router.patch('/assignments/:id', serviceProviderController.assignProviderToEntry);

// Provider Leaves endpoints
router.get('/:id/leaves', serviceProviderController.getProviderLeaves);
router.post('/:id/leaves', serviceProviderController.addProviderLeave);
router.post('/:id/leaves/validate', serviceProviderController.validateProviderLeaveImpact);
router.post('/:id/leaves/reassign-plan', serviceProviderController.previewAutoReassignPlan);
router.post('/:id/leaves/reassign-apply', serviceProviderController.applyAutoReassignPlan);
router.patch('/leaves/:leaveId/status', serviceProviderController.updateLeaveStatus);
router.delete('/leaves/:leaveId', serviceProviderController.deleteProviderLeave);

// Resignation Resquests
router.post('/resignation', serviceProviderController.submitResignation);
router.get('/resignation/list', serviceProviderController.getResignationRequests);
router.patch('/resignation/:requestId/status', serviceProviderController.updateResignationStatus);

export default router;
