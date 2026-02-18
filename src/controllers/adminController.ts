import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

/**
 * Get all users registered on the platform
 */
export const getAllUsers = async (req: any, res: Response) => {
    try {
        const { search, role, status, page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const supabase = req.supabase;

        let query = supabase
            .from('profiles')
            .select('*', { count: 'exact' });

        if (search) {
            query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
        }

        if (role) {
            query = query.eq('role', role);
        }

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + Number(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data,
            pagination: {
                total: count,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        console.error('[ADMIN] GetUsers Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Update a user's role (admin, owner, customer)
 */
export const updateUserRole = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        const supabase = req.supabase;

        if (!['admin', 'owner', 'customer'].includes(role)) {
            return res.status(400).json({ status: 'error', message: 'Invalid role' });
        }

        const { data, error } = await supabase
            .from('profiles')
            .update({ role })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'User role updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Get all businesses registered on the platform
 */
export const getAllBusinesses = async (req: any, res: Response) => {
    try {
        const supabase = req.supabase;
        const { data, error } = await supabase
            .from('businesses')
            .select(`
                *,
                owner:profiles!owner_id (full_name, phone)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Update a user's status (active, pending, blocked) and verification
 */
export const updateUserStatus = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { status, is_verified } = req.body;
        const supabase = req.supabase;

        const updates: any = {};
        if (status) updates.status = status;
        if (is_verified !== undefined) updates.is_verified = is_verified;

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'User status updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Promote a user to Admin by phone number (Invite)
 */
export const inviteAdmin = async (req: any, res: Response) => {
    try {
        const { phone } = req.body;
        const supabase = req.supabase;

        if (!phone) {
            return res.status(400).json({ status: 'error', message: 'Phone number is required' });
        }

        // Check if user exists
        const { data: profile, error: findError } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('phone', phone)
            .single();

        if (findError || !profile) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found. Ask them to login once first, then you can promote them.'
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .update({ role: 'admin', status: 'active', is_verified: true })
            .eq('id', profile.id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: `${profile.full_name} promoted to Admin successfully`,
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
/**
 * Get detailed stats for a specific business (Admin Only)
 */
export const getBusinessDetails = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const supabase = req.supabase;

        // Get current date string (India Time)
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        const { data: qEntries, error: qError } = await supabase
            .from('queue_entries')
            .select(`
                id,
                status,
                customer_name,
                ticket_number,
                joined_at,
                queue_entry_services!entry_id (
                    services!service_id (id, name, price)
                )
            `)
            .eq('queues.business_id', id)
            .eq('entry_date', todayStr);

        if (qError) throw qError;

        // Fetch Appointments for today
        const { data: appointments, error: aError } = await supabase
            .from('appointments')
            .select(`
                id,
                status,
                guest_name,
                start_time,
                profiles (full_name),
                appointment_services (
                    services (id, name, price)
                )
            `)
            .eq('business_id', id)
            .gte('start_time', `${todayStr}T00:00:00`)
            .lte('start_time', `${todayStr}T23:59:59`);

        if (aError) throw aError;

        // Calculate Aggregate Stats
        let completedVisits = 0;
        let totalRevenue = 0;
        let totalCustomers = (qEntries?.length || 0) + (appointments?.length || 0);

        // Stats from Queues
        qEntries?.forEach((entry: any) => {
            if (entry.status === 'completed') {
                completedVisits++;
                const entryPrice = entry.queue_entry_services?.reduce((acc: number, as: any) => acc + (as.services?.price || 0), 0) || 0;
                totalRevenue += entryPrice;
            }
        });

        // Stats from Appointments
        appointments?.forEach((appt: any) => {
            if (appt.status === 'completed') {
                completedVisits++;
                const apptPrice = appt.appointment_services?.reduce((acc: number, as: any) => acc + (as.services?.price || 0), 0) || 0;
                totalRevenue += apptPrice;
            }
        });

        // 5. Merge Recent Activity for Detail View
        const recentActivity = [
            ...(qEntries?.map((e: any) => ({
                id: e.id,
                type: 'queue',
                name: e.customer_name,
                token: e.ticket_number,
                status: e.status,
                time: e.joined_at,
                service: e.queue_entry_services?.map((as: any) => as.services?.name).join(', ') || 'Walk-in'
            })) || []),
            ...(appointments?.map((a: any) => ({
                id: a.id,
                type: 'appointment',
                name: a.guest_name || a.profiles?.full_name || 'Customer',
                token: 'BOOKED',
                status: a.status,
                time: a.start_time,
                service: a.appointment_services?.map((as: any) => as.services?.name).join(', ') || 'Service'
            })) || [])
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10);

        // Wait time remains queue-centric
        let totalWaitTime = 0;
        let waitTimeCount = 0;
        const { data: waitStats } = await supabase
            .from('queue_entries')
            .select('joined_at, served_at')
            .eq('queues.business_id', id)
            .eq('entry_date', todayStr)
            .not('served_at', 'is', null);

        waitStats?.forEach((entry: any) => {
            const joined = new Date(entry.joined_at).getTime();
            const served = new Date(entry.served_at).getTime();
            totalWaitTime += Math.max(0, (served - joined) / (1000 * 60));
            waitTimeCount++;
        });

        const avgWaitTimeMinutes = waitTimeCount > 0 ? Math.round(totalWaitTime / waitTimeCount) : 0;

        res.status(200).json({
            status: 'success',
            data: {
                totalCustomers,
                completedVisits,
                totalRevenue,
                avgWaitTimeMinutes,
                recentActivity
            }
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Manually create a user profile (Admin Only)
 */
export const createUser = async (req: any, res: Response) => {
    try {
        const { full_name, phone, role } = req.body;
        const supabase = req.supabase;

        if (!phone || !full_name) {
            return res.status(400).json({ status: 'error', message: 'Name and Phone are required' });
        }

        // Check if user already exists
        const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('phone', phone)
            .single();

        if (existing) {
            return res.status(400).json({ status: 'error', message: 'User with this phone number already exists' });
        }

        // Create a profile directly. 
        // Note: auth.users entry will be created when the user first logs in with this phone.
        // We use a temporary UUID for profiles created manually if they don't have an auth entry yet.
        // But the best way is to let the profile be created with a null ID or use a specific trigger.
        // For now, let's assume we use a generated ID and handle the link during first login in verifyOtp.

        const { data, error } = await supabase
            .from('profiles')
            .insert([{
                full_name,
                phone,
                role: role || 'customer',
                status: 'active',
                is_verified: true
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'User profile created successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
