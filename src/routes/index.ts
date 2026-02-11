import { Router } from 'express';
import queueRoutes from './queueRoutes';
import authRoutes from './authRoutes';
import userRoutes from './userRoutes';
import businessRoutes from './businessRoutes';

import appointmentRoutes from './appointmentRoutes';

import serviceRoutes from './serviceRoutes';

const router = Router();

router.use('/queues', queueRoutes);
router.use('/auth', authRoutes); // Auth routes (OTP)
router.use('/users', userRoutes);
router.use('/businesses', businessRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/services', serviceRoutes);

export default router;
