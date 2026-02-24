import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';
import { isBusinessOpen } from '../utils/timeUtils';
import { recomputeProviderDelays } from '../utils/delayLogic';

export const getAllQueues = async (req: Request, res: Response) => {
    try {
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { data, error } = await supabase
            .from('queues')
            .select('*')
            .eq('status', 'open');

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Queues retrieved successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const createQueue = async (req: Request, res: Response) => {
    try {
        const { name, description, service_id } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // Basic validation
        if (!name) {
            return res.status(400).json({
                status: 'error',
                message: 'Queue name is required'
            });
        }

        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Find the business owned by this user
        // We use the same simple logic that works in getMyQueues
        console.log(`[createQueue] Looking for business for owner: ${userId}`);
        const { data: businesses, error: businessError } = await supabase
            .from('businesses')
            .select('id')
            .eq('owner_id', userId);

        if (businessError) {
            console.error('[createQueue] Business lookup error:', businessError);
            return res.status(500).json({ status: 'error', message: businessError.message });
        }

        if (!businesses || businesses.length === 0) {
            console.warn(`[createQueue] No business found for user: ${userId}`);
            return res.status(404).json({
                status: 'error',
                message: 'No business found for this user. Create a business first.'
            });
        }

        const business = businesses[0];
        console.log(`[createQueue] Found business: ${business.id}. Proceeding to create queue: ${name}`);

        const { data, error } = await supabase
            .from('queues')
            .insert([
                {
                    business_id: business.id, // <--- IMPORTANT LINK
                    name,
                    description,
                    service_id,
                    status: 'open',
                    current_wait_time_minutes: 0
                }
            ])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'Queue created successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const joinQueue = async (req: Request, res: Response) => {
    try {
        const { queue_id, customer_name, phone, service_ids, entry_source } = req.body; // entry_source is new
        const user_id = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!queue_id) {
            return res.status(400).json({ status: 'error', message: 'Queue ID is required' });
        }

        if (!user_id && !customer_name) {
            return res.status(400).json({ status: 'error', message: 'Either User ID or Customer Name is required' });
        }

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // 0. Get Queue and Business info
        const { data: queueInfo, error: queueInfoError } = await supabase
            .from('queues')
            .select('*, businesses(name, open_time, close_time, is_closed)')
            .eq('id', queue_id)
            .single();

        if (queueInfoError) throw queueInfoError;

        // Check Business Hours (Basic Open/Closed)
        if (queueInfo?.businesses) {
            const status = isBusinessOpen(queueInfo.businesses);
            if (!status.isOpen) {
                return res.status(400).json({ status: 'error', message: status.message });
            }
        }

        // 1. Calculate current Wait Time for Closing Time Protection
        const { data: entriesAhead } = await supabase
            .from('queue_entries')
            .select('total_duration_minutes')
            .eq('queue_id', queue_id)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving']);

        let currentWaitTime = 0;
        entriesAhead?.forEach((e: any) => {
            currentWaitTime += (e.total_duration_minutes || 10);
        });

        // Fetch selected services for duration
        let selectedServices = [];
        if (service_ids && service_ids.length > 0) {
            const { data: sData } = await supabase
                .from('services')
                .select('id, name, duration_minutes, price')
                .in('id', service_ids);
            selectedServices = sData || [];
        }

        const serviceDuration = selectedServices.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0);

        // 2. Closing Time Protection Logic
        if (queueInfo?.businesses) {
            const closingProtection = require('../utils/timeUtils').canCompleteBeforeClosing(
                queueInfo.businesses,
                currentWaitTime,
                serviceDuration,
                10 // 10 min buffer as requested
            );

            if (!closingProtection.canJoin) {
                return res.status(400).json({
                    status: 'error',
                    message: closingProtection.message || `We’re fully booked for today. Please book for tomorrow.`
                });
            }
        }

        // 3. Get next position
        const { data: maxPosData } = await supabase
            .from('queue_entries')
            .select('position')
            .eq('queue_id', queue_id)
            .eq('entry_date', todayStr)
            .order('position', { ascending: false })
            .limit(1);

        const nextPosition = (maxPosData && maxPosData.length > 0) ? maxPosData[0].position + 1 : 1;
        const ticket_number = `Q-${nextPosition}`;
        const status_token = crypto.randomUUID();

        const total_price = selectedServices.reduce((acc: number, s: any) => acc + (Number(s.price) || 0), 0);
        const serviceNamesDisplay = selectedServices.map((s: any) => s.name).join(', ') || 'General';

        // 4. Insert Entry with entry_source
        const { data, error } = await supabase
            .from('queue_entries')
            .insert([
                {
                    queue_id,
                    user_id: user_id || null,
                    customer_name: customer_name || 'Guest',
                    phone: phone || null,
                    service_name: serviceNamesDisplay,
                    status: 'waiting',
                    position: nextPosition,
                    ticket_number,
                    status_token,
                    entry_date: todayStr,
                    total_price,
                    total_duration_minutes: serviceDuration,
                    entry_source: entry_source || 'online' // New field
                }
            ])
            .select()
            .single();

        if (error) throw error;

        // Junction table insertion
        if (selectedServices.length > 0) {
            const junctionEntries = selectedServices.map((service: any) => ({
                queue_entry_id: data.id,
                service_id: service.id,
                price: service.price || 0,
                duration_minutes: service.duration_minutes || 0
            }));
            await supabase.from('queue_entry_services').insert(junctionEntries);
        }

        // Send Notifications
        const isOnline = (entry_source || 'online') === 'online';
        const businessName = queueInfo?.businesses?.name || 'the salon';

        if (isOnline && phone) {
            // 1. Join Notification
            await notificationService.sendWhatsApp(phone, `Thank you for joining the queue at ${businessName}. We’ll notify you as your turn approaches.`);

            // 2. High Demand Notification (if delay >= 15)
            if (currentWaitTime >= 15) {
                await notificationService.sendWhatsApp(phone, `We’re currently serving guests and operating at full capacity. Thank you for your patience.`);
            }

            // Update notified_join
            await supabase
                .from('queue_entries')
                .update({ notified_join: true })
                .eq('id', data.id);
        }

        res.status(201).json({
            status: 'success',
            message: 'Joined queue successfully',
            data: {
                ...data,
                token: status_token,
                position: nextPosition,
                wait_time: currentWaitTime,
                status_url: `${req.headers.origin || ''}/status?token=${status_token}`
            }
        });

    } catch (error: any) {
        console.error('Join Queue Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateQueue = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, description, status, current_wait_time_minutes } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // We need to ensure the queue belongs to a business owned by the user.
        // The RLS policy we will add: "Business owners can update queues for their business"
        // But let's verification here too.

        // Update directly. If RLS works, it will only update if user is owner.
        // However, checking existence first gives better error messages (404 vs 403).

        const { data, error } = await supabase
            .from('queues')
            .update({ name, description, status, current_wait_time_minutes })
            .eq('id', id)
            // Implicit check: join business to check owner? Supabase simple update relies on RLS.
            // Let's rely on RLS + the fact we will add a policy.
            .select()
            .single();

        if (error) throw error;

        // If no data returned, either it doesn't exist or RLS blocked it
        if (!data) {
            return res.status(404).json({
                status: 'error',
                message: 'Queue not found or you do not have permission to update it'
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Queue updated successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const deleteQueue = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const { error, count } = await supabase
            .from('queues')
            .delete({ count: 'exact' })
            .eq('id', id);

        if (error) throw error;

        if (count === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Queue not found or already deleted'
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Queue deleted successfully'
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getMyQueues = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        console.log(`Fetching queues for user ${userId}, today is ${todayStr}`);

        // Get queues where the business owner is ME
        // We fetch the count of entries. Filtering on queue_entries columns in the main query
        // will filter out the parent 'queues' if no entries match.
        // To show empty queues, we'll fetch them all first.
        const { data, error } = await supabase
            .from('queues')
            .select(`
                *,
                businesses!inner (id, owner_id, name),
                services (*),
                queue_entries(count)
            `)
            .eq('businesses.owner_id', userId)
            // Removed filters on queue_entries here to prevent hiding empty queues
            .order('created_at', { ascending: false });

        if (error) throw error;

        console.log(`[getMyQueues] User: ${userId} | Found ${data?.length} queues`);
        if (data && data.length > 0) {
            console.log(`[getMyQueues] Sample Business Owner: ${data[0].businesses.owner_id}`);
        }

        res.status(200).json({
            status: 'success',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getTodayQueue = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // queue_id
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Get current date in YYYY-MM-DD format
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        console.log(`Fetching today's queue for id: ${id}, date: ${todayStr}`);

        // 1.5 Auto-Process Skipped Entries (7 minute rule)
        // If status is 'serving' (called) but served_at + 7m < now, set to 'skipped'
        // This only applies to entries where NO work has started (service_started_at is null)
        const sevenMinsAgo = new Date(Date.now() - 7 * 60000).toISOString();
        await supabase
            .from('queue_entries')
            .update({ status: 'skipped' })
            .eq('queue_id', id)
            .eq('status', 'serving')
            .is('service_started_at', null)
            .lt('served_at', sevenMinsAgo);

        const { data, error } = await supabase
            .from('queue_entries')
            .select(`
                *,
                service_providers (id, name),
                queue_entry_services (
                    id,
                    service_id,
                    price,
                    duration_minutes,
                    task_status,
                    assigned_provider_id,
                    started_at,
                    completed_at,
                    estimated_end_at,
                    actual_minutes,
                    delay_minutes,
                    services!service_id (id, name),
                    service_providers!assigned_provider_id (id, name)
                )
            `)
            .eq('queue_id', id)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving']) // Only active people
            .order('position', { ascending: true });

        if (error) throw error;

        // Post-process to compute entry-level delay and estimated_end_at
        const enhancedData = (data || []).map((entry: any) => {
            let totalDelay = 0;
            let maxEstEnd: Date | null = null;

            entry.queue_entry_services?.forEach((s: any) => {
                totalDelay += (s.delay_minutes || 0);

                // Track the latest estimated finish time
                if (s.estimated_end_at) {
                    const est = new Date(s.estimated_end_at);
                    if (!maxEstEnd || est > maxEstEnd) maxEstEnd = est;
                }
                // If a task is completed, its completion time is also a reference for the latest activity
                if (s.completed_at) {
                    const comp = new Date(s.completed_at);
                    if (!maxEstEnd || comp > maxEstEnd) maxEstEnd = comp;
                }
            });

            return {
                ...entry,
                total_delay: totalDelay,
                estimated_end_at: maxEstEnd ? (maxEstEnd as Date).toISOString() : null
            };
        });

        console.log(`Found ${enhancedData.length} active entries for queue ${id} today (${todayStr})`);

        res.status(200).json({
            status: 'success',
            data: enhancedData
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const updateQueueEntryStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // entry_id
        const { status } = req.body; // 'serving', 'completed', 'cancelled', 'no_show'
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!['waiting', 'serving', 'completed', 'cancelled', 'no_show', 'skipped'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        // --- SEQUENTIAL SERVING LOGIC & PROVIDER ASSIGNMENT ---
        const { data: currentEntry } = await supabase
            .from('queue_entries')
            .select(`
                *,
                queues!inner (business_id, status),
                queue_entry_services (service_id)
            `)
            .eq('id', id)
            .single();

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // Backend-level Walk-in / Direct Serve Block
        if (status === 'serving') {
            if (!currentEntry || !currentEntry.ticket_number || currentEntry.entry_date !== todayStr) {
                return res.status(400).json({
                    status: 'error',
                    message: "Customer must join the queue before being served."
                });
            }
        }

        const updates: any = { status };

        if (status === 'serving') {
            if (currentEntry) {
                // 1. Get current busy providers for this business today
                const { data: busyProviders } = await supabase
                    .from('queue_entries')
                    .select('assigned_provider_id')
                    .eq('entry_date', currentEntry.entry_date)
                    .eq('status', 'serving')
                    .not('assigned_provider_id', 'is', null);

                const busyProviderIds = busyProviders?.map((p: any) => p.assigned_provider_id) || [];

                let eligibleProviderId = currentEntry.assigned_provider_id;

                // 2. Provider Assignment Logic
                if (!eligibleProviderId) {
                    const requiredServiceIds = (currentEntry as any).queue_entry_services?.map((s: any) => s.service_id) || [];

                    // Find providers who are active and have ALL required services
                    const { data: providers, error: provError } = await supabase
                        .from('service_providers')
                        .select(`
                            id,
                            name,
                            provider_services (service_id)
                        `)
                        .eq('business_id', (currentEntry as any).queues.business_id)
                        .eq('is_active', true);

                    if (provError) {
                        console.error('[queueController] Provider lookup error:', provError);
                        throw provError;
                    }

                    // Filtering: Supports ALL selected services AND is NOT busy
                    const availableProvider = providers?.find((p: any) => {
                        const providerServiceIds = p.provider_services?.map((ps: any) => ps.service_id) || [];
                        const supportsAll = requiredServiceIds.every((rid: string) => providerServiceIds.includes(rid));
                        const isNotBusy = !busyProviderIds.includes(p.id);
                        return supportsAll && isNotBusy;
                    });

                    if (!availableProvider) {
                        return res.status(400).json({
                            status: 'error',
                            message: "No available expert found who supports all selected services. Please wait or assign manually."
                        });
                    }
                    eligibleProviderId = availableProvider.id;
                } else {
                    // Check if the pre-assigned provider is busy
                    if (busyProviderIds.includes(eligibleProviderId)) {
                        return res.status(400).json({
                            status: 'error',
                            message: "The selected expert is currently attending to another guest. Please choose an available expert."
                        });
                    }
                }

                updates.assigned_provider_id = eligibleProviderId;

                // Update per-service assignment in queue_entry_services
                await supabase
                    .from('queue_entry_services')
                    .update({ assigned_provider_id: eligibleProviderId })
                    .eq('queue_entry_id', id);
            }
        }

        if (status === 'serving') {
            const now = new Date();
            const duration = Number(currentEntry?.total_duration_minutes || 0);
            // service_started_at will be set by startTask (for workflow) 
            // or when we genuinely start the service.
            // served_at represents the "Called" event.
            const estEnd = new Date(now.getTime() + duration * 60000);
            updates.estimated_end_at = estEnd.toISOString();
            updates.served_at = now.toISOString();

            // Send "serving started" SMS with ETA
            const recipient = currentEntry?.phone || (currentEntry?.user_id ? `User-${currentEntry.user_id}` : `Guest-${currentEntry?.customer_name}`);
            const etaStr = estEnd.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
            await notificationService.sendSMS(recipient, `Hello ${currentEntry?.customer_name}, your service has started! Estimated completion is ${etaStr}. Thank you!`);
        }

        if (status === 'completed') {
            const now = new Date();
            updates.completed_at = now.toISOString();

            // Fetch start and estimated end timestamps to calculate actual duration and delay
            const { data: timingData } = await supabase
                .from('queue_entries')
                .select('service_started_at, estimated_end_at, total_duration_minutes')
                .eq('id', id)
                .single();

            if (timingData?.service_started_at) {
                const start = new Date(timingData.service_started_at);
                const actualDuration = Math.round((now.getTime() - start.getTime()) / 60000);
                updates.actual_duration_minutes = actualDuration;

                if (timingData.estimated_end_at) {
                    const estEnd = new Date(timingData.estimated_end_at);
                    const delay = Math.max(0, Math.round((now.getTime() - estEnd.getTime()) / 60000));
                    updates.delay_minutes = delay;
                }
            }
        }

        console.log(`Updating queue entry ${id} with status ${status} by user ${userId}`);

        // Update the entry
        // RLS "Business owners can update entries" will enforce permission
        const { data, error } = await supabase
            .from('queue_entries')
            .update(updates)
            .eq('id', id)
            .select(`
                *,
                queues (name, business_id),
                service_providers (name)
            `);

        if (error) throw error;

        if (!data || data.length === 0) {
            console.error(`Update failed for entry ${id}. No data returned. Possible RLS bypass or missing entry.`);
            return res.status(404).json({
                status: 'error',
                message: 'Entry not found or permission denied. Ensure you are the business owner.'
            });
        }

        const entry = data[0];

        // Send Notification
        // In real app, we'd fetch user's phone from profiles/auth or queue_entry
        // For now, mocking with "User-{id}"
        const recipient = entry.user_id ? `User-${entry.user_id}` : `Guest-${entry.customer_name}`;

        // Consolidate all queue notifications through the process helper
        if (currentEntry) {
            await processQueueNotifications(currentEntry.queue_id, currentEntry.entry_date, supabase);
        }

        res.status(200).json({
            status: 'success',
            message: 'Status updated successfully',
            data: entry
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const noShowQueueEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get current entry to check for notifications and provider lock
        const { data: currentEntry } = await supabase
            .from('queue_entries')
            .select('*')
            .eq('id', id)
            .single();

        if (!currentEntry) {
            return res.status(404).json({ status: 'error', message: 'Entry not found' });
        }

        // 2. Update status and release provider lock
        const updates: any = {
            status: 'no_show',
            assigned_provider_id: null
        };

        const { data, error } = await supabase
            .from('queue_entries')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Release lock in junction table if needed
        await supabase
            .from('queue_entry_services')
            .update({ assigned_provider_id: null })
            .eq('queue_entry_id', id);

        // 3. Send Notification
        const recipient = currentEntry.phone;
        const isOnline = (currentEntry.entry_source || 'online') === 'online';
        if (isOnline && recipient) {
            const message = "We tried reaching you for your turn. If you still need service, please rejoin the queue.";
            await notificationService.sendWhatsApp(recipient, message);
            await supabase.from('queue_entries').update({ notified_noshow: true }).eq('id', id);
        }

        // 4. Trigger position updates for the rest of the queue
        await processQueueNotifications(currentEntry.queue_id, currentEntry.entry_date, supabase);

        res.status(200).json({
            status: 'success',
            message: 'Customer marked as no-show and expert released.',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Automated Queue Notifications
 * State 1: Join (Online Only) - Handled in joinQueue
 * State 2: Position <= 3 (Top 3) - Handled here
 * State 3: Position = 1 (Becoming Next) - Handled here
 * State 5: High Demand (Delay >= 15) - Handled in joinQueue
 */
export const processQueueNotifications = async (queueId: string, entryDate: string, supabase: any) => {
    try {
        // 1. Fetch current waiting entries for this queue
        // We join queues to get business name safely
        const { data: entries, error } = await supabase
            .from('queue_entries')
            .select(`
                id, ticket_number, phone, position, customer_name, entry_source, 
                notified_top3, notified_next,
                queues (
                    business_id,
                    businesses ( name )
                )
            `)
            .eq('queue_id', queueId)
            .eq('entry_date', entryDate)
            .eq('status', 'waiting')
            .order('position', { ascending: true });

        if (error || !entries) {
            console.error('[Notification Process] Fetch Error:', error);
            return;
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const rank = i + 1; // Real-time rank in the waiting list
            const isOnline = (entry.entry_source || 'online') === 'online';

            // Extract business name from join
            const businessName = (entry.queues as any)?.businesses?.name || 'the salon';

            if (!isOnline || !entry.phone) continue;

            // State 3: Position = 1 (Becoming Next)
            if (rank === 1 && !entry.notified_next) {
                await notificationService.sendWhatsApp(entry.phone, `Your turn is now at ${businessName}. Please proceed to the counter.`);
                await supabase.from('queue_entries').update({ notified_next: true }).eq('id', entry.id);
            }
            // State 2: Position <= 3 (Top 3)
            else if (rank <= 3 && rank > 1 && !entry.notified_top3) {
                await notificationService.sendWhatsApp(entry.phone, `Your turn at ${businessName} is coming up soon. Please stay nearby.`);
                await supabase.from('queue_entries').update({ notified_top3: true }).eq('id', entry.id);
            }
        }
    } catch (err) {
        console.error('[Notification Process Error]:', err);
    }
};

export const resetQueueEntries = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // queue_id
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Get current date string (India Time)
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        console.log(`Resetting queue entries for queue ${id} on date ${todayStr} by user ${userId}`);

        // Delete all entries for this queue today
        const { error } = await supabase
            .from('queue_entries')
            .delete()
            .eq('queue_id', id)
            .eq('entry_date', todayStr);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Queue reset successfully for today'
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getQueueStatus = async (req: Request, res: Response) => {
    try {
        const { token } = req.query; // status_token (UUID)
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!token) {
            return res.status(400).json({ status: 'error', message: 'Token is required' });
        }

        // 1. Get the entry and basic business info
        const { data: entry, error: entryError } = await supabase
            .from('queue_entries')
            .select('*, queues(*, businesses(name, slug))')
            .eq('status_token', token)
            .single();

        if (entryError || !entry) {
            return res.status(404).json({ status: 'error', message: 'Entry not found' });
        }

        // 2. Get currently serving person for this queue
        const { data: currentServing } = await supabase
            .from('queue_entries')
            .select('ticket_number, estimated_end_at')
            .eq('queue_id', entry.queue_id)
            .eq('status', 'serving')
            .eq('entry_date', entry.entry_date)
            .maybeSingle();

        // 3. Calculate position ahead
        const { count } = await supabase
            .from('queue_entries')
            .select('*', { count: 'exact', head: true })
            .eq('queue_id', entry.queue_id)
            .eq('status', 'waiting')
            .eq('entry_date', entry.entry_date)
            .lt('position', entry.position);

        const positionAhead = count || 0;

        // 4. Calculate total wait time based on entries ahead (waiting)
        const { data: entriesAhead } = await supabase
            .from('queue_entries')
            .select('id, total_duration_minutes')
            .eq('queue_id', entry.queue_id)
            .eq('entry_date', entry.entry_date)
            .eq('status', 'waiting')
            .lt('position', entry.position);

        let waitTime = 0;
        entriesAhead?.forEach((e: any) => {
            waitTime += (e.total_duration_minutes || 10);
        });

        // 5. Add remaining time of the current serving entry
        if (currentServing?.estimated_end_at) {
            const now = new Date();
            const estEnd = new Date(currentServing.estimated_end_at);
            const remainingMinutes = Math.max(0, Math.round((estEnd.getTime() - now.getTime()) / 60000));

            // For waiting customers, the wait is (remaining of serving person) + (sum of everyone ahead)
            waitTime += remainingMinutes;
        }

        // Add current entry's estimate if they are still waiting
        if (entry.status === 'waiting') {
            // Fetch current entry's services as well
            const { data: myServices } = await supabase
                .from('queue_entry_services')
                .select('services(duration_minutes)')
                .eq('queue_entry_id', entry.id);

            const myDuration = myServices?.reduce((acc: number, s: any) => acc + (s.services?.duration_minutes || 10), 0) || 10;
            // Usually wait time is "time until your turn", so we don't necessarily add our own duration
            // unless we want "time until completion". Let's stick to "time until start".
        }

        res.status(200).json({
            status: 'success',
            data: {
                business_name: entry.queues?.businesses?.name,
                business_slug: entry.queues?.businesses?.slug,
                display_token: entry.ticket_number,
                current_serving: currentServing?.ticket_number || 'None',
                position: positionAhead + 1,
                estimated_wait_time: waitTime,
                status: entry.status
            }
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const nextEntry = async (req: Request, res: Response) => {
    try {
        const { queue_id } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!queue_id) {
            return res.status(400).json({ status: 'error', message: 'Queue ID is required' });
        }

        // 1. Find next person in line
        const { data: next, error: nextError } = await supabase
            .from('queue_entries')
            .select(`
                *,
                queue_entry_services (service_id)
            `)
            .eq('queue_id', queue_id)
            .eq('status', 'waiting')
            .eq('entry_date', todayStr)
            .order('position', { ascending: true })
            .limit(1)
            .single();

        if (nextError || !next) {
            return res.status(200).json({ status: 'success', message: 'No more customers in queue.' });
        }

        // 2. Find an available provider for this customer
        const { data: busyProviders } = await supabase
            .from('queue_entries')
            .select('assigned_provider_id')
            .eq('entry_date', todayStr)
            .eq('status', 'serving')
            .not('assigned_provider_id', 'is', null);

        const busyProviderIds = busyProviders?.map((p: any) => p.assigned_provider_id) || [];
        const requiredServiceIds = (next as any).queue_entry_services?.map((s: any) => s.service_id) || [];

        const { data: providers } = await supabase
            .from('service_providers')
            .select(`id, name, provider_services (service_id)`)
            .eq('business_id', (req as any).business_id || next.business_id || '') // Fallback to next.business_id if not in req
            .eq('is_active', true);

        const availableProvider = providers?.find((p: any) => {
            const pServiceIds = p.provider_services?.map((ps: any) => ps.service_id) || [];
            const supportsAll = requiredServiceIds.every((rid: string) => pServiceIds.includes(rid));
            const isNotBusy = !busyProviderIds.includes(p.id);
            return supportsAll && isNotBusy;
        });

        if (!availableProvider) {
            return res.status(400).json({
                status: 'error',
                message: "No available expert found for the next customer. Please serve manually when someone is free."
            });
        }

        // 3. Start serving
        const now = new Date();
        const duration = Number(next.total_duration_minutes || 0);
        const estEnd = new Date(now.getTime() + duration * 60000);

        await supabase
            .from('queue_entries')
            .update({
                status: 'serving',
                served_at: now.toISOString(),
                service_started_at: now.toISOString(),
                estimated_end_at: estEnd.toISOString(),
                assigned_provider_id: availableProvider.id
            })
            .eq('id', next.id);

        res.status(200).json({
            status: 'success',
            message: `Next customer ${next.ticket_number} is now being served by ${availableProvider.name}.`
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const extendTime = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { additional_minutes } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!additional_minutes || isNaN(additional_minutes)) {
            return res.status(400).json({ status: 'error', message: 'Valid additional_minutes is required' });
        }

        // 1. Get current entry
        const { data: entry, error: fetchError } = await supabase
            .from('queue_entries')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !entry) {
            return res.status(404).json({ status: 'error', message: 'Entry not found' });
        }

        if (entry.status !== 'serving') {
            return res.status(400).json({ status: 'error', message: 'Can only extend time for customers currently being served' });
        }

        const currentEstEnd = new Date(entry.estimated_end_at || new Date());
        const newEstEnd = new Date(currentEstEnd.getTime() + additional_minutes * 60000);

        // Calculate new delay
        const startTime = new Date(entry.service_started_at);
        const totalProjectedDuration = Math.round((newEstEnd.getTime() - startTime.getTime()) / 60000);
        const newDelay = Math.max(0, totalProjectedDuration - (entry.total_duration_minutes || 0));

        const updates: any = {
            estimated_end_at: newEstEnd.toISOString(),
            delay_minutes: newDelay
        };

        // Delay Alert Mapping
        const lastAlerted = entry.last_alerted_delay_minutes || 0;
        let alertSent = false;

        if (newDelay - lastAlerted >= 10) {
            // Find next waiting entry
            const { data: nextPeople } = await supabase
                .from('queue_entries')
                .select('*')
                .eq('queue_id', entry.queue_id)
                .eq('entry_date', todayStr)
                .eq('status', 'waiting')
                .order('position', { ascending: true })
                .limit(1);

            if (nextPeople && nextPeople.length > 0) {
                const next = nextPeople[0];
                const etaStr = newEstEnd.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
                const recipient = next.phone || (next.user_id ? `User-${next.user_id}` : `Guest-${next.customer_name}`);

                await notificationService.sendSMS(recipient, `Hello ${next.customer_name}, there is a small delay in the queue. Your estimated turn is now around ${etaStr}. We appreciate your patience!`);

                updates.last_alerted_delay_minutes = newDelay;
                alertSent = true;
            }
        }

        const { data: updated, error: updateError } = await supabase
            .from('queue_entries')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        res.status(200).json({
            status: 'success',
            message: alertSent ? 'Time extended and next customer notified' : 'Time extended',
            data: updated
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const assignTaskProvider = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // queue_entry_service_id
        const { provider_id } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data, error } = await supabase
            .from('queue_entry_services')
            .update({ assigned_provider_id: provider_id || null })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Provider assigned to task successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const startTask = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // queue_entry_service_id
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // 1. Fetch task and entry details
        const { data: task, error: taskError } = await supabase
            .from('queue_entry_services')
            .select(`
                *,
                queue_entries!inner (
                    id, 
                    entry_date, 
                    status, 
                    customer_name, 
                    phone, 
                    user_id,
                    queues!inner (business_id)
                )
            `)
            .eq('id', id)
            .single();

        if (taskError || !task) {
            return res.status(404).json({ status: 'error', message: 'Task not found' });
        }

        const providerId = task.assigned_provider_id;
        if (!providerId) {
            return res.status(400).json({ status: 'error', message: 'Please assign an expert to this task first.' });
        }

        // 2. STRICTOR PROVIDER LOCK
        // Check if provider has ANY task 'in_progress' for this business today
        const { data: rawBusyTasks } = await supabase
            .from('queue_entry_services')
            .select(`
                id,
                queue_entries!inner (
                    entry_date,
                    status,
                    queues!inner (business_id)
                )
            `)
            .eq('assigned_provider_id', providerId)
            .eq('task_status', 'in_progress');

        const busyTasks = rawBusyTasks?.filter((b: any) =>
            b.queue_entries?.entry_date === task.queue_entries.entry_date &&
            b.queue_entries?.queues?.business_id === task.queue_entries.queues.business_id &&
            b.queue_entries?.status === 'serving'
        );

        if (busyTasks && busyTasks.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: "The selected expert is currently attending to another guest. Please choose an available expert."
            });
        }

        // 3. Start Task
        const now = new Date();
        const duration = Number(task.duration_minutes || 0);
        const estEnd = new Date(now.getTime() + duration * 60000);

        const { data: updatedTask, error: updateError } = await supabase
            .from('queue_entry_services')
            .update({
                task_status: 'in_progress',
                started_at: now.toISOString(),
                estimated_end_at: estEnd.toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        // 3.5 Recompute delays for this provider's upcoming appointments
        const businessId = task.queue_entries.queues.business_id;
        await recomputeProviderDelays(providerId, businessId, estEnd).catch((err: Error) => {
            console.error('[queueController] Failed to recompute delays in startTask:', err);
        });

        // 4. Update parent entry status to 'serving' if it's currently 'waiting'
        if (task.queue_entries.status === 'waiting') {
            await supabase
                .from('queue_entries')
                .update({
                    status: 'serving',
                    served_at: now.toISOString(),
                    service_started_at: now.toISOString() // First task start marks entry start
                })
                .eq('id', task.queue_entries.id);

            // Sync with parent appointment
            if (task.queue_entries.appointment_id) {
                await supabase
                    .from('appointments')
                    .update({ status: 'in_service' })
                    .eq('id', task.queue_entries.appointment_id);
            }

            // Send Notification for first service start
            const recipient = task.queue_entries.phone || (task.queue_entries.user_id ? `User-${task.queue_entries.user_id}` : `Guest-${task.queue_entries.customer_name}`);
            const etaStr = estEnd.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
            await notificationService.sendSMS(recipient, `Hello ${task.queue_entries.customer_name}, your service has started! Estimated time for this task: ${etaStr}. Thank you!`);
        }

        res.status(200).json({
            status: 'success',
            message: 'Task started successfully',
            data: updatedTask
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const completeTask = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // queue_entry_service_id
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // 1. Fetch task details to check started_at
        const { data: task, error: taskError } = await supabase
            .from('queue_entry_services')
            .select(`
                *,
                queue_entries!inner (id, appointment_id, queues!inner(business_id))
            `)
            .eq('id', id)
            .single();

        if (taskError || !task) {
            return res.status(404).json({ status: 'error', message: 'Task not found' });
        }

        if (!task.started_at) {
            return res.status(400).json({
                status: 'error',
                message: 'This task hasn\'t been started yet. Please start the task before completion.'
            });
        }

        // 2. Calculate metrics
        const now = new Date();
        const startedAt = new Date(task.started_at);
        const actualMinutes = Math.round((now.getTime() - startedAt.getTime()) / 60000);
        const delayMinutes = Math.max(0, actualMinutes - (task.duration_minutes || 0));

        // 3. Mark task as done
        const { data: updatedTask, error: updateError } = await supabase
            .from('queue_entry_services')
            .update({
                task_status: 'done',
                completed_at: now.toISOString(),
                actual_minutes: actualMinutes,
                delay_minutes: delayMinutes
            })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Recompute delays based on actual completion time
        if (task.assigned_provider_id && task.queue_entries?.queues?.business_id) {
            await recomputeProviderDelays(task.assigned_provider_id, task.queue_entries.queues.business_id, now).catch(err => {
                console.error('[queueController] Failed to recompute delays in completeTask:', err);
            });
        }

        // 4. Check if ALL tasks for this entry are done
        const { data: allTasks } = await supabase
            .from('queue_entry_services')
            .select('task_status')
            .eq('queue_entry_id', task.queue_entry_id);

        const allDone = allTasks?.every((t: any) => t.task_status === 'done');

        if (allDone) {
            // Auto-complete the whole entry
            await supabase
                .from('queue_entries')
                .update({
                    status: 'completed',
                    completed_at: now.toISOString()
                })
                .eq('id', task.queue_entry_id);

            // Sync with parent appointment
            if (task.queue_entries.appointment_id) {
                await supabase
                    .from('appointments')
                    .update({
                        status: 'completed',
                        completed_at: now.toISOString()
                    })
                    .eq('id', task.queue_entries.appointment_id);
            }
        }

        res.status(200).json({
            status: 'success',
            message: allDone ? 'All services completed. Guest session finished.' : 'Task completed successfully',
            data: updatedTask
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const skipQueueEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get current entry
        const { data: currentEntry } = await supabase
            .from('queue_entries')
            .select('*')
            .eq('id', id)
            .single();

        if (!currentEntry) {
            return res.status(404).json({ status: 'error', message: 'Entry not found' });
        }

        if (currentEntry.status !== 'waiting') {
            return res.status(400).json({ status: 'error', message: 'Can only skip customers who are in the waiting list.' });
        }

        // 2. Find the entry immediately after this one (next position)
        const { data: nextEntry } = await supabase
            .from('queue_entries')
            .select('id, position')
            .eq('queue_id', currentEntry.queue_id)
            .eq('entry_date', currentEntry.entry_date)
            .eq('status', 'waiting')
            .gt('position', currentEntry.position)
            .order('position', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (!nextEntry) {
            return res.status(400).json({ status: 'error', message: 'Customer is already at the end of the queue.' });
        }

        // 3. Swap positions
        const tempPos = 999999 + Math.floor(Math.random() * 1000);

        await supabase.from('queue_entries').update({ position: tempPos }).eq('id', currentEntry.id);
        await supabase.from('queue_entries').update({ position: currentEntry.position }).eq('id', nextEntry.id);
        await supabase.from('queue_entries').update({ position: nextEntry.position }).eq('id', currentEntry.id);

        // Trigger notifications as positions have swapped
        await processQueueNotifications(currentEntry.queue_id, currentEntry.entry_date, supabase);

        res.status(200).json({
            status: 'success',
            message: `Customer ${currentEntry.ticket_number} skipped. Moved down 1 position.`,
            data: { id: currentEntry.id, new_position: nextEntry.position }
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateQueueEntryPayment = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { payment_method } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Verify ownership
        const { data: entry, error: fetchError } = await supabase
            .from('queue_entries')
            .select('queues!inner(business_id)')
            .eq('id', id)
            .single();

        if (fetchError || !entry) {
            return res.status(404).json({ status: 'error', message: 'Queue entry not found' });
        }

        const { data: businessInfo } = await supabase
            .from('businesses')
            .select('owner_id')
            .eq('id', entry.queues.business_id)
            .single();

        if (!businessInfo || businessInfo.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data, error } = await supabase
            .from('queue_entries')
            .update({
                payment_method,
                payment_status: 'paid',
                paid_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Payment updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
