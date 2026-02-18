import { Router } from 'express';
import { getAllUsers, updateUserRole, getAllBusinesses, updateUserStatus, inviteAdmin, createUser, getBusinessDetails } from '../controllers/adminController';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';

const router = Router();

// All routes here require Admin role
router.use(requireAuth);
router.use(requireAdmin);

// User Management
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.patch('/users/:id/role', updateUserRole);
router.patch('/users/:id/status', updateUserStatus);
router.post('/invite', inviteAdmin);

// Business Oversight
router.get('/businesses', getAllBusinesses);
router.get('/businesses/:id/details', getBusinessDetails);

export default router;
