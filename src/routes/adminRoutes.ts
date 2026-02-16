import { Router } from 'express';
import { getAllUsers, updateUserRole, getAllBusinesses } from '../controllers/adminController';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';

const router = Router();

// All routes here require Admin role
router.use(requireAuth);
router.use(requireAdmin);

// User Management
router.get('/users', getAllUsers);
router.patch('/users/:id/role', updateUserRole);

// Business Oversight
router.get('/businesses', getAllBusinesses);

export default router;
