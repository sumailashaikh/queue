import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';

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
                owner:profiles!owner_id (id, full_name, phone, status, is_verified)
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
        if (status) {
            updates.status = status;
            // SYNC: If moving to active, also verify. If blocked, unverify.
            if (status === 'active') updates.is_verified = true;
            if (status === 'blocked') updates.is_verified = false;
        }
        if (is_verified !== undefined) {
            updates.is_verified = is_verified;
            // SYNC: If verified, set status to active
            if (is_verified === true) updates.status = 'active';
        }

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

        // Check if user exists - Try multiple formats for phone matching robustness
        const formats = [
            phone,                                   // e.g. +91 98765 43210
            phone.replace(/\+/g, ''),               // e.g. 91 98765 43210
            phone.replace(/\D/g, ''),               // e.g. 919876543210
            phone.replace(/\D/g, '').slice(-10)     // e.g. 9876543210
        ];
        
        const uniqueFormats = [...new Set(formats)];
        const { data: profile, error: findError } = await supabase
            .from('profiles')
            .select('id, full_name, phone')
            .or(`phone.in.(${uniqueFormats.map(f => `"${f}"`).join(',')})`)
            .maybeSingle();

        if (findError || !profile) {
            console.log(`[ADMIN] User not found, falling back to pending_registrations for phone:`, phone);
            
            // Insert into pending_registrations so they get the role upon first login
            try {
                const { error: pendingError } = await supabase
                    .from('pending_registrations')
                    .upsert([{
                        phone: phone,
                        role: 'admin',
                        is_verified: true,
                        full_name: 'Invited Admin'
                    }]);

                if (pendingError) {
                    if (pendingError.code === 'P0001' || pendingError.message?.includes('relation "pending_registrations" does not exist')) {
                        return res.status(500).json({ 
                            status: 'error', 
                            message: 'Onboarding system not initialized. Please run the SQL script "fix_onboarding.sql" in your Supabase Dashboard to enable invitations for new users.' 
                        });
                    }
                    throw pendingError;
                }
            } catch (pErr: any) {
                console.error('[ADMIN] Invite pending fallback failed:', pErr);
                return res.status(500).json({ status: 'error', message: 'Admin invitation failed. Please ensure the project database is fully updated.' });
            }

            const msg = `Hello! You have been invited as an Admin on QueueUp. Please login with your phone number to gain access: https://queue-admin-182k.vercel.app/`;
            await notificationService.sendWhatsApp(phone, msg);

            return res.status(200).json({
                status: 'success',
                message: 'No existing profile found. This number has been successfully pre-registered as an Admin. They will receive their role automatically as soon as they login to the app with this number.'
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .update({ role: 'admin', status: 'active', is_verified: true })
            .eq('id', profile.id)
            .select()
            .single();

        if (error) throw error;

        // Send WhatsApp Notification for existing user promotion
        const welcomeMsg = `Hello ${profile.full_name}! You have been promoted to Admin on QueueUp. Please login to your dashboard here: https://queue-admin-182k.vercel.app/`;
        await notificationService.sendWhatsApp(profile.phone, welcomeMsg);

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

        // Get business details including timezone
        const { data: businessInfo } = await supabase
            .from('businesses')
            .select('timezone')
            .eq('id', id)
            .single();

        const timezone = businessInfo?.timezone || 'UTC';
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

        const { data: qEntries, error: qError } = await supabase
            .from('queue_entries')
            .select(`
                id,
                status,
                customer_name,
                ticket_number,
                joined_at,
                total_price,
                queue_entry_services!queue_entry_id (
                    services!service_id (id, name, price)
                ),
                queues!inner (business_id)
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
                totalRevenue += Number(entry.total_price || 0);
            }
        });

        // Stats from Appointments
        appointments?.forEach((appt: any) => {
            if (appt.status === 'completed') {
                completedVisits++;
                // Note: appointments still use junction calc until total_price added there too
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
                service: e.queue_entry_services?.map((as: any) => as.services?.name).filter(Boolean).join(', ') || 'Walk-in'
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
            .select('joined_at, served_at, queues!inner(business_id)')
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
        console.error('[ADMIN] CreateUser Error:', error);
        
        // If it's a FK (23503), NOT-NULL (23502) or RLS error, it usually means the user doesn't exist in auth.
        // Let's try to save it to pending_registrations as a fallback.
        if (['23503', '23502', '42501'].includes(error.code) || error.message?.includes('violates') || error.message?.includes('security')) {
            try {
                const { full_name, phone, role } = req.body;
                const supabase = req.supabase || require('../config/supabaseClient').supabase;
                const { error: pError } = await supabase.from('pending_registrations').upsert([{
                    phone: phone,
                    full_name: full_name,
                    role: role || 'owner',
                    is_verified: true
                }]);
                
                if (pError) {
                    if (pError.message?.includes('relation "pending_registrations" does not exist')) {
                        return res.status(500).json({ 
                            status: 'error', 
                            message: 'Action blocked: Onboarding system not ready. Please run the "fix_onboarding.sql" script in your Supabase SQL Editor to support inviting new users.' 
                        });
                    }
                    throw pError;
                }

                const msg = `Hello ${full_name || 'there'}! You have been added as a ${role || 'Owner'} on QueueUp. Please login to your management portal here: https://queue-admin-182k.vercel.app/`;
                await notificationService.sendWhatsApp(phone, msg);
                
                return res.status(201).json({
                    status: 'success',
                    message: `User pre-registered successfully. Since this number is not yet in our system, they will be automatically set up as ${role || 'owner'} when they login for the first time via Mobile OTP.`
                });
            } catch (innerError: any) {
                console.error('[ADMIN] Pending fallback failed:', innerError);
            }
        }

        let message = error.message;
        let statusCode = 500;
        
        if (error.code === '23503' || (error.message && error.message.includes('foreign key'))) {
            statusCode = 400;
            message = "This user cannot be manually created yet. Due to system security, they must first sign in to the app themselves using Mobile OTP to initialize their account. After that, you can update their role here.";
        }
        res.status(statusCode).json({ status: 'error', message });
    }
};

