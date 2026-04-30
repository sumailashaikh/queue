import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';
import { isBusinessOpen, getLocalMinutes, getLocalDateString, resolveBusinessAvailability } from '../utils/timeUtils';
import { recomputeProviderDelays } from '../utils/delayLogic';

async function resolveMyProviderForUser(userId: string, adminSupabase: any) {
    const byUser = await adminSupabase
        .from('service_providers')
        .select('id, business_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return byUser.data || null;
}

function baseLang(input?: string): 'en' | 'hi' | 'es' | 'ar' {
    const l = String(input || 'en').toLowerCase().split('-')[0];
    if (l === 'hi' || l === 'es' || l === 'ar') return l;
    return 'en';
}

function appointmentReassignedMessage(lang: string, businessName: string, when: string): string {
    const l = baseLang(lang);
    if (l === 'hi') return `आपकी अपॉइंटमेंट ${businessName} में स्टाफ उपलब्धता के कारण री-असाइन कर दी गई है। समय वही रहेगा: ${when}`;
    if (l === 'ar') return `تمت إعادة تعيين موعدك في ${businessName} بسبب توفر الموظفين. سيبقى الموعد كما هو: ${when}`;
    if (l === 'es') return `Tu cita en ${businessName} fue reasignada por disponibilidad del personal. El horario se mantiene: ${when}`;
    return `Your appointment at ${businessName} has been reassigned due to staff availability. Your scheduled time remains ${when}.`;
}

function appointmentRescheduledMessage(lang: string, businessName: string, when: string): string {
    const l = baseLang(lang);
    if (l === 'hi') return `आपकी अपॉइंटमेंट ${businessName} में पुनर्निर्धारित की गई है। नया समय: ${when}`;
    if (l === 'ar') return `تمت إعادة جدولة موعدك في ${businessName}. الموعد الجديد: ${when}`;
    if (l === 'es') return `Tu cita en ${businessName} fue reprogramada. Nuevo horario: ${when}`;
    return `Your appointment at ${businessName} has been rescheduled to ${when}.`;
}

function isMissingEmployeeIdColumnError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('employee_id') && (msg.includes('schema cache') || msg.includes('column') || msg.includes('does not exist'));
}

async function createBusinessNotification(
    supabaseClient: any,
    businessId: string,
    title: string,
    message: string,
    type: string,
    meta: Record<string, any> = {},
    userId?: string | null
) {
    await supabaseClient.from('notifications').insert([{
        business_id: businessId,
        user_id: userId || null,
        title,
        message,
        type,
        meta
    }]);
}

async function notifyOwnerForNewAppointment(
    supabaseClient: any,
    businessId: string,
    customerName: string,
    startTime: string
) {
    const { data: business } = await supabaseClient
        .from('businesses')
        .select('id, name, owner_id, phone, whatsapp_number, timezone')
        .eq('id', businessId)
        .maybeSingle();
    if (!business) return;

    const when = new Date(startTime).toLocaleString('en-IN', { timeZone: business.timezone || 'UTC' });
    const title = 'New appointment request';
    const message = `${customerName} requested an appointment for ${when}.`;
    await createBusinessNotification(
        supabaseClient,
        businessId,
        title,
        message,
        'appointment_request',
        { start_time: startTime, customer_name: customerName }
    );

    const ownerTargets = new Set<string>();
    if (business.owner_id) {
        const { data: ownerProfile } = await supabaseClient
            .from('profiles')
            .select('phone')
            .eq('id', business.owner_id)
            .maybeSingle();
        if (ownerProfile?.phone) ownerTargets.add(String(ownerProfile.phone));
    }
    if (business.phone) ownerTargets.add(String(business.phone));
    if (business.whatsapp_number) ownerTargets.add(String(business.whatsapp_number));

    if (ownerTargets.size > 0) {
        await Promise.allSettled(
            Array.from(ownerTargets).flatMap((to) => [
                notificationService.sendWhatsApp(to, message),
                notificationService.sendSMS(to, message)
            ])
        );
    }
}

