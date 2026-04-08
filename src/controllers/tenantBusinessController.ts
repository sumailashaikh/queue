import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { Business } from '../types';
import { notificationService } from '../services/notificationService';

const COUNTRY_DEFAULTS: Record<string, { currency: string, timezone: string, language: string }> = {
    'IN': { currency: 'INR', timezone: 'Asia/Kolkata', language: 'hi' },
    'AE': { currency: 'AED', timezone: 'Asia/Dubai', language: 'ar' },
    'US': { currency: 'USD', timezone: 'America/New_York', language: 'en' },
    'GB': { currency: 'GBP', timezone: 'Europe/London', language: 'en' },
    'SA': { currency: 'SAR', timezone: 'Asia/Riyadh', language: 'ar' }
};

export const createBusiness = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { name, slug, address, phone, whatsapp_number, open_time, close_time, is_closed, currency, timezone, language, country_code } = req.body;
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
                status: 'pending',
                is_verified: false,
                created_at: new Date().toISOString()
            }], { onConflict: 'id' });
        } else {
            // PROACTIVE: Ensure existing owner is active and verified when they create a business
            console.log(`[BUSINESS] Activating profile for user ${userId}`);
            await supabase.from('profiles')
                .update({ status: 'pending', is_verified: false })
                .eq('id', userId);
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

        const cCode = country_code || 'IN';
        const defaults = COUNTRY_DEFAULTS[cCode] || COUNTRY_DEFAULTS['IN'];

        const newBusiness = {
            owner_id: userId,
            name,
            slug,
            address,
            phone,
            whatsapp_number,
            open_time,
            close_time,
            is_closed,
            country_code: cCode,
            currency: currency || defaults.currency,
            timezone: timezone || defaults.timezone,
            language: language || defaults.language
        };

        const { data, error } = await supabase
            .from('businesses')
            .insert(newBusiness)
            .select()
            .single();

        if (error) throw error;

        // NEW: Auto-create a default queue for the new business
        // This prevents the "Door's Closed!" error on the public profile
        console.log(`[BUSINESS] Creating default queue for business ${data.id}`);
        const { error: queueError } = await supabase.from('queues').insert([{
            business_id: data.id,
            name: 'Main Queue',
            status: 'open',
            current_wait_time_minutes: 0,
            created_at: new Date().toISOString()
        }]);

        if (queueError) {
            console.error(`[BUSINESS] Failed to create default queue for business ${data.id}:`, queueError);
        }

        // NEW: Notify Platform Admins about the new business registration
        try {
            const { data: admins } = await supabase
                .from('profiles')
                .select('phone, full_name')
                .eq('role', 'admin');

            const adminMsg = `🚀 New Business Alert: "${name}" has just registered on QueueUp and is pending verification. Please review it in the Admin Console.`;
            
            let notifiedCount = 0;

            if (admins && admins.length > 0) {
                // Notify all admins found
                for (const admin of admins) {
                    if (admin.phone) {
                        const success = await notificationService.sendWhatsApp(admin.phone, adminMsg);
                        if (success) notifiedCount++;
                    }
                }
            }

            // Fallback: If no admins were notified, try the MASTER_ADMIN_PHONE from env
            if (notifiedCount === 0 && process.env.MASTER_ADMIN_PHONE) {
                console.log('[BUSINESS] No database admins notified. Notifying Master Admin from ENV.');
                await notificationService.sendWhatsApp(process.env.MASTER_ADMIN_PHONE, adminMsg);
            }
        } catch (notifErr) {
            console.error('[BUSINESS] Admin notification failed:', notifErr);
        }

        res.status(201).json({
            status: 'success',
            message: 'Business created successfully with default queue',
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

        // 1. Fetch user profile to check role and linked business
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, business_id')
            .eq('id', userId)
            .single();

        let data;
        let error;

        // Smart check: If they have a business_id, they are an employee/staff regardless of what the 'role' string says
        // (This handles users whose role update failed due to old database constraints)
        if (profile?.business_id) {
            console.log(`[BUSINESS] User ${userId} has business_id ${profile.business_id}, fetching salon for employee...`);
            const result = await supabase
                .from('businesses')
                .select('*, currency, timezone, language, country_code')
                .eq('id', profile.business_id)
                .single();
            
            data = result.data ? [result.data] : [];
            error = result.error;
        } else if (profile?.role === 'admin') {
            // Admins see no specific business here (they use the admin console)
            data = [];
            error = null;
        } else {
            // If they don't have a business_id, they must be an owner looking for their own businesses
            console.log(`[BUSINESS] User ${userId} has no linked business_id, fetching owned businesses...`);
            const result = await supabase
                .from('businesses')
                .select(`
                    *,
                    currency,
                    timezone,
                    language,
                    country_code
                `)
                .eq('owner_id', userId)
                .order('created_at', { ascending: false });
            
            data = result.data;
            error = result.error;
        }

        if (error && error.code !== 'PGRST116') throw error; // Ignore single search "not found" errors

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
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Only update fields that are provided in req.body. 
        // Do NOT overwrite provided values with defaults.
        require('fs').writeFileSync('req_body_log.json', JSON.stringify(req.body, null, 2));
        const updatePayload: any = { ...req.body };

        // Ensure owner_id isn't accidentally overwritten
        delete updatePayload.owner_id;
        delete updatePayload.id;

        const { data, error } = await supabase
            .from('businesses')
            .update(updatePayload)
            .eq('id', id)
            .eq('owner_id', userId) // Extra safety
            .select('*, currency, timezone, language, country_code')
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

export const setCustomerVipFlag = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { id: businessId, customerId } = req.params as any;
        const { is_vip, vip_note } = req.body as any;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        if (!businessId || !customerId) return res.status(400).json({ status: 'error', message: 'Missing required fields' });

        // Owner-only
        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', businessId)
            .eq('owner_id', userId)
            .maybeSingle();
        if (!business) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const payload = {
            business_id: businessId,
            customer_id: customerId,
            is_vip: !!is_vip,
            vip_note: vip_note ? String(vip_note).slice(0, 240) : null,
            vip_set_by: userId,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('business_customer_flags')
            .upsert(payload, { onConflict: 'business_id,customer_id' })
            .select()
            .maybeSingle();

        if (error) throw error;

        res.status(200).json({ status: 'success', message: 'Customer updated', data });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const listVipCustomers = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { id: businessId } = req.params as any;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', businessId)
            .eq('owner_id', userId)
            .maybeSingle();
        if (!business) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const { data, error } = await supabase
            .from('business_customer_flags')
            .select('customer_id, is_vip, vip_note, updated_at, profiles:customer_id (id, full_name, phone)')
            .eq('business_id', businessId)
            .eq('is_vip', true)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        res.status(200).json({ status: 'success', data: data || [] });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
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
                currency,
                timezone,
                language,
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

        // AUTO-CREATE QUEUE: If the business exists but has NO queues, create a default one
        // This ensures public join and check-in always work.
        if (!data.queues || data.queues.length === 0) {
            console.log(`[getBusinessBySlug] Auto-creating missing queue for business ${data.id}`);
            const { data: newQueue, error: qError } = await supabase.from('queues').insert([{
                business_id: data.id,
                name: 'Main Queue',
                status: 'open',
                current_wait_time_minutes: 0,
                created_at: new Date().toISOString()
            }]).select().single();

            if (!qError && newQueue) {
                data.queues = [newQueue];
            }
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
        // Fetch business for timezone
        const { data: bizInfo } = await supabase.from('businesses').select('timezone').eq('slug', slug).single();
        const timezone = bizInfo?.timezone || 'UTC';
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

        // 1. Get Business and its Queues
        const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select(`
                id,
                owner_id,
                name,
                slug,
                open_time,
                close_time,
                is_closed,
                language,
                queues (id, name),
                services (*)
            `)
            .eq('slug', slug)
            .single();

        if (businessError || !business) {
            return res.status(404).json({ status: 'error', message: 'Business not found' });
        }

        if (business.owner_id) {
            const { data: owner } = await supabase.from('profiles').select('ui_language').eq('id', business.owner_id).single();
            if (owner?.ui_language) {
                business.language = owner.ui_language;
            }
        }

        // AUTO-CREATE QUEUE: If no queues exist, create a default one
        if (!business.queues || business.queues.length === 0) {
            console.log(`[getBusinessDisplayData] Auto-creating missing queue for business ${business.id}`);
            const { data: newQueue, error: qError } = await supabase.from('queues').insert([{
                business_id: business.id,
                name: 'Main Queue',
                status: 'open',
                current_wait_time_minutes: 0,
                created_at: new Date().toISOString()
            }]).select().single();

            if (!qError && newQueue) {
                business.queues = [newQueue];
            }
        }

        const queueIds = (business.queues || []).map((q: any) => q.id);

        // 2. Fetch Queue Entries Today (include completed for TV metrics)
        const { data: queueEntries, error: qError } = await supabase
            .from('queue_entries')
            .select(`
                *,
                queue_entry_services!queue_entry_id (
                    task_status,
                    services!service_id (name, translations)
                )
            `)
            .in('queue_id', queueIds)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving', 'completed'])
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
                    services (name, translations)
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
            ...(queueEntries?.map((e: any) => {
                // Normalize stale active statuses when all child tasks are already terminal.
                // This keeps TV mode counts accurate even if older rows were not auto-closed.
                const taskStatuses = (e.queue_entry_services || [])
                    .map((s: any) => String(s?.task_status || '').toLowerCase())
                    .filter(Boolean);
                const hasTasks = taskStatuses.length > 0;
                const terminalTaskStatuses = new Set(['done', 'completed', 'cancelled', 'skipped']);
                const allTasksTerminal = hasTasks && taskStatuses.every((s: string) => terminalTaskStatuses.has(s));
                const normalizedStatus = allTasksTerminal && (e.status === 'waiting' || e.status === 'serving')
                    ? 'completed'
                    : e.status;

                return {
                    id: e.id,
                    type: 'queue',
                    display_token: e.ticket_number,
                    customer_name: e.customer_name,
                    status: normalizedStatus,
                    time: e.joined_at,
                    service_name: e.queue_entry_services?.map((as: any) => as.services?.name).filter(Boolean).join(', ') || e.service_name || 'Walk-in',
                    translations: e.queue_entry_services?.map((as: any) => as.services?.translations).filter(Boolean) || []
                };
            }) || []),
            ...(appointments?.map((a: any) => {
                const customerName = a.guest_name ||
                    (Array.isArray(a.profiles) ? a.profiles[0]?.full_name : a.profiles?.full_name) ||
                    'Premium Guest';

                const serviceNames = (a as any).appointment_services?.map((as: any) => as.services?.name).filter(Boolean).join(', ') || 'Service';
                const serviceTranslations = (a as any).appointment_services?.map((as: any) => as.services?.translations).filter(Boolean) || [];

                return {
                    id: a.id,
                    type: 'appointment',
                    display_token: 'BOOKED',
                    customer_name: customerName,
                    status: a.status === 'confirmed' ? 'waiting' : 'completed',
                    time: a.start_time,
                    service_name: serviceNames,
                    translations: serviceTranslations
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

export const getPublicProvidersBySlug = async (req: Request, res: Response) => {
    try {
        const { slug } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data: business } = await supabase
            .from('businesses')
            .select('id, timezone')
            .eq('slug', slug)
            .maybeSingle();
        if (!business) return res.status(404).json({ status: 'error', message: 'Business not found' });

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: business.timezone || 'UTC' });

        const { data: providers, error: pErr } = await supabase
            .from('service_providers')
            .select(`
                id,
                name,
                role,
                department,
                is_active,
                provider_services(service_id)
            `)
            .eq('business_id', business.id)
            .eq('is_active', true);
        if (pErr) throw pErr;

        const providerIds = (providers || []).map((p: any) => p.id);
        const { data: queueLoadRows } = providerIds.length
            ? await supabase
                .from('queue_entries')
                .select('assigned_provider_id, total_duration_minutes, status, served_at, joined_at')
                .in('assigned_provider_id', providerIds)
                .eq('entry_date', todayStr)
                .in('status', ['waiting', 'serving'])
            : { data: [] as any[] };

        const { data: apptLoadRows } = providerIds.length
            ? await supabase
                .from('appointment_services')
                .select(`
                    assigned_provider_id,
                    appointments:appointment_id (start_time, end_time, status)
                `)
                .in('assigned_provider_id', providerIds)
                .gte('appointments.start_time', `${todayStr}T00:00:00`)
                .lte('appointments.start_time', `${todayStr}T23:59:59`)
            : { data: [] as any[] };

        const queueAhead = new Map<string, number>();
        const queueEta = new Map<string, number>();
        (queueLoadRows || []).forEach((r: any) => {
            const pid = String(r.assigned_provider_id || '');
            if (!pid) return;
            queueAhead.set(pid, (queueAhead.get(pid) || 0) + 1);
            const planned = Number(r.total_duration_minutes || 10);
            if (String(r.status) === 'serving') {
                const startedAt = r.served_at || r.joined_at;
                const elapsed = startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)) : 0;
                queueEta.set(pid, (queueEta.get(pid) || 0) + Math.max(0, planned - elapsed));
            } else {
                queueEta.set(pid, (queueEta.get(pid) || 0) + planned);
            }
        });

        const apptActive = new Map<string, number>();
        (apptLoadRows || []).forEach((r: any) => {
            const pid = String(r.assigned_provider_id || '');
            const a = r.appointments;
            if (!pid || !a) return;
            const st = String(a.status || '').toLowerCase();
            if (['cancelled', 'completed', 'no_show'].includes(st)) return;
            apptActive.set(pid, (apptActive.get(pid) || 0) + 1);
        });

        const data = (providers || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            department: p.department,
            service_ids: (p.provider_services || []).map((ps: any) => ps.service_id).filter(Boolean),
            queue_ahead: Math.max(0, (queueAhead.get(p.id) || 0) - 1),
            estimated_wait_minutes: queueEta.get(p.id) || 0,
            active_appointments: apptActive.get(p.id) || 0,
            is_available_now: (queueAhead.get(p.id) || 0) === 0
        }));

        res.status(200).json({ status: 'success', data });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getPublicProviderSlots = async (req: Request, res: Response) => {
    try {
        const { slug, providerId } = req.params as any;
        const { date, duration_minutes } = req.query as any;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!date) return res.status(400).json({ status: 'error', message: 'date is required' });
        const duration = Math.max(5, Number(duration_minutes || 30));

        const { data: business } = await supabase
            .from('businesses')
            .select('id, timezone, open_time, close_time')
            .eq('slug', slug)
            .maybeSingle();
        if (!business) return res.status(404).json({ status: 'error', message: 'Business not found' });

        const { data: provider } = await supabase
            .from('service_providers')
            .select('id')
            .eq('id', providerId)
            .eq('business_id', business.id)
            .eq('is_active', true)
            .maybeSingle();
        if (!provider) return res.status(404).json({ status: 'error', message: 'Provider not found' });

        const parseMins = (t: string) => {
            const [hh, mm] = String(t || '00:00').split(':').map(Number);
            return (hh || 0) * 60 + (mm || 0);
        };
        const openM = parseMins(String(business.open_time || '09:00').slice(0, 5));
        const closeM = parseMins(String(business.close_time || '21:00').slice(0, 5));
        const bufferClose = closeM - 10;

        const dayStart = `${String(date).slice(0, 10)}T00:00:00`;
        const dayEnd = `${String(date).slice(0, 10)}T23:59:59`;

        const { data: busyRows } = await supabase
            .from('appointment_services')
            .select(`appointments:appointment_id (start_time, end_time, status)`)
            .eq('assigned_provider_id', providerId)
            .gte('appointments.start_time', dayStart)
            .lte('appointments.start_time', dayEnd);

        const busy = (busyRows || [])
            .map((r: any) => r.appointments)
            .filter((a: any) => !!a)
            .filter((a: any) => !['cancelled', 'completed', 'no_show'].includes(String(a.status || '').toLowerCase()))
            .map((a: any) => ({
                start: new Date(a.start_time).getTime(),
                end: new Date(a.end_time).getTime()
            }));

        const nowLocal = new Date().toLocaleTimeString('en-GB', {
            timeZone: business.timezone || 'UTC',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        });
        const nowM = parseMins(nowLocal);
        const targetDate = String(date).slice(0, 10);
        const today = new Date().toLocaleDateString('en-CA', { timeZone: business.timezone || 'UTC' });

        let startM = openM;
        if (targetDate === today) {
            startM = Math.max(openM, nowM + 15);
            startM = Math.ceil(startM / 15) * 15;
        }

        const slots: string[] = [];
        for (let m = startM; m + duration <= bufferClose; m += 15) {
            const h = Math.floor(m / 60);
            const mm = m % 60;
            const slot = `${String(targetDate)}T${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
            const end = new Date(new Date(slot).getTime() + duration * 60000).getTime();
            const st = new Date(slot).getTime();
            const conflict = busy.some((b: any) => st < b.end && b.start < end);
            if (!conflict) slots.push(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
        }

        res.status(200).json({ status: 'success', data: { date: targetDate, slots } });
    } catch (error: any) {
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
