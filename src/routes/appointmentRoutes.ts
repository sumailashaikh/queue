import { Router } from 'express';
import {
  createAppointment,
  getMyAppointments,
  getBusinessAppointments,
  updateAppointmentStatus,
  acceptAppointment,
  rejectAppointment,
  sendAppointmentAlert,
  rescheduleAppointment,
  cancelAppointment,
  processAppointmentPayment,
  getMyAssignedAppointments,
  reassignAppointment,
} from '../controllers/appointmentController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Customer
router.post('/', requireAuth, createAppointment);
router.get('/my', requireAuth, getMyAppointments);
router.get('/assigned/me', requireAuth, getMyAssignedAppointments);

// Owner
router.get('/business', requireAuth, getBusinessAppointments);
router.patch('/:id/status', requireAuth, updateAppointmentStatus);
router.patch('/:id/accept', requireAuth, acceptAppointment);
router.patch('/:id/reject', requireAuth, rejectAppointment);
router.patch('/:id/reschedule', requireAuth, rescheduleAppointment); // NEW
router.patch('/:id/cancel', requireAuth, cancelAppointment); // NEW
router.patch('/:id/reassign', requireAuth, reassignAppointment); // NEW
router.patch('/:id/payment', requireAuth, processAppointmentPayment);
router.post('/:id/alert', requireAuth, sendAppointmentAlert);

export default router;
