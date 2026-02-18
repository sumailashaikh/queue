import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';
import { isBusinessOpen } from '../utils/timeUtils';

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
        const { queue_id, customer_name, phone, service_ids } = req.body; // Array of Service IDs
        const user_id = req.user?.id; // From authMiddleware
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!queue_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Queue ID is required'
            });
        }

        if (!user_id && !customer_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Either User ID (auth) or Customer Name is required'
            });
        }

        // Get current date in YYYY-MM-DD format
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // 0. Get Queue and Business info for notification
        const { data: queueInfo, error: queueInfoError } = await supabase
            .from('queues')
            .select('*, businesses(name, open_time, close_time, is_closed)')
            .eq('id', queue_id)
            .single();

        if (queueInfoError) throw queueInfoError;

        // Check Business Hours
        if (queueInfo?.businesses) {
            const status = isBusinessOpen(queueInfo.businesses);
            if (!status.isOpen) {
                return res.status(400).json({ status: 'error', message: status.message });
            }
        }

        // 1. Get current max position for TODAY to determine new position
        const { data: maxPosData, error: maxPosError } = await supabase
            .from('queue_entries')
            .select('position')
            .eq('queue_id', queue_id)
            .eq('entry_date', todayStr) // Reset daily based on date column
            .order('position', { ascending: false })
            .limit(1);

        if (maxPosError) throw maxPosError;

        const nextPosition = (maxPosData && maxPosData.length > 0) ? maxPosData[0].position + 1 : 1;

        // 2. Generate Ticket Number
        const ticket_number = `Q-${nextPosition}`;
        const status_token = crypto.randomUUID();

        // 2.5 Fetch all selected services to calculate total duration and get names
        let selectedServices = [];
        if (service_ids && service_ids.length > 0) {
            const { data: sData } = await supabase
                .from('services')
                .select('id, name, duration_minutes')
                .in('id', service_ids);
            selectedServices = sData || [];
        }

        const totalEntryDuration = selectedServices.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0);
        const serviceNamesDisplay = selectedServices.map((s: any) => s.name).join(', ') || 'General';

        // 3. Insert Entry
        const { data, error } = await supabase
            .from('queue_entries')
            .insert([
                {
                    queue_id,
                    user_id: user_id || null,
                    customer_name: customer_name || 'Guest',
                    phone: phone || null,
                    service_name: serviceNamesDisplay, // Combined display name
                    status: 'waiting',
                    position: nextPosition,
                    ticket_number,
                    status_token,
                    entry_date: todayStr
                }
            ])
            .select()
            .single();

        if (error) throw error;

        // 3.5 Link Multiple Services in Junction Table
        if (service_ids && service_ids.length > 0) {
            const junctionEntries = service_ids.map((sId: string) => ({
                entry_id: data.id,
                service_id: sId
            }));
            await supabase.from('queue_entry_services').insert(junctionEntries);
        }

        // Send Notification
        const recipient = phone || (user_id ? `User-${user_id}` : `Guest-${customer_name}`);
        const businessName = queueInfo?.businesses?.name || 'the salon';
        const smsMessage = `You've joined the queue at ${businessName}! Ticket: ${ticket_number}. Live Status: ${req.headers.origin}/status?token=${status_token}. Thank you!`;
        await notificationService.sendSMS(recipient, smsMessage);

        // Calculate estimated wait time based on cumulative duration of people ahead
        // We'll fetch all entries in this queue today that are ahead
        const { data: entriesAhead } = await supabase
            .from('queue_entries')
            .select(`
                id,
                queue_entry_services!entry_id (
                    services!service_id (duration_minutes)
                )
            `)
            .eq('queue_id', queue_id)
            .eq('entry_date', todayStr)
            .eq('status', 'waiting')
            .lt('position', nextPosition);

        let wait_time = 0;
        if (entriesAhead) {
            entriesAhead.forEach((entry: any) => {
                const entryDuration = entry.queue_entry_services?.reduce((acc: number, s: any) => acc + (s.services?.duration_minutes || 10), 0) || 10;
                wait_time += entryDuration;
            });
        }

        res.status(201).json({
            status: 'success',
            message: 'Joined queue successfully',
            data: {
                ...data,
                token: status_token,
                position: nextPosition,
                wait_time,
                status_url: `${req.headers.origin || ''}/status?token=${status_token}`
            }
        });

    } catch (error: any) {
        console.error('Join Queue Error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
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

        const { data, error } = await supabase
            .from('queue_entries')
            .select(`
                *,
                queue_entry_services!entry_id (
                    services!service_id (id, name, duration_minutes)
                )
            `)
            .eq('queue_id', id)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving']) // Only active people
            .order('position', { ascending: true });

        if (error) throw error;


        console.log(`Found ${data?.length} active entries for queue ${id} today (${todayStr})`);

        // Note: If data is empty, it might be due to RLS if user is not owner. 
        // But our RLS "Business owners can see entries for their queues" allows this.

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

export const updateQueueEntryStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // entry_id
        const { status } = req.body; // 'serving', 'completed', 'cancelled', 'no_show'
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!['waiting', 'serving', 'completed', 'cancelled', 'no_show'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        const updates: any = { status };
        if (status === 'serving') updates.served_at = new Date().toISOString();
        if (status === 'completed') updates.completed_at = new Date().toISOString();

        console.log(`Updating queue entry ${id} with status ${status} by user ${userId}`);

        // Update the entry
        // RLS "Business owners can update entries" will enforce permission
        const { data, error } = await supabase
            .from('queue_entries')
            .update(updates)
            .eq('id', id)
            .select(`
                *,
                queues (name, business_id)
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

        if (status === 'serving') {
            await notificationService.sendSMS(recipient, `It's your turn for ${entry.queues.name}! Please proceed to the counter.`);

            // Refinement: Notify the next person in line (who is now technically position 1 or 2 depending on how you count)
            // Let's find the person with the lowest position who is still 'waiting'
            const { data: nextPeople } = await supabase
                .from('queue_entries')
                .select('*')
                .eq('queue_id', entry.queue_id)
                .eq('status', 'waiting')
                .order('position', { ascending: true })
                .limit(2); // Notify the very next one

            if (nextPeople && nextPeople.length > 0) {
                const nextPerson = nextPeople[0];
                const nextRecipient = nextPerson.user_id ? `User-${nextPerson.user_id}` : `Guest-${nextPerson.customer_name}`;
                await notificationService.sendSMS(nextRecipient, `Hello ${nextPerson.customer_name},\n\nYour turn for *${entry.queues.name}* is approaching! You are next in line.`);
            }

        } else if (status === 'completed') {
            await notificationService.sendSMS(recipient, `Thanks for visiting! We hope to see you again.`);
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
            .select('ticket_number')
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

        // 4. Calculate total wait time based on services of people ahead
        const { data: entriesAhead } = await supabase
            .from('queue_entries')
            .select(`
                id,
                queue_entry_services(
                    services(duration_minutes)
                )
            `)
            .eq('queue_id', entry.queue_id)
            .eq('status', 'waiting')
            .eq('entry_date', entry.entry_date)
            .lt('position', entry.position);

        let estimatedWait = 0;
        if (entriesAhead) {
            entriesAhead.forEach((aheadEntry: any) => {
                const duration = aheadEntry.queue_entry_services?.reduce((acc: number, s: any) => acc + (s.services?.duration_minutes || 10), 0) || 10;
                estimatedWait += duration;
            });
        }

        // Add current entry's estimate if they are still waiting
        if (entry.status === 'waiting') {
            // Fetch current entry's services as well
            const { data: myServices } = await supabase
                .from('queue_entry_services')
                .select('services(duration_minutes)')
                .eq('entry_id', entry.id);

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
                estimated_wait_time: estimatedWait,
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

        // 1. Mark current serving as completed
        await supabase
            .from('queue_entries')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('queue_id', queue_id)
            .eq('status', 'serving')
            .eq('entry_date', todayStr);

        // 2. Find next person in line
        const { data: next, error: nextError } = await supabase
            .from('queue_entries')
            .select('*')
            .eq('queue_id', queue_id)
            .eq('status', 'waiting')
            .eq('entry_date', todayStr)
            .order('position', { ascending: true })
            .limit(1)
            .single();

        if (next) {
            await supabase
                .from('queue_entries')
                .update({ status: 'serving', served_at: new Date().toISOString() })
                .eq('id', next.id);

            // Optional: Trigger WhatsApp/SMS Notification here
        }

        res.status(200).json({
            status: 'success',
            message: next ? `Next customer ${next.ticket_number} is now being served.` : 'No more customers in queue.'
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