/**
 * Invite an Employee to a business by phone number
 */
export const inviteEmployee = async (req: any, res: Response) => {
    try {
        const { phone, full_name, business_id, role, custom_message } = req.body;
        const supabase = req.supabase;
        const userId = req.user?.id;

        if (!phone || !business_id) {
            return res.status(400).json({ status: 'error', message: 'Phone and Business ID are required' });
        }

        // 1. Verify ownership of business
        const adminSupabase = require('../config/supabaseClient').supabase;
        
        const { data: business } = await adminSupabase
            .from('businesses')
            .select('id, name, owner_id')
            .eq('id', business_id)
            .single();

        if (!business || business.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: Only the business owner can invite employees.' });
        }

        // 2. Check if user already exists
        const { data: profile } = await adminSupabase
            .from('profiles')
            .select('id, full_name')
            .eq('phone', phone)
            .maybeSingle();

        if (profile) {
            const { error: updateError } = await adminSupabase
                .from('profiles')
                .update({ 
                    role: role || 'employee', 
                    business_id,
                    status: 'INVITED' 
                })
                .eq('id', profile.id);

            if (updateError) throw updateError;
        } else {
            const { error: pendingError } = await adminSupabase
                .from('pending_registrations')
                .upsert([{
                    phone,
                    role: role || 'employee',
                    business_id,
                    full_name: full_name || 'Invited Employee',
                    is_verified: true,
                    status: 'INVITED'
                }]);

            if (pendingError) throw pendingError;
        }

        // 2b. Service Provider link
        try {
            const { data: existingSP } = await adminSupabase
                .from('service_providers')
                .select('id')
                .eq('user_id', profile ? profile.id : null)
                .maybeSingle();

            if (!existingSP) {
                await adminSupabase.from('service_providers').insert({
                    business_id,
                    name: full_name || 'Invited Employee',
                    user_id: profile ? profile.id : null, 
                    status: 'active'
                });
            }
        } catch (spError) {
            console.error('[ADMIN] Auto-create service_provider fail:', spError);
        }

        // 3. Notify via Message (Custom or default)
        const defaultMsg = `Hello ${full_name || 'there'}! You have been invited as an Employee at ${business.name} on QueueUp. Login here: https://queue-admin-182k.vercel.app/`;
        const msg = custom_message || defaultMsg;
        
        // Attempt WhatsApp first, then fallback to SMS
        const { notificationService } = require('../services/notificationService');
        
        let notified = false;
        if (!notificationService.isMock) {
            // Send WhatsApp
            notified = await notificationService.sendWhatsApp(phone, msg);
            // Also send SMS for redundancy
            await notificationService.sendSMS(phone, msg);
        }

        res.status(200).json({
            status: 'success',
            message: notified ? 'Employee invited successfully via WhatsApp/SMS!' : 'Employee added (Notification system in mock mode).',
            notified: notified
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Deactivate an employee with safety check for active tasks
 */
export const deactivateEmployee = async (req: any, res: Response) => {
    try {
        const { employee_id } = req.params;
        const userId = req.user?.id;

        // 1. Fetch service provider to confirm existence and identify linked profile
        const adminSupabase = require('../config/supabaseClient').supabase;
        
        const { data: provider } = await adminSupabase
            .from('service_providers')
            .select('id, business_id, name, user_id')
            .eq('id', employee_id)
            .single();

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Employee not found in service roster.' });
        }

        // 2. Fetch business owner profile to verify ownership
        const { data: business } = await adminSupabase
            .from('businesses')
            .select('id, name, owner_id')
            .eq('id', provider.business_id)
            .eq('owner_id', userId)
            .single();
            
        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: Only the business owner can manage their employees.' });
        }

        // 3. SAFETY CHECK: Check for active tasks
        const { count: taskCount } = await adminSupabase
            .from('queue_entry_services')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_provider_id', provider.id)
            .in('task_status', ['pending', 'in_progress']);

        if (taskCount && taskCount > 0) {
            return res.status(400).json({
                status: 'error',
                message: `Safety Block: This employee has ${taskCount} active tasks. Please reassign or complete them before deactivation.`
            });
        }

        // 4. Deactivate Service Provider record
        const { error: spError } = await adminSupabase
            .from('service_providers')
            .update({ is_active: false })
            .eq('id', employee_id);

        if (spError) throw spError;

        // 5. Deactivate linked Profile if exists
        if (provider.user_id) {
            const { error: profileError } = await adminSupabase
                .from('profiles')
                .update({ status: 'INACTIVE' })
                .eq('id', provider.user_id);
                
            if (profileError) {
                console.error('[ADMIN] Failed to deactivate linked profile:', profileError);
                // Non-blocking: We still deactivated the provider record
            }

            // Notify (Optional)
            const { data: profile } = await adminSupabase.from('profiles').select('phone').eq('id', provider.user_id).single();
            if (profile?.phone) {
                await notificationService.sendWhatsApp(profile.phone, `Your access to ${business.name} has been revoked. Please contact your manager.`);
            }
        }

        res.status(200).json({
            status: 'success',
            message: 'Employee deactivated successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Get platform-wide statistics (Admin Only)
 */
export const getGlobalStats = async (req: any, res: Response) => {
    try {
        const supabase = req.supabase;

        // 1. Total Users
        const { count: totalUsers, error: uError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        if (uError) throw uError;

        // 2. Total Businesses
        const { count: totalBusinesses, error: bError } = await supabase
            .from('businesses')
            .select('*', { count: 'exact', head: true });

        if (bError) throw bError;

        // 3. Pending Verifications (profiles where owner is not verified)
        const { count: pendingVerifications, error: pError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('is_verified', false)
            .eq('role', 'owner');

        if (pError) throw pError;

        // 4. Calculate Platform Health (e.g., % of businesses that are active/verified)
        // For now, let's just return a realistic % based on verified vs total businesses
        const { count: verifiedOwners, error: vError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .eq('role', 'owner')
            .eq('is_verified', true);

        if (vError) throw vError;

        const health = totalBusinesses && totalBusinesses > 0
            ? Math.round((verifiedOwners || 0) / (totalBusinesses) * 100)
            : 100;

        res.status(200).json({
            status: 'success',
            data: {
                totalUsers: totalUsers || 0,
                activeBusinesses: totalBusinesses || 0,
                pendingVerifications: pendingVerifications || 0,
                platformHealth: `${health}%`
            }
        });
    } catch (error: any) {
        console.error('[ADMIN] GetGlobalStats Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};
