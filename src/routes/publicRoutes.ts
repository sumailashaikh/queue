import { Router } from 'express';
import { joinQueue, getQueueStatus } from '../controllers/queueController';
import { bookPublicAppointment } from '../controllers/appointmentController';
import { getBusinessDisplayData } from '../controllers/tenantBusinessController';
import { basicRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Apply rate limiting to all public endpoints
router.use(basicRateLimiter);

// Business Public Endpoints
router.get('/business/:slug/display-data', getBusinessDisplayData);

// Queue Public Endpoints
router.post('/queue/join', joinQueue);
router.get('/queue/status', getQueueStatus);

// Appointment Public Endpoints
router.post('/appointment/book', bookPublicAppointment);

export default router;
