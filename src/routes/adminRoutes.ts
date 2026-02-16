import { Router } from 'express';
import { getAllUsers, updateUserRole, getAllBusinesses, updateUserStatus } from '../controllers/adminController';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';

const router = Router();

// All routes here require Admin role
router.use(requireAuth);
router.use(requireAdmin);

// User Management
router.get('/users', getAllUsers);
router.patch('/users/:id/role', updateUserRole);
router.patch('/users/:id/status', updateUserStatus);

// Business Oversight
router.get('/businesses', getAllBusinesses);

export default router;
