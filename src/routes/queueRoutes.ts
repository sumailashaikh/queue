import { Router } from 'express';
import { getAllQueues, createQueue, joinQueue, updateQueue, deleteQueue, getMyQueues, getTodayQueue, updateQueueEntryStatus, resetQueueEntries, nextEntry, extendTime, assignTaskProvider, startTask, completeTask, noShowQueueEntry, skipQueueEntry, updateQueueEntryPayment } from '../controllers/queueController';
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
router.patch('/entries/:id/no-show', requireAuth, noShowQueueEntry); // NEW: No-show endpoint
router.patch('/entries/:id/skip', requireAuth, skipQueueEntry); // NEW: Skip endpoint
router.patch('/entries/:id/extend-time', requireAuth, extendTime); // Extend service duration
router.patch('/entries/:id/payment', requireAuth, updateQueueEntryPayment); // NEW: Payment
router.post('/next', requireAuth, nextEntry); // Auto-next flow

// Per-Service Tasks (Phase 3)
router.patch('/services/:id/assign-provider', requireAuth, assignTaskProvider);
router.patch('/services/:id/start', requireAuth, startTask);
router.patch('/services/:id/complete', requireAuth, completeTask);

// Moved to public routes to allow guest joining

export default router;
