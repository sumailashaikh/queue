import { Router } from 'express';
import { getAllQueues, createQueue, joinQueue, updateQueue, deleteQueue, getMyQueues, getTodayQueue, updateQueueEntryStatus } from '../controllers/queueController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Public routes
router.get('/', getAllQueues);

// Protected/Admin routes
router.post('/', requireAuth, createQueue);
router.get('/my', requireAuth, getMyQueues); // Must be before /:id to avoid conflict
router.put('/:id', requireAuth, updateQueue);
router.delete('/:id', requireAuth, deleteQueue);
router.get('/:id/today', requireAuth, getTodayQueue); // Dashboard View

// Customer entries
router.put('/entries/:id/status', requireAuth, updateQueueEntryStatus); // Owner action

// Protected routes (User joining)
router.post('/join', requireAuth, joinQueue);

export default router;