export const createAppointment = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id, service_ids, start_time, end_time, employee_id } = req.body; // service_ids is now an array
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        if (!business_id || !start_time) {
            return res.status(400).json({
                status: 'error',
                message: 'Business ID and Start Time are required'
            });
        }

        // Check business hours
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('name, open_time, close_time, staff_open_time, staff_close_time, is_closed, timezone')
            .eq('id', business_id)
            .single();

        if (bizError || !business) {
            return res.status(404).json({ status: 'error', message: 'Business not found' });
        }

        // Emergency closure must override regular timing.
        const availability = resolveBusinessAvailability(business);
        if (!availability.isOpen) {
            return res.status(400).json({
                status: 'error',
                message: availability.message || 'Business is closed. Please book during working hours.',
                availability_status: availability.state
            });
        }

        // Calculate total duration from services
        let totalDuration = 30; // Default
        let service_id = null;
        if (service_ids && service_ids.length > 0) {
            const { data: sData } = await supabase
                .from('services')
                .select('duration_minutes, id')
                .in('id', service_ids);

            if (sData) {
                totalDuration = sData.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0);
                service_id = sData[0].id; // Keep first one for compatibility
            }
        }

        // Buffer for closing time protection
        const bufferMins = 15;
        const timezone = business.timezone || 'UTC';
        const nowMins = getLocalMinutes(timezone);
        const effectiveClose = (business as any).staff_close_time || business.close_time;
        const closeMins = require('../utils/timeUtils').parseTimeToMinutes(effectiveClose);

        // Check if appointment date is today
        const todayStr = getLocalDateString(timezone);
        const apptDateStr = getLocalDateString(timezone, new Date(start_time));

        if (todayStr === apptDateStr) {
            // For today, we consider current time vs start time
            const startMins = getLocalMinutes(timezone, new Date(start_time));
            const estEndMins = startMins + totalDuration;

            if (estEndMins > (closeMins - 10)) {
                return res.status(400).json({
                    status: 'error',
                    message: "We’re fully booked for today. Please select a slot for tomorrow."
                });
            }
        } else {
            // For future days, just check against closing time
            const startMins = getLocalMinutes(timezone, new Date(start_time));
            const estEndMins = startMins + totalDuration;
            if (estEndMins > (closeMins - 10)) {
                return res.status(400).json({
                    status: 'error',
                    message: "We’re fully booked for today. Please select a slot for tomorrow."
                });
            }
        }

        const calculatedEndTime = end_time || new Date(new Date(start_time).getTime() + totalDuration * 60000).toISOString();

        let employeeProviderId: string | null = null;
        if (employee_id) {
            const { data: providerRow } = await supabase
                .from('service_providers')
                .select('id')
                .eq('user_id', employee_id)
                .eq('business_id', business_id)
                .maybeSingle();
            employeeProviderId = providerRow?.id || null;
        }

        let insertPayload: any = {
            user_id: userId,
            business_id,
            service_id, // Legacy compatibility
            start_time,
            end_time: calculatedEndTime,
            status: 'pending',
            employee_id: employee_id || null
        };
        let { data, error } = await supabase
            .from('appointments')
            .insert([insertPayload])
            .select()
            .single();

        if (error && isMissingEmployeeIdColumnError(error)) {
            const { employee_id: _ignore, ...fallbackPayload } = insertPayload;
            const retry = await supabase
                .from('appointments')
                .insert([fallbackPayload])
                .select()
                .single();
            data = retry.data as any;
            error = retry.error as any;
        }
        if (error) throw error;

        // Link services in junction table with snapshots
        if (service_ids && service_ids.length > 0) {
            const { data: sData } = await supabase
                .from('services')
                .select('id, price, duration_minutes')
                .in('id', service_ids);

            if (sData) {
                const junctionEntries = sData.map((s: any) => ({
                    appointment_id: data.id,
                    service_id: s.id,
                    price: s.price || 0,
                    duration_minutes: s.duration_minutes || 0,
                    assigned_provider_id: employeeProviderId
                }));
                await supabase.from('appointment_services').insert(junctionEntries);
            }
        }

        await notifyOwnerForNewAppointment(
            supabase,
            business_id,
            'Customer',
            start_time
        );

        res.status(201).json({
            status: 'success',
            message: 'Appointment request sent successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getMyAppointments = async (req: Request, res: Response) => {
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
            .from('appointments')
            .select(`
                *,
                businesses (name, address),
                profiles:user_id (full_name, phone),
                appointment_services!appointment_id (
                    services!service_id (id, name, duration_minutes)
                ),
                queue_entries (id, status, ticket_number)
            `)
            .eq('user_id', userId)
            .order('start_time', { ascending: true });

        if (error) throw error;

        const now = new Date();
        const enhancedData = (data || []).map((appt: any) => {
            const startTime = new Date(appt.start_time);
            const duration = appt.appointment_services?.reduce((acc: number, s: any) => acc + (s.services?.duration_minutes || 0), 0) || 30;
            const expectedEndAt = new Date(startTime.getTime() + duration * 60000);

            const isLate = ['scheduled', 'confirmed', 'checked_in'].includes(appt.status) && now > startTime;
            const lateMinutes = isLate ? Math.max(0, Math.round((now.getTime() - startTime.getTime()) / 60000)) : 0;

            let appointmentState = appt.status.toUpperCase();
            if (isLate) appointmentState = 'LATE';
            if (appt.status === 'scheduled' && now < startTime) appointmentState = 'UPCOMING';

            const activeQueueEntry = (appt.queue_entries || []).find((q: any) => !['completed', 'cancelled', 'no_show', 'skipped'].includes(q.status));
            if (appt.status === 'checked_in' && activeQueueEntry) appointmentState = 'IN_QUEUE';

            return {
                ...appt,
                appointment_state: appointmentState,
                is_late: isLate,
                late_minutes: lateMinutes,
                expected_end_at: expectedEndAt.toISOString(),
                queue_entry: activeQueueEntry
            };
        });

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

export const getMyAssignedAppointments = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

        const provider = await resolveMyProviderForUser(userId, adminSupabase);
        if (!provider) return res.status(200).json({ status: 'success', data: [] });

        const { data, error } = await adminSupabase
            .from('appointment_services')
            .select(`
              id,
              assigned_provider_id,
              reassigned_from_provider_id,
              reassigned_at,
              services:service_id (id, name, duration_minutes, translations),
              appointments:appointment_id (
                id,
                business_id,
                user_id,
                start_time,
                end_time,
                status,
                profiles:user_id (id, full_name, phone, ui_language)
              )
            `)
            .eq('assigned_provider_id', provider.id)
            .in('appointments.status', ['confirmed', 'checked_in', 'in_service', 'rescheduled'])
            .order('reassigned_at', { ascending: false, nullsFirst: false });

        if (error) throw error;

        const rows = (data || []).map((row: any) => {
            const appt = row.appointments || {};
            const isReassigned = !!row.reassigned_from_provider_id;
            return {
                id: appt.id,
                business_id: appt.business_id,
                start_time: appt.start_time,
                end_time: appt.end_time,
                status: appt.status,
                appointment_state: isReassigned ? 'REASSIGNED' : (String(appt.status || '').toUpperCase() || 'SCHEDULED'),
                customer: appt.profiles,
                service: row.services,
                assignment: {
                    appointment_service_id: row.id,
                    assigned_provider_id: row.assigned_provider_id,
                    reassigned_from_provider_id: row.reassigned_from_provider_id,
                    reassigned_at: row.reassigned_at
                }
            };
        });

        res.status(200).json({ status: 'success', data: rows });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getBusinessAppointments = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }
        const { data: myProfile } = await supabase
            .from('profiles')
            .select('role, business_id')
            .eq('id', userId)
            .maybeSingle();
        const myRole = String(myProfile?.role || '').toLowerCase();
        if (myRole === 'employee') {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get businesses for owner/admin/provider
        let businesses: any[] = [];
        const { data: ownedBusinesses, error: businessError } = await supabase
            .from('businesses')
            .select('id, timezone')
            .eq('owner_id', userId);

        if (businessError) throw businessError;
        businesses = ownedBusinesses || [];

        if (businesses.length === 0) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('business_id')
                .eq('id', userId)
                .maybeSingle();
            if (profile?.business_id) {
                const { data: byProfile } = await supabase
                    .from('businesses')
                    .select('id, timezone')
                    .eq('id', profile.business_id)
                    .limit(1);
                businesses = byProfile || [];
            }
        }

        if (!businesses || businesses.length === 0) {
            return res.status(200).json({ status: 'success', data: [] });
        }

        const businessIds = businesses.map((b: any) => b.id);

        // 1.5 Auto-Process unattended approved appointments (30-min grace period)
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60000).toISOString();
        const primaryTimezone = businesses[0]?.timezone || 'UTC';
        const todayStr = getLocalDateString(primaryTimezone);

        // A. Mark unapproved requests as expired if stale
        await supabase
            .from('appointments')
            .update({ status: 'expired' })
            .in('business_id', businessIds)
            .in('status', ['pending', 'scheduled', 'requested'])
            .lt('start_time', thirtyMinsAgo)
            .gte('start_time', todayStr + 'T00:00:00Z');

        // B. Auto-cancel approved appointments if customer does not arrive in 30 minutes
        const { data: autoCancelledAppointments } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .in('business_id', businessIds)
            .eq('status', 'confirmed')
            .lt('start_time', thirtyMinsAgo)
            .gte('start_time', todayStr + 'T00:00:00Z')
            .select('id, guest_phone, guest_name, user_id, business_id');

        // Sync queue entries + notify customers for auto-cancelled rows
        if (autoCancelledAppointments && autoCancelledAppointments.length > 0) {
            const cancelledIds = autoCancelledAppointments.map((a: { id: string }) => a.id);
            await supabase
                .from('queue_entries')
                .update({ status: 'cancelled' })
                .in('appointment_id', cancelledIds)
                .in('status', ['waiting', 'serving']);

            for (const row of autoCancelledAppointments as any[]) {
                try {
                    let toPhone = row.guest_phone || null;
                    if (!toPhone && row.user_id) {
                        const { data: p } = await supabase
                            .from('profiles')
                            .select('phone')
                            .eq('id', row.user_id)
                            .maybeSingle();
                        toPhone = p?.phone || null;
                    }
                    if (toPhone) {
                        const customerName = row.guest_name || 'Customer';
                        const msg = `Hi ${customerName}, your appointment was cancelled because check-in was not completed within 30 minutes of scheduled time. Please book again.`;
                        await Promise.allSettled([
                            notificationService.sendWhatsApp(toPhone, msg),
                            notificationService.sendSMS(toPhone, msg)
                        ]);
                    }
                } catch {
                    // non-blocking
                }
            }
        }

        // 2. Get appointments for these businesses
        const { data, error } = await supabase
            .from('appointments')
            .select(`
                *,
                profiles (full_name, id, phone, ui_language),
                appointment_services!appointment_id (
                    assigned_provider_id,
                    services!service_id (id, name, duration_minutes, translations)
                ),
                queue_entries (id, status, ticket_number)
            `)
            .in('business_id', businessIds)
            .order('start_time', { ascending: true });

        if (error) throw error;

        const employeeIds = Array.from(
            new Set(
                (data || [])
                    .map((a: any) => a?.employee_id)
                    .filter(Boolean)
                    .map((id: any) => String(id))
            )
        );
        const assignedProviderIds = Array.from(
            new Set(
                (data || [])
                    .flatMap((a: any) => (a?.appointment_services || []).map((s: any) => s?.assigned_provider_id))
                    .filter(Boolean)
                    .map((id: any) => String(id))
            )
        );
        const employeeMap = new Map<string, any>();
        if (employeeIds.length > 0) {
            const { data: employeeRows } = await supabase
                .from('profiles')
                .select('id, full_name, phone')
                .in('id', employeeIds);
            (employeeRows || []).forEach((e: any) => employeeMap.set(String(e.id), e));
        }
        if (assignedProviderIds.length > 0) {
            const { data: providerRows } = await supabase
                .from('service_providers')
                .select('id, user_id')
                .in('id', assignedProviderIds);
            const fallbackEmployeeIds = Array.from(new Set((providerRows || []).map((p: any) => p?.user_id).filter(Boolean).map((v: any) => String(v))));
            if (fallbackEmployeeIds.length > 0) {
                const { data: fallbackEmployees } = await supabase
                    .from('profiles')
                    .select('id, full_name, phone')
                    .in('id', fallbackEmployeeIds);
                (fallbackEmployees || []).forEach((e: any) => {
                    if (!employeeMap.has(String(e.id))) employeeMap.set(String(e.id), e);
                });
                const providerToEmployee = new Map<string, any>();
                (providerRows || []).forEach((p: any) => {
                    const emp = p?.user_id ? employeeMap.get(String(p.user_id)) : null;
                    if (emp) providerToEmployee.set(String(p.id), emp);
                });
                (data || []).forEach((a: any) => {
                    if (!a?.employee_id) {
                        const providerId = (a?.appointment_services || []).find((s: any) => !!s?.assigned_provider_id)?.assigned_provider_id;
                        if (providerId) {
                            const mapped = providerToEmployee.get(String(providerId));
                            if (mapped) a.__employeeFallback = mapped;
                        }
                    }
                });
            }
        }

        const enhancedData = data.map((appt: any) => {
            const startTime = new Date(appt.start_time);
            const duration = appt.appointment_services?.reduce((acc: number, s: any) => acc + (s.services?.duration_minutes || 0), 0) || 30;
            const expectedEndAt = new Date(startTime.getTime() + duration * 60000);

            const isLate = ['confirmed'].includes(String(appt.status || '').toLowerCase()) && now > startTime;
            const lateMinutes = isLate ? Math.max(0, Math.round((now.getTime() - startTime.getTime()) / 60000)) : 0;

            let appointmentState = appt.status.toUpperCase();
            if (isLate) appointmentState = 'LATE';
            if (String(appt.status || '').toLowerCase() === 'pending') appointmentState = 'PENDING';
            if (String(appt.status || '').toLowerCase() === 'in_service') appointmentState = 'RUNNING';
            if (appt.status === 'scheduled' && now < startTime) appointmentState = 'UPCOMING';

            const isToday = getLocalDateString(primaryTimezone, new Date(appt.start_time)) === todayStr;
            const isTerminal = ['completed', 'no_show', 'cancelled'].includes(appt.status);

            const activeQueueEntry = (appt.queue_entries || []).find((q: any) => !['completed', 'cancelled', 'no_show', 'skipped'].includes(q.status));

            // Refined logic for queue_entry metadata
            const queueEntry = (isToday && !isTerminal) ? activeQueueEntry : null;

            return {
                ...appt,
                employee: appt?.employee_id
                    ? (employeeMap.get(String(appt.employee_id)) || null)
                    : (appt?.__employeeFallback || null),
                appointment_state: appointmentState,
                is_late: isLate,
                late_minutes: lateMinutes,
                expected_end_at: expectedEndAt.toISOString(),
                queue_entry: queueEntry
            };
        });

        res.status(200).json({
            status: 'success',
            data: enhancedData
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const reassignAppointment = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params; // appointment_id
        const { to_provider_id, from_provider_id } = req.body as any;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        if (!to_provider_id) return res.status(400).json({ status: 'error', message: 'to_provider_id is required' });

        // Ensure requester owns the business for this appointment OR is staff within same business (owner override)
        const { data: appt, error: apptError } = await adminSupabase
            .from('appointments')
            .select('id, business_id, user_id, start_time, end_time, businesses(owner_id, timezone, name, language)')
            .eq('id', id)
            .maybeSingle();
        if (apptError) throw apptError;
        if (!appt) return res.status(404).json({ status: 'error', message: 'Appointment not found' });

        const ownerId = appt.businesses?.owner_id;
        let isOwner = ownerId === userId;
        if (!isOwner) {
            const { data: myProfile } = await supabase.from('profiles').select('business_id').eq('id', userId).maybeSingle();
            isOwner = !!myProfile?.business_id && myProfile.business_id === appt.business_id;
        }
        if (!isOwner) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        // Reassign appointment_services rows (optionally only those from a specific provider)
        let q = adminSupabase
            .from('appointment_services')
            .update({
                assigned_provider_id: to_provider_id,
                reassigned_from_provider_id: from_provider_id || null,
                reassigned_at: new Date().toISOString()
            })
            .eq('appointment_id', id);
        if (from_provider_id) q = q.eq('assigned_provider_id', from_provider_id);

        const { data: updated, error: uErr } = await q.select('*');
        if (uErr) throw uErr;

        // Notify customer (best-effort)
        try {
            const { data: customer } = await adminSupabase
                .from('profiles')
                .select('phone, full_name, ui_language')
                .eq('id', appt.user_id)
                .maybeSingle();
            if (customer?.phone) {
                const timezone = appt.businesses?.timezone || 'UTC';
                const when = new Date(appt.start_time).toLocaleString('en-IN', { timeZone: timezone });
                const lang = customer?.ui_language || appt.businesses?.language || 'en';
                const msg = appointmentReassignedMessage(lang, appt.businesses?.name || 'our business', when);
                await Promise.allSettled([
                    notificationService.sendSMS(customer.phone, msg),
                    notificationService.sendWhatsApp(customer.phone, msg)
                ]);
            }
        } catch {
            /* non-blocking */
        }

        res.status(200).json({ status: 'success', message: 'Appointment reassigned', data: updated || [] });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status, employee_id } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

        const validStatuses = ['pending', 'scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'expired'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        const { data: appts, error: fetchError } = await supabase
            .from('appointments')
            .select(`
                *,
                businesses!business_id (id, name, owner_id, checkin_creates_queue_entry, timezone),
                appointment_services!appointment_id (
                    id, price, duration_minutes, assigned_provider_id,
                    services!service_id (id, name)
                ),
                profiles (full_name, phone)
            `)
            .eq('id', id);

        const appointment = appts?.[0];
        if (fetchError || !appointment) return res.status(404).json({ status: 'error', message: 'Appointment not found' });

        const business = Array.isArray(appointment.businesses) ? appointment.businesses[0] : appointment.businesses;
        if (!business) return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        const { data: myProfile } = await supabase
            .from('profiles')
            .select('business_id, role')
            .eq('id', userId)
            .maybeSingle();
        const isSameBusiness = myProfile?.business_id && String(myProfile.business_id) === String(appointment.business_id);
        const isOwner = String(business.owner_id || '') === String(userId);
        const isAdmin = String(myProfile?.role || '').toLowerCase() === 'admin';
        const { data: providerLink } = await supabase
            .from('service_providers')
            .select('id')
            .eq('user_id', userId)
            .eq('business_id', appointment.business_id)
            .limit(1)
            .maybeSingle();
        const isProvider = !!providerLink?.id;
        if (!(isOwner || (isSameBusiness && (isAdmin || isProvider)))) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }
        if (['confirmed', 'cancelled'].includes(String(status || '').toLowerCase()) && !(isOwner || isAdmin)) {
            return res.status(403).json({ status: 'error', message: 'Only owner/admin can approve or reject appointments' });
        }

        const timezone = business.timezone || 'UTC';
        const todayStr = getLocalDateString(timezone);
        const currentStatus = appointment.status;

        // Terminal status check
        if (['cancelled', 'no_show', 'completed'].includes(currentStatus)) {
            return res.status(400).json({ status: 'error', message: 'Already in terminal state' });
        }

        let updateData: any = { status };
        if (status === 'checked_in') updateData.checked_in_at = new Date().toISOString();
        if (status === 'completed') updateData.completed_at = new Date().toISOString();
        if (status === 'confirmed' && typeof employee_id !== 'undefined') {
            updateData.employee_id = employee_id || null;
            if (employee_id) {
                const { data: providerRow } = await supabase
                    .from('service_providers')
                    .select('id')
                    .eq('user_id', employee_id)
                    .eq('business_id', appointment.business_id)
                    .maybeSingle();
                if (providerRow?.id) {
                    await supabase
                        .from('appointment_services')
                        .update({ assigned_provider_id: providerRow.id })
                        .eq('appointment_id', id);
                }
            }
        }

        // 1. Sync with Queue
        if (status === 'checked_in' && business.checkin_creates_queue_entry !== false) {
            let { data: queue } = await supabase.from('queues').select('id').eq('business_id', appointment.business_id).eq('status', 'open').limit(1).single();
            
            // AUTO-CREATE QUEUE: If no open queue exists, create a default one on the fly
            if (!queue) {
                console.log(`[updateAppointmentStatus] Auto-creating missing queue for business ${appointment.business_id}`);
                const { data: newQueue, error: qError } = await supabase.from('queues').insert([{
                    business_id: appointment.business_id,
                    name: 'Main Queue',
                    status: 'open',
                    current_wait_time_minutes: 0,
                    created_at: new Date().toISOString()
                }]).select().single();

                if (!qError && newQueue) {
                    queue = { id: newQueue.id };
                } else {
                    return res.status(400).json({ 
                        status: 'error', 
                        message: 'No open queue found and auto-creation failed.' 
                    });
                }
            }
            
            if (queue) {
                const { data: existing } = await supabase.from('queue_entries').select('id').eq('appointment_id', id).maybeSingle();
                if (!existing) {
                    const { data: maxPos } = await supabase.from('queue_entries').select('position').eq('queue_id', queue.id).eq('entry_date', todayStr).order('position', { ascending: false }).limit(1);
                    const nextPos = (maxPos?.[0]?.position || 0) + 1;
                    const totalDur = appointment.appointment_services?.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0) || 0;
                    const totalPri = appointment.appointment_services?.reduce((acc: number, s: any) => acc + (Number(s.price) || 0), 0) || 0;
                    const sNames = appointment.appointment_services?.map((s: any) => s.services?.name).filter(Boolean).join(', ') || 'Service';
                    const assignedProviderId =
                        appointment.appointment_services?.find((s: any) => !!s?.assigned_provider_id)?.assigned_provider_id || null;
                    let assignedToUserId: string | null = null;
                    if (assignedProviderId) {
                        const { data: providerRow } = await supabase
                            .from('service_providers')
                            .select('user_id')
                            .eq('id', assignedProviderId)
                            .maybeSingle();
                        assignedToUserId = providerRow?.user_id || null;
                    }

                    const { data: newEntry } = await supabase.from('queue_entries').insert([{
                        queue_id: queue.id, appointment_id: id, user_id: appointment.user_id,
                        customer_name: (appointment.guest_name || appointment.profiles?.full_name || 'Customer'),
                        phone: (appointment.guest_phone || appointment.profiles?.phone || null),
                        service_name: sNames, status: 'waiting', position: nextPos,
                        ticket_number: `A-${nextPos}`, entry_date: todayStr,
                        total_price: totalPri, total_duration_minutes: totalDur,
                        assigned_provider_id: assignedProviderId,
                        assigned_to: assignedToUserId
                    }]).select().single();

                    if (newEntry && appointment.appointment_services) {
                        const junctions = appointment.appointment_services.map((as: any) => ({
                            queue_entry_id: newEntry.id,
                            service_id: as.services.id,
                            price: as.price || 0,
                            duration_minutes: as.duration_minutes || 0,
                            assigned_provider_id: as.assigned_provider_id || null
                        }));
                        await supabase.from('queue_entry_services').insert(junctions);
                    }
                }
            }
        }
        else if (status === 'in_service') {
            const { data: qIn } = await supabase.from('queue_entries').select('*').eq('appointment_id', id).maybeSingle();
            if (qIn) {
                // If you have parallel serving logic or provider assignment, it would go here.
                // For now, simpler serving sync:
                await supabase.from('queue_entries').update({
                    status: 'serving',
                    service_started_at: new Date().toISOString()
                }).eq('id', qIn.id);
            }
        }
        else if (['completed', 'cancelled', 'no_show'].includes(status)) {
            const { data: qEntry } = await supabase.from('queue_entries').select('id, status').eq('appointment_id', id).maybeSingle();
            if (qEntry && !['completed', 'cancelled', 'no_show'].includes(qEntry.status)) {
                await supabase.from('queue_entries').update({
                    status: status === 'completed' ? 'completed' : 'cancelled',
                    completed_at: status === 'completed' ? new Date().toISOString() : null
                }).eq('id', qEntry.id);

                if (status === 'completed' && qEntry.id) {
                    await supabase.from('queue_entry_services').update({ task_status: 'done', completed_at: new Date().toISOString() }).eq('queue_entry_id', qEntry.id);
                }
            }
        }

        // 2. Update Appointment
        let { data: updated, error: updateError } = await supabase.from('appointments').update(updateData).eq('id', id).select().single();
        if (updateError && isMissingEmployeeIdColumnError(updateError) && Object.prototype.hasOwnProperty.call(updateData, 'employee_id')) {
            const { employee_id: _ignore, ...fallbackUpdateData } = updateData;
            const retry = await supabase.from('appointments').update(fallbackUpdateData).eq('id', id).select().single();
            updated = retry.data as any;
            updateError = retry.error as any;
        }
        if (updateError) throw updateError;

        // Notifications after owner decision
        const appointmentServices = appointment.appointment_services || [];
        const providerIds = Array.from(new Set(
            appointmentServices
                .map((row: any) => row?.assigned_provider_id)
                .filter(Boolean)
                .map((v: any) => String(v))
        ));
        if (status === 'confirmed' && (providerIds.length > 0 || updateData.employee_id)) {
            const { data: providerUsers } = await supabase
                .from('service_providers')
                .select('user_id')
                .in('id', providerIds);
            const employeeUserIds = Array.from(new Set([
                ...(providerUsers || []).map((p: any) => p?.user_id).filter(Boolean),
                updateData.employee_id || null
            ].filter(Boolean)));
            await Promise.allSettled(
                employeeUserIds.map((employeeId: any) =>
                    createBusinessNotification(
                        supabase,
                        appointment.business_id,
                        'Appointment confirmed',
                        `A new confirmed appointment is assigned to you.`,
                        'appointment_confirmed',
                        { appointment_id: appointment.id, start_time: appointment.start_time },
                        String(employeeId)
                    )
                )
            );
        }

        if (['confirmed', 'cancelled'].includes(status)) {
            const guestName = appointment.guest_name || appointment.profiles?.full_name || 'Customer';
            const customerPhone = appointment.guest_phone || appointment.profiles?.phone || null;
            if (customerPhone) {
                const msg = status === 'confirmed'
                    ? `Hi ${guestName}, your appointment has been confirmed.`
                    : `Hi ${guestName}, your appointment request has been cancelled.`;
                await Promise.allSettled([
                    notificationService.sendWhatsApp(customerPhone, msg),
                    notificationService.sendSMS(customerPhone, msg)
                ]);
            }
        }

        res.status(200).json({ status: 'success', data: updated });

    } catch (error: any) {
        console.error('[UpdateStatus] Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const acceptAppointment = async (req: Request, res: Response) => {
    req.body = { ...(req.body || {}), status: 'confirmed' };
    return updateAppointmentStatus(req, res);
};

export const rejectAppointment = async (req: Request, res: Response) => {
    req.body = { ...(req.body || {}), status: 'cancelled' };
    return updateAppointmentStatus(req, res);
};

export const bookPublicAppointment = async (req: Request, res: Response) => {
    try {
        const { business_id, service_ids, start_time, end_time, customer_name, phone, provider_id, employee_id } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!business_id || !start_time || !customer_name || !phone) {
            return res.status(400).json({
                status: 'error',
                message: 'Business ID, Start Time, Name, and Phone are required'
            });
        }

        // Fetch business for closing time validation
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('name, close_time, staff_close_time, is_closed, timezone')
            .eq('id', business_id)
            .single();

        if (bizError || !business) {
            return res.status(404).json({ status: 'error', message: 'Business not found' });
        }

        const availability = resolveBusinessAvailability(business);
        if (!availability.isOpen) {
            return res.status(400).json({
                status: 'error',
                message: availability.message || 'Business is currently closed.',
                availability_status: availability.state
            });
        }

        // Try to resolve an existing profile user_id from phone for public bookings.
        // This prevents user_id from staying null when customer already exists.
        let effectiveUserId: string | null = null;
        {
            const normalize = (v: any) => String(v || '').replace(/[^\d]/g, '');
            const raw = String(phone || '').trim();
            const digits = normalize(raw);
            const candidates = Array.from(new Set([raw, digits, `+${digits}`].filter((p) => !!p && String(p).length >= 8)));
            if (candidates.length > 0) {
                const { data: profilesByPhone } = await adminSupabase
                    .from('profiles')
                    .select('id, phone, role')
                    .in('phone', candidates);
                const exactMatches = (profilesByPhone || []).filter((p: any) => normalize(p?.phone) === digits);
                const customerExact = exactMatches.find((p: any) => String(p?.role || '').toLowerCase() === 'customer');
                const exact = customerExact || exactMatches[0];
                if (exact?.id) effectiveUserId = String(exact.id);
            }
        }

        // Insert appointment with customer details in metadata or a separate guest column if exists
        // Since the current schema doesn't have customer_name/phone in appointments table, 
        // I should ideally add them or use the 'notes' field if available.
        // Actually, let's check if I should add these columns to the appointments table.

        // Calculate total duration from services
        let totalDuration = 30; // Default
        let firstServiceId = null;
        if (service_ids && service_ids.length > 0) {
            const { data: sData } = await supabase
                .from('services')
                .select('duration_minutes, id')
                .in('id', service_ids);

            if (sData) {
                totalDuration = sData.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0);
                firstServiceId = sData[0].id;
            }
        }

        // Buffer for closing time protection
        const bufferMins = 10;
        const timezone = business.timezone || 'UTC';
        const effectiveClose = (business as any).staff_close_time || business.close_time;
        const closeMins = require('../utils/timeUtils').parseTimeToMinutes(effectiveClose);
        const startMins = getLocalMinutes(timezone, new Date(start_time));
        const estEndMins = startMins + totalDuration;

        if (estEndMins > (closeMins - bufferMins)) {
            return res.status(400).json({
                status: 'error',
                message: "We’re fully booked for today. Please select a slot for tomorrow."
            });
        }

        const calculatedEndTime = end_time || new Date(new Date(start_time).getTime() + totalDuration * 60000).toISOString();

        let resolvedEmployeeId: string | null = employee_id || null;
        let resolvedProviderId: string | null = provider_id || null;
        if (!resolvedProviderId && resolvedEmployeeId) {
            const { data: pByEmployee } = await supabase
                .from('service_providers')
                .select('id')
                .eq('business_id', business_id)
                .eq('user_id', resolvedEmployeeId)
                .maybeSingle();
            resolvedProviderId = pByEmployee?.id || null;
        } else if (resolvedProviderId && !resolvedEmployeeId) {
            const { data: pByProvider } = await supabase
                .from('service_providers')
                .select('user_id')
                .eq('id', resolvedProviderId)
                .maybeSingle();
            resolvedEmployeeId = pByProvider?.user_id || null;
        }

        let publicInsertPayload: any = {
            user_id: effectiveUserId,
            business_id,
            service_id: firstServiceId,
            start_time,
            end_time: calculatedEndTime,
            status: 'pending',
            employee_id: resolvedEmployeeId,
            guest_name: customer_name,
            guest_phone: phone
        };
        let { data, error } = await supabase
            .from('appointments')
            .insert([publicInsertPayload])
            .select()
            .single();

        if (error && isMissingEmployeeIdColumnError(error)) {
            const { employee_id: _ignore, ...fallbackPublicPayload } = publicInsertPayload;
            const retry = await supabase
                .from('appointments')
                .insert([fallbackPublicPayload])
                .select()
                .single();
            data = retry.data as any;
            error = retry.error as any;
        }
        if (error) throw error;
        console.log('[bookPublicAppointment] Supabase Insert Result:', { data, error });

        if (!data || !data.id) {
            return res.status(403).json({
                status: 'error',
                message: 'Booking failed. This might be due to security policies or missing information.',
                details: 'Data or ID missing from response'
            });
        }

        // Link services in junction table with snapshots
        if (service_ids && service_ids.length > 0) {
            const { data: sData } = await supabase
                .from('services')
                .select('id, price, duration_minutes')
                .in('id', service_ids);

            if (sData) {
                const junctionEntries = sData.map((s: any) => ({
                    appointment_id: data.id,
                    service_id: s.id,
                    price: s.price || 0,
                    duration_minutes: s.duration_minutes || 0,
                    assigned_provider_id: resolvedProviderId || null
                }));
                await supabase.from('appointment_services').insert(junctionEntries);
            }
        }

        await notifyOwnerForNewAppointment(
            supabase,
            business_id,
            customer_name,
            start_time
        );

        res.status(201).json({
            status: 'success',
            message: 'Appointment request sent successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const sendAppointmentAlert = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Fetch appointment with business and profile info
        const { data: appointment, error: fetchError } = await supabase
            .from('appointments')
            .select(`
                *,
                businesses (name, owner_id),
                profiles (full_name, phone)
            `)
            .eq('id', id)
            .single();

        if (fetchError || !appointment) {
            console.error('[SendAlert] Fetch Error:', fetchError);
            return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        }

        // 2. Verify ownership
        if (appointment.businesses.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 3. Determine Recipient
        const guestName = appointment.guest_name || appointment.profiles?.full_name || 'Guest';
        let recipient = appointment.guest_phone || appointment.profiles?.phone;

        if (!recipient) {
            console.warn(`[SendAlert] No phone number found for appointment ${id}`);
            return res.status(400).json({ status: 'error', message: 'Customer phone number missing' });
        }

        // 4. Send WhatsApp Alert
        const message = `Hello ${guestName},\n\nYour turn for your appointment at *${appointment.businesses.name}* is coming up next! Please arrive soon.\n\nSee you soon!`;

        console.log(`[SendAlert] Sending message to ${recipient}: ${message.substring(0, 50)}...`);
        const sent = await notificationService.sendSMS(recipient, message);

        if (!sent) {
            return res.status(500).json({ status: 'error', message: 'Failed to deliver notification' });
        }

        res.status(200).json({
            status: 'success',
            message: 'Alert sent successfully'
        });

    } catch (error: any) {
        console.error('[SendAlert] Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const rescheduleAppointment = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { start_time } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId || !start_time) {
            return res.status(400).json({ status: 'error', message: 'Unauthorized or missing start_time' });
        }

        // 1. Fetch appointment details
        const { data: appointment, error: fetchError } = await supabase
            .from('appointments')
            .select(`
                *,
                businesses (close_time, owner_id, name, timezone, language),
                appointment_services (duration_minutes)
            `)
            .eq('id', id)
            .single();

        if (fetchError || !appointment) {
            return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        }

        // 2. Ownership check
        if (appointment.businesses.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 3. Closing time re-validation
        const totalDuration = appointment.appointment_services?.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0) || 30;
        const timezone = appointment.businesses?.timezone || 'UTC';
        const closeMins = require('../utils/timeUtils').parseTimeToMinutes(appointment.businesses.close_time);
        const startMins = getLocalMinutes(timezone, new Date(start_time));
        const estEndMins = startMins + totalDuration;

        if (estEndMins > (closeMins - 10)) {
            return res.status(400).json({
                status: 'error',
                message: "We’re fully booked for today. Please select a slot for tomorrow."
            });
        }

        const calculatedEndTime = new Date(new Date(start_time).getTime() + totalDuration * 60000).toISOString();

        // 4. Update
        const { data, error } = await supabase
            .from('appointments')
            .update({
                start_time,
                end_time: calculatedEndTime,
                status: 'rescheduled'
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Notify client
        const recipient = appointment.guest_phone || null;
        const displayTime = new Date(start_time).toLocaleString('en-IN', { timeZone: timezone });
        let customerLang = appointment.businesses?.language || 'en';
        if (!recipient && appointment.user_id) {
            const { data: profile } = await supabase.from('profiles').select('phone, ui_language').eq('id', appointment.user_id).maybeSingle();
            if (profile?.ui_language) customerLang = profile.ui_language;
            if (profile?.phone) {
                const msg = appointmentRescheduledMessage(customerLang, appointment.businesses.name, displayTime);
                await Promise.allSettled([
                    notificationService.sendSMS(profile.phone, msg),
                    notificationService.sendWhatsApp(profile.phone, msg)
                ]);
            }
        } else if (recipient) {
            const msg = appointmentRescheduledMessage(customerLang, appointment.businesses.name, displayTime);
            await Promise.allSettled([
                notificationService.sendSMS(recipient, msg),
                notificationService.sendWhatsApp(recipient, msg)
            ]);
        }

        res.status(200).json({
            status: 'success',
            message: 'Appointment rescheduled successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const cancelAppointment = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Fetch to verify ownership
        const { data: appointment, error: fetchError } = await supabase
            .from('appointments')
            .select(`*, businesses (owner_id, name)`)
            .eq('id', id)
            .single();

        if (fetchError || !appointment) {
            return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        }

        if (appointment.businesses.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data, error } = await supabase
            .from('appointments')
            .update({ status: 'cancelled' })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Notify customer by WhatsApp/SMS (best effort)
        let recipient = appointment.guest_phone || null;
        if (!recipient && appointment.user_id) {
            const { data: customerProfile } = await supabase
                .from('profiles')
                .select('phone')
                .eq('id', appointment.user_id)
                .maybeSingle();
            recipient = customerProfile?.phone || null;
        }
        if (recipient) {
            const customerName = appointment.guest_name || 'Customer';
            const msg = `Hi ${customerName}, your appointment at ${appointment.businesses.name} has been cancelled by the owner.`;
            await Promise.allSettled([
                notificationService.sendWhatsApp(recipient, msg),
                notificationService.sendSMS(recipient, msg)
            ]);
        }

        res.status(200).json({
            status: 'success',
            message: 'Appointment cancelled successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const processAppointmentPayment = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { payment_method } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data: appointment, error: fetchError } = await supabase
            .from('appointments')
            .select(`businesses (owner_id)`)
            .eq('id', id)
            .single();

        if (fetchError || !appointment) {
            return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        }

        if (appointment.businesses.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data, error } = await supabase
            .from('appointments')
            .update({
                payment_method,
                payment_status: 'paid',
                paid_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // --- SYNC PAYMENT TO QUEUE ENTRY ---
        // If an appointment is paid, the queue entry should also reflect it to avoid 'unpaid' status lingering.
        await supabase
            .from('queue_entries')
            .update({
                payment_method,
                payment_status: 'paid'
            })
            .eq('appointment_id', id);
        // -----------------------------------

        res.status(200).json({
            status: 'success',
            message: 'Payment updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
