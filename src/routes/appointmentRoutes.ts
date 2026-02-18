import { Router } from 'express';
import { createAppointment, getMyAppointments, getBusinessAppointments, updateAppointmentStatus, sendAppointmentAlert } from '../controllers/appointmentController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Customer
router.post('/', requireAuth, createAppointment);
router.get('/my', requireAuth, getMyAppointments);

// Owner
router.get('/business', requireAuth, getBusinessAppointments);
router.patch('/:id/status', requireAuth, updateAppointmentStatus);
router.post('/:id/alert', requireAuth, sendAppointmentAlert);

export default router;
