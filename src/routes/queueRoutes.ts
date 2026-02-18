import { Router } from 'express';
import { getAllQueues, createQueue, joinQueue, updateQueue, deleteQueue, getMyQueues, getTodayQueue, updateQueueEntryStatus, resetQueueEntries, nextEntry } from '../controllers/queueController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Public routes
router.get('/', getAllQueues);
router.post('/join', joinQueue); // Customers can join without login

// Protected/Admin routes
router.post('/', requireAuth, createQueue);
router.get('/my', requireAuth, getMyQueues); // Must be before /:id to avoid conflict
router.put('/:id', requireAuth, updateQueue);
router.delete('/:id', requireAuth, deleteQueue);
router.get('/:id/today', requireAuth, getTodayQueue); // Dashboard View
router.delete('/:id/entries/today', requireAuth, resetQueueEntries); // Clear entries

// Customer entries
router.patch('/entries/:id/status', requireAuth, updateQueueEntryStatus); // Owner action
router.post('/next', requireAuth, nextEntry); // Auto-next flow

// Moved to public routes to allow guest joining

export default router;
