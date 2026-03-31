import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const createServiceProvider = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id, name, phone, role, department, translations } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!business_id || !name) {
            return res.status(400).json({ status: 'error', message: 'Business ID and Name are required' });
        }

        // Verify ownership via RLS or explicit check
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (bizError || !business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized to add providers to this business' });
        }

        // Check if a provider with this name already exists for this business
        const { data: existing, error: checkError } = await supabase
            .from('service_providers')
            .select('id, is_active')
            .eq('business_id', business_id)
            .eq('name', name)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existing) {
            if (existing.is_active) {
                return res.status(400).json({ 
                    status: 'error', 
                    message: 'A provider with this name already exists and is currently active.' 
                });
            } else {
                // Reactivate and update the existing record
                const { data, error: updateError } = await supabase
                    .from('service_providers')
                    .update({ 
                        is_active: true,
                        phone,
                        role,
                        department,
                        translations: translations || {}
                    })
                    .eq('id', existing.id)
                    .select()
                    .single();

                if (updateError) throw updateError;
                
                return res.status(200).json({
                    status: 'success',
                    message: 'Existing provider reactivated successfully',
                    data
                });
            }
        }

        const { data, error } = await supabase
            .from('service_providers')
            .insert([{ business_id, name, phone, role, department, translations: translations || {} }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'Service provider created successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getServiceProviders = async (req: Request, res: Response) => {
    try {
        const { business_id, date } = req.query;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        let query = supabase.from('service_providers').select('*, services:provider_services(services(id, name))');

        if (business_id) {
            query = query.eq('business_id', business_id);
        } else {
            // If no business_id provided, find businesses owned by user
            const { data: businesses } = await supabase
                .from('businesses')
                .select('id')
                .eq('owner_id', userId);

            if (businesses && businesses.length > 0) {
                const businessIds = businesses.map((b: any) => b.id);
                query = query.in('business_id', businessIds);
            } else {
                return res.status(200).json({ status: 'success', data: [] });
            }
        }

        const { data: providers, error } = await query.order('name', { ascending: true });

        if (error) throw error;

        // Determine the target timezone
        let timezone = 'UTC';
        if (business_id) {
            const { data: biz } = await supabase.from('businesses').select('timezone').eq('id', business_id).single();
            if (biz?.timezone) timezone = biz.timezone;
        }

        // Determine the target date for availability
        const targetDateStr = date ? String(date) : new Date().toLocaleDateString('en-CA', { timeZone: timezone });

        // Fetch all active leaves for these providers on the target date
        let leavesOnTargetDate: any[] = [];
        if (providers && providers.length > 0) {
            const providerIds = providers.map((p: any) => p.id);
            const { data: leaves } = await supabase
                .from('provider_leaves')
                .select('provider_id')
                .in('provider_id', providerIds)
                .lte('start_date', targetDateStr)
                .gte('end_date', targetDateStr);

            if (leaves) leavesOnTargetDate = leaves;
        }

        const providersOnLeaveIds = new Set(leavesOnTargetDate.map((l: any) => l.provider_id));

        // Enhancement: Fetch all leaves for these providers to compute "upcoming" status
        let allRecentLeaves: any[] = [];
        if (providers && providers.length > 0) {
            const providerIds = providers.map((p: any) => p.id);
            const { data: recentLeaves } = await supabase
                .from('provider_leaves')
                .select('*')
                .in('provider_id', providerIds)
                .gte('end_date', targetDateStr);
            if (recentLeaves) allRecentLeaves = recentLeaves;
        }

        // Enhance with current task count and availability
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone });

        const enhancedProviders = await Promise.all((providers || []).map(async (p: any) => {
            let currentTasksCount = 0;
            // Only fetch task count if assessing today's data to save DB hits if checking future dates
            if (targetDateStr === todayStr) {
                const { data: busyTasks } = await supabase
                    .from('queue_entry_services')
                    .select(`
                        id,
                        queue_entries!inner (
                            entry_date,
                            status
                        )
                    `)
                    .eq('assigned_provider_id', p.id)
                    .eq('task_status', 'in_progress')
                    .eq('queue_entries.entry_date', todayStr)
                    .eq('queue_entries.status', 'serving');
                currentTasksCount = busyTasks?.length || 0;
            }

            // Compute leave status
            const providerLeaves = allRecentLeaves.filter((l: any) => l.provider_id === p.id);
            const currentLeave = providerLeaves.find((l: any) => l.start_date <= targetDateStr && l.end_date >= targetDateStr);
            const upcomingLeave = providerLeaves.find((l: any) => l.start_date > targetDateStr && l.start_date <= tomorrowStr);

            let leave_status = 'available';
            let leave_until = null;
            let leave_starts_at = null;

            if (currentLeave) {
                leave_status = 'on_leave';
                leave_until = currentLeave.end_date;
            } else if (upcomingLeave) {
                leave_status = 'upcoming';
                leave_starts_at = upcomingLeave.start_date;
            }

            return {
                ...p,
                is_available: leave_status === 'available' && p.is_active !== false,
                leave_status,
                leave_until,
                leave_starts_at,
                current_tasks_count: currentTasksCount,
                services: p.services?.map((ps: any) => ps.services).filter(Boolean) || []
            };
        }));

        res.status(200).json({
            status: 'success',
            data: enhancedProviders
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateServiceProvider = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // RLS handles ownership, but we check if we got data back
        const { data, error } = await supabase
            .from('service_providers')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ status: 'error', message: 'Service provider not found or unauthorized' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Service provider updated successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const deleteServiceProvider = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Soft delete
        const { data, error } = await supabase
            .from('service_providers')
            .update({ is_active: false })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ status: 'error', message: 'Service provider not found or unauthorized' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Service provider deactivated successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getMyProviderProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data, error } = await supabase
            .from('service_providers')
            .select('*, businesses(*), services:provider_services(services(*))')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            return res.status(404).json({ status: 'error', message: 'Provider profile not found' });
        }

        res.status(200).json({ status: 'success', data });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const assignProviderServices = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { service_ids } = req.body; // array of service_ids
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!Array.isArray(service_ids)) {
            return res.status(400).json({ status: 'error', message: 'service_ids must be an array' });
        }

        // 1. Verify provider belongs to owner
        const { data: provider } = await supabase
            .from('service_providers')
            .select('id, business_id')
            .eq('id', id)
            .single();

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Provider not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', provider.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Clear existing services
        await supabase.from('provider_services').delete().eq('provider_id', id);

        // 3. Insert new services
        if (service_ids.length > 0) {
            const inserts = service_ids.map(sid => ({
                provider_id: id,
                service_id: sid
            }));
            const { error: insertError } = await supabase.from('provider_services').insert(inserts);
            if (insertError) throw insertError;
        }

        res.status(200).json({
            status: 'success',
            message: 'Services assigned to provider successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getProviderAvailability = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data, error } = await supabase
            .from('provider_availability')
            .select('*')
            .eq('provider_id', id)
            .order('day_of_week', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: data || []
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateProviderAvailability = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { availability } = req.body; // Array of {day_of_week, start_time, end_time, is_available}
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Verify ownership
        const { data: provider } = await supabase
            .from('service_providers')
            .select('id, business_id')
            .eq('id', id)
            .single();

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Provider not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', provider.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Clear existing availability
        await supabase.from('provider_availability').delete().eq('provider_id', id);

        // 3. Insert new availability
        if (Array.isArray(availability) && availability.length > 0) {
            const inserts = availability.map((a: any) => ({
                provider_id: id,
                day_of_week: a.day_of_week,
                start_time: a.start_time,
                end_time: a.end_time,
                is_available: a.is_available ?? true
            }));
            const { error: insertError } = await supabase.from('provider_availability').insert(inserts);
            if (insertError) throw insertError;
        }

        res.status(200).json({
            status: 'success',
            message: 'Provider availability updated successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const assignProviderToEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // entry_id
        const { provider_id } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Verify entry belongs to business owned by user
        const { data: entry, error: entryError } = await supabase
            .from('queue_entries')
            .select('id, queue_id, queues(business_id)')
            .eq('id', id)
            .single();

        if (entryError || !entry) {
            return res.status(404).json({ status: 'error', message: 'Entry not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', (entry as any).queues.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. If provider_id is provided, verify it exists and is active for this business
        if (provider_id) {
            const { data: provider } = await supabase
                .from('service_providers')
                .select('id')
                .eq('id', provider_id)
                .eq('business_id', (entry as any).queues.business_id)
                .eq('is_active', true)
                .single();

            if (!provider) {
                return res.status(400).json({ status: 'error', message: 'Invalid or inactive provider' });
            }
        }

        // 3. Update entry
        const { error: updateError } = await supabase
            .from('queue_entries')
            .update({ assigned_provider_id: provider_id || null })
            .eq('id', id);

        if (updateError) throw updateError;

        res.status(200).json({
            status: 'success',
            message: 'Expert assigned to entry successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ----------------------------------------------------
// Provider Leaves
// ----------------------------------------------------

export const getProviderLeaves = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { business_id } = req.query; // optional but recommended
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        let query = supabase
            .from('provider_leaves')
            .select('*')
            .eq('provider_id', id);

        if (business_id) {
            query = query.eq('business_id', business_id);
        }

        const { data, error } = await query.order('start_date', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: data || []
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const addProviderLeave = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { start_date, end_date, leave_type, note } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!start_date || !end_date || !leave_type) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        // 1. Verify ownership OR self-application
        const { data: provider } = await supabase
            .from('service_providers')
            .select('id, business_id, user_id')
            .eq('id', id)
            .single();

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Provider not found' });
        }

        // Check if user is the owner of the business OR the provider themselves
        const { data: business } = await supabase
            .from('businesses')
            .select('id, owner_id')
            .eq('id', provider.business_id)
            .single();

        const isOwner = business?.owner_id === userId;
        const isSelf = provider.user_id === userId;

        if (!isOwner && !isSelf) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: You can only apply for your own leave or for employees you own.' });
        }

        // 2. Overlap check application level
        const { data: overlaps } = await supabase
            .from('provider_leaves')
            .select('id')
            .eq('provider_id', id)
            .lte('start_date', end_date)
            .gte('end_date', start_date)
            .neq('status', 'REJECTED'); // Don't count rejected leaves

        if (overlaps && overlaps.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'This provider already has a leave scheduled or pending during these dates.'
            });
        }

        // 3. Determine status based on role
        const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', userId).single();
        const isAdminOrOwner = profile?.role === 'owner' || profile?.role === 'admin';
        const status = isAdminOrOwner ? 'APPROVED' : 'PENDING';

        // 4. Insert leave
        const { data, error } = await supabase
            .from('provider_leaves')
            .insert([{
                provider_id: id,
                business_id: provider.business_id,
                start_date,
                end_date,
                leave_type,
                note,
                status,
                approved_by: isAdminOrOwner ? userId : null
            }])
            .select()
            .single();

        if (error) throw error;

        // 5. Notify
        if (!isAdminOrOwner) {
            // Notify Owner
            const { data: biz } = await supabase.from('businesses').select('owner_id, name').eq('id', provider.business_id).single();
            if (biz?.owner_id) {
                const { data: owner } = await supabase.from('profiles').select('phone').eq('id', biz.owner_id).single();
                if (owner?.phone) {
                    const msg = `New leave request from ${profile?.full_name || 'Employee'} for ${biz.name} from ${start_date} to ${end_date}.`;
                    const { notificationService } = require('../services/notificationService');
                    await notificationService.sendWhatsApp(owner.phone, msg);
                }
            }
        }

        res.status(201).json({
            status: 'success',
            message: isAdminOrOwner ? 'Leave added successfully' : 'Leave request submitted successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateLeaveStatus = async (req: Request, res: Response) => {
    try {
        const { leaveId } = req.params;
        const { status } = req.body; // APPROVED or REJECTED
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        // 1. Verify ownership
        const { data: leave } = await supabase
            .from('provider_leaves')
            .select('*, service_providers(name, phone, user_id)')
            .eq('id', leaveId)
            .single();

        if (!leave) {
            return res.status(404).json({ status: 'error', message: 'Leave not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', leave.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Update status and optional reason
        const { reason } = req.body;
        const { data, error } = await supabase
            .from('provider_leaves')
            .update({ 
                status, 
                approved_by: userId,
                rejection_reason: status === 'REJECTED' ? reason : null 
            })
            .eq('id', leaveId)
            .select()
            .single();

        if (error) throw error;

        // 3. Notify Employee
        let recipientPhone = leave.service_providers?.phone;
        if (!recipientPhone && leave.service_providers?.user_id) {
            const { data: empProfile } = await supabase.from('profiles').select('phone').eq('id', leave.service_providers.user_id).single();
            recipientPhone = empProfile?.phone;
        }

        if (recipientPhone) {
            const { notificationService } = require('../services/notificationService');
            const { reason } = req.body;
            let msg = '';
            
            if (status === 'APPROVED') {
                msg = `Your leave request from ${leave.start_date} to ${leave.end_date} has been approved. Enjoy your time off!`;
            } else {
                msg = `Regarding your leave request from ${leave.start_date} to ${leave.end_date}: Unfortunately, it has been declined. ${reason ? `Reason: ${reason}. ` : ''}Please connect with your manager if you have questions.`;
            }
            
            await notificationService.sendWhatsApp(recipientPhone, msg);
        }

        res.status(200).json({
            status: 'success',
            message: `Leave ${status.toLowerCase()} successfully`,
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const deleteProviderLeave = async (req: Request, res: Response) => {
    try {
        const { leaveId } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // We could explicitly check owner_id again for max security, but we rely on RLS 
        // to restrict deletes if configured, or we can just double check ownership manually here.

        const { data: leave } = await supabase
            .from('provider_leaves')
            .select('business_id')
            .eq('id', leaveId)
            .single();

        if (!leave) {
            return res.status(404).json({ status: 'error', message: 'Leave not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', leave.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized to delete this leave' });
        }

        const { error } = await supabase
            .from('provider_leaves')
            .delete()
            .eq('id', leaveId);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Leave removed successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getBulkLeaveStatus = async (req: Request, res: Response) => {
    try {
        const { business_id, date } = req.query;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!business_id) {
            return res.status(400).json({ status: 'error', message: 'Business ID is required' });
        }

        // Verify ownership
        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data: providers } = await supabase
            .from('service_providers')
            .select('id, name')
            .eq('business_id', business_id)
            .eq('is_active', true);

        // Get business timezone
        const { data: bizInfo } = await supabase.from('businesses').select('timezone').eq('id', business_id).single();
        const timezone = bizInfo?.timezone || 'UTC';

        const targetDateStr = date ? String(date) : new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        const tomorrow = new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone });

        const { data: leaves } = await supabase
            .from('provider_leaves')
            .select('*')
            .eq('business_id', business_id)
            .gte('end_date', targetDateStr);

        const results = (providers || []).map((p: any) => {
            const providerLeaves = (leaves || []).filter((l: any) => l.provider_id === p.id);
            const currentLeave = providerLeaves.find((l: any) => l.start_date <= targetDateStr && l.end_date >= targetDateStr);
            const upcomingLeave = providerLeaves.find((l: any) => l.start_date > targetDateStr && l.start_date <= tomorrowStr);

            let leave_status = 'available';
            let leave_until = null;
            let leave_starts_at = null;

            if (currentLeave) {
                leave_status = 'on_leave';
                leave_until = currentLeave.end_date;
            } else if (upcomingLeave) {
                leave_status = 'upcoming';
                leave_starts_at = upcomingLeave.start_date;
            }

            return {
                provider_id: p.id,
                name: p.name,
                leave_status,
                leave_until,
                leave_starts_at
            };
        });

        res.status(200).json({
            status: 'success',
            data: results
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ----------------------------------------------------
// Resignation Requests
// ----------------------------------------------------

export const submitResignation = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { reason, requested_last_date } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get employee details
        const { data: employee } = await supabase
            .from('profiles')
            .select('id, business_id, full_name')
            .eq('id', userId)
            .single();

        if (!employee || employee.role !== 'employee') {
            return res.status(403).json({ status: 'error', message: 'Only employees can submit resignation' });
        }

        // 1.5. Validate date and existing pending requests
        if (new Date(requested_last_date) < new Date()) {
            return res.status(400).json({ status: 'error', message: 'Requested last date cannot be in the past' });
        }

        const { data: existingPending } = await supabase
            .from('resignation_requests')
            .select('id')
            .eq('employee_id', userId)
            .eq('status', 'PENDING')
            .maybeSingle();

        if (existingPending) {
            return res.status(400).json({ status: 'error', message: 'You already have a pending resignation request' });
        }

        // 2. Submit request
        const { data, error } = await supabase
            .from('resignation_requests')
            .insert([{
                employee_id: userId,
                business_id: employee.business_id,
                reason,
                requested_last_date,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;

        // 3. Notify Owner
        const { data: business } = await supabase.from('businesses').select('owner_id').eq('id', employee.business_id).single();
        if (business?.owner_id) {
            const { data: owner } = await supabase.from('profiles').select('phone').eq('id', business.owner_id).single();
            if (owner?.phone) {
                const msg = `Resignation request received from ${employee.full_name}. Reason: ${reason || 'Not provided'}. Requested Last Date: ${requested_last_date || 'N/A'}.`;
                const { notificationService } = require('../services/notificationService');
                await notificationService.sendWhatsApp(owner.phone, msg);
            }
        }

        res.status(201).json({
            status: 'success',
            message: 'Resignation request submitted successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getResignationRequests = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id } = req.query;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // 1. Verify owner
        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Fetch requests
        const { data, error } = await supabase
            .from('resignation_requests')
            .select('*, profiles:employee_id(full_name, phone)')
            .eq('business_id', business_id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: data || []
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateResignationStatus = async (req: Request, res: Response) => {
    try {
        const { requestId } = req.params;
        const { status } = req.body; // APPROVED or REJECTED
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        // 1. Verify request and ownership
        const { data: request } = await supabase
            .from('resignation_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (!request) {
            return res.status(404).json({ status: 'error', message: 'Request not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', request.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Update request
        const { error: updateReqError } = await supabase
            .from('resignation_requests')
            .update({ status })
            .eq('id', requestId);

        if (updateReqError) throw updateReqError;

        // 3. If APPROVED, set employee to INACTIVE (with safety check)
        if (status === 'APPROVED') {
            // Safety Check: Active Tasks
            const { data: provider } = await supabase
                .from('service_providers')
                .select('id')
                .eq('user_id', request.employee_id)
                .single();

            if (provider) {
                const { count: taskCount } = await supabase
                    .from('queue_entry_services')
                    .select('*', { count: 'exact', head: true })
                    .eq('assigned_provider_id', provider.id)
                    .in('task_status', ['pending', 'in_progress']);

                if (taskCount && taskCount > 0) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Safety Block: This employee has ${taskCount} active tasks. Please reassign or complete them before approving resignation.`
                    });
                }
            }

            const { error: updateEmpError } = await supabase
                .from('profiles')
                .update({ status: 'INACTIVE' })
                .eq('id', request.employee_id);

            if (updateEmpError) throw updateEmpError;

            // Notify Employee
            const { data: emp } = await supabase.from('profiles').select('phone').eq('id', request.employee_id).single();
            if (emp?.phone) {
                const { notificationService } = require('../services/notificationService');
                await notificationService.sendWhatsApp(emp.phone, `Your resignation has been approved. Your access to the system has been revoked.`);
            }
        }

        res.status(200).json({
            status: 'success',
            message: `Resignation ${status.toLowerCase()} successfully`
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
