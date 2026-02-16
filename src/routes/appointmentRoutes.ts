import { Router } from 'express';
import { createAppointment, getMyAppointments, getBusinessAppointments, updateAppointmentStatus } from '../controllers/appointmentController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Customer
router.post('/', requireAuth, createAppointment);
router.get('/my', requireAuth, getMyAppointments);

// Owner
router.get('/business', requireAuth, getBusinessAppointments);
router.patch('/:id/status', requireAuth, updateAppointmentStatus);

export default router;
