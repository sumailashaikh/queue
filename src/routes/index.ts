import { Router } from 'express';
import queueRoutes from './queueRoutes';
import authRoutes from './authRoutes';
import userRoutes from './userRoutes';
import businessRoutes from './businessRoutes';

import appointmentRoutes from './appointmentRoutes';
import analyticsRoutes from './analyticsRoutes';
import serviceRoutes from './serviceRoutes';
import adminRoutes from './adminRoutes';
import publicRoutes from './publicRoutes';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Add a root route for /api to avoid 404 HTML pages
router.get('/', (req, res) => {
    res.json({ message: 'Queue API is online', version: '1.0.0' });
});

router.use('/public', publicRoutes);
router.use('/queues', queueRoutes);
router.use('/auth', authRoutes); // Auth routes (OTP)
router.use('/users', userRoutes);
router.use('/businesses', businessRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/services', serviceRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/admin', adminRoutes);

export default router;
