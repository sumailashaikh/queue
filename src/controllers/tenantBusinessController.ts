import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { Business } from '../types';

export const createBusiness = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { name, slug, address, phone, whatsapp_number, open_time, close_time, is_closed } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        // SAFETY: Ensure profile exists before creating business (prevents FK violation)
        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .single();

        if (!profile) {
            console.log(`[BUSINESS] Profile missing for user ${userId}, creating fallback...`);
            await supabase.from('profiles').upsert([{
                id: userId,
                full_name: 'New Owner',
                role: 'owner',
                status: 'active',
                is_verified: true,
                created_at: new Date().toISOString()
            }], { onConflict: 'id' });
        }

        if (!name || !slug) {
            return res.status(400).json({
                status: 'error',
                message: 'Name and slug are required'
            });
        }

        // Check availability of slug
        const { data: existingSlug } = await supabase
            .from('businesses')
            .select('slug')
            .eq('slug', slug)
            .single();

        if (existingSlug) {
            return res.status(400).json({
                status: 'error',
                message: 'Business URL slug is already taken'
            });
        }

        const newBusiness: Partial<Business> = {
            owner_id: userId,
            name,
            slug,
            address,
            phone,
            whatsapp_number,
            open_time,
            close_time,
            is_closed
        };

        const { data, error } = await supabase
            .from('businesses')
            .insert(newBusiness)
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'Business created successfully',
            data
        });

    } catch (error: any) {
        if (error.code === '23505') { // Postgres unique_violation
            return res.status(400).json({
                status: 'error',
                message: 'Business with this slug already exists'
            });
        }

        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getMyBusinesses = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const { data, error } = await supabase
            .from('businesses')
            .select('*')
            .eq('owner_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

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

export const updateBusiness = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, address, phone, whatsapp_number, open_time, close_time, is_closed } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // RLS policy "Owners can update their own business" will handle ownership check implicitly
        // But verifying existence first is good UX

        const { data, error } = await supabase
            .from('businesses')
            .update({ name, address, phone, whatsapp_number, open_time, close_time, is_closed })
            .eq('id', id)
            .eq('owner_id', userId) // Extra safety
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                status: 'error',
                message: 'Business not found or you do not have permission to update it'
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Business updated successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const deleteBusiness = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // RLS policy for delete might not exist yet, we need to check/add it.
        // Assuming we add it, or we rely on this query:

        const { error } = await supabase
            .from('businesses')
            .delete()
            .eq('id', id)
            .eq('owner_id', userId);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Business deleted successfully'
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getBusinessBySlug = async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data, error } = await supabase
            .from('businesses')
            .select(`
                *,
                queues (*, services(*)),
                services (*)
            `)
            .eq('slug', slug)
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                status: 'error',
                message: 'Business not found'
            });
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

export const getBusinessDisplayData = async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // 1. Get Business and its Queues
        const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select(`
                id,
                name,
                slug,
                open_time,
                close_time,
                is_closed,
                queues (id, name),
                services (*)
            `)
            .eq('slug', slug)
            .single();

        if (businessError || !business) {
            return res.status(404).json({ status: 'error', message: 'Business not found' });
        }

        const queueIds = business.queues.map((q: any) => q.id);

        // 2. Fetch Active Queue Entries Today
        const { data: queueEntries, error: qError } = await supabase
            .from('queue_entries')
            .select(`
                *,
                queue_entry_services!queue_entry_id (
                    services!service_id (name)
                )
            `)
            .in('queue_id', queueIds)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving'])
            .order('position', { ascending: true });

        if (qError) throw qError;

        // 3. Fetch Appointments Today (only confirmed or completed)
        // Note: For appointments, we might need to filter by start_time being today
        const { data: appointments, error: aError } = await supabase
            .from('appointments')
            .select(`
                id,
                status,
                start_time,
                guest_name,
                profiles (full_name),
                appointment_services (
                    services (name)
                )
            `)
            .eq('business_id', business.id)
            .gte('start_time', `${todayStr}T00:00:00`)
            .lte('start_time', `${todayStr}T23:59:59`)
            .in('status', ['confirmed', 'completed']);

        if (aError) throw aError;

        // 4. Unify and Sort
        // We'll return them separately or combined depending on frontend need.
        // Combined is better for a single "Up Next" list.
        const unified = [
            ...(queueEntries?.map((e: any) => ({
                id: e.id,
                type: 'queue',
                display_token: e.ticket_number,
                customer_name: e.customer_name,
                status: e.status,
                time: e.joined_at,
                service_name: e.queue_entry_services?.map((as: any) => as.services?.name).filter(Boolean).join(', ') || e.service_name || 'Walk-in'
            })) || []),
            ...(appointments?.map((a: any) => {
                const customerName = a.guest_name ||
                    (Array.isArray(a.profiles) ? a.profiles[0]?.full_name : a.profiles?.full_name) ||
                    'Premium Guest';

                const serviceNames = (a as any).appointment_services?.map((as: any) => as.services?.name).filter(Boolean).join(', ') || 'Service';

                return {
                    id: a.id,
                    type: 'appointment',
                    display_token: 'BOOKED',
                    customer_name: customerName,
                    status: a.status === 'confirmed' ? 'waiting' : 'serving', // Map to queue status for simplicity
                    time: a.start_time,
                    service_name: serviceNames
                };
            }) || [])
        ];

        // Sort by time (joined_at for queue, start_time for appointments)
        unified.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        res.status(200).json({
            status: 'success',
            data: {
                business,
                entries: unified
            }
        });

    } catch (error: any) {
        console.error('[DisplayData] Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};
export const getBusinessServices = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data, error } = await supabase
            .from('services')
            .select('*')
            .eq('business_id', id);

        if (error) throw error;

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
