import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';
import { isBusinessOpen } from '../utils/timeUtils';
import { recomputeProviderDelays } from '../utils/delayLogic';

export const createAppointment = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id, service_ids, start_time, end_time } = req.body; // service_ids is now an array
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
            .select('name, open_time, close_time, is_closed')
            .eq('id', business_id)
            .single();

        if (bizError || !business) {
            return res.status(404).json({ status: 'error', message: 'Business not found' });
        }

        // Check business manually closed status (completely offline)
        if (business.is_closed) {
            return res.status(400).json({ status: 'error', message: 'Business is closed. Please book during working hours.' });
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
        const nowMins = require('../utils/timeUtils').getISTMinutes();
        const closeMins = require('../utils/timeUtils').parseTimeToMinutes(business.close_time);

        // Check if appointment date is today
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const apptDateStr = new Date(start_time).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (todayStr === apptDateStr) {
            // For today, we consider current time vs start time
            const startMins = require('../utils/timeUtils').getISTMinutes(new Date(start_time));
            const estEndMins = startMins + totalDuration;

            if (estEndMins > (closeMins - 10)) {
                return res.status(400).json({
                    status: 'error',
                    message: "We’re fully booked for today. Please select a slot for tomorrow."
                });
            }
        } else {
            // For future days, just check against closing time
            const startMins = require('../utils/timeUtils').getISTMinutes(new Date(start_time));
            const estEndMins = startMins + totalDuration;
            if (estEndMins > (closeMins - 10)) {
                return res.status(400).json({
                    status: 'error',
                    message: "We’re fully booked for today. Please select a slot for tomorrow."
                });
            }
        }

        const calculatedEndTime = end_time || new Date(new Date(start_time).getTime() + totalDuration * 60000).toISOString();

        const { data, error } = await supabase
            .from('appointments')
            .insert([
                {
                    user_id: userId,
                    business_id,
                    service_id, // Legacy compatibility
                    start_time,
                    end_time: calculatedEndTime,
                    status: 'scheduled' // Updated status to scheduled
                }
            ])
            .select()
            .single();

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
                    duration_minutes: s.duration_minutes || 0
                }));
                await supabase.from('appointment_services').insert(junctionEntries);
            }
        }

        // Send Notification
        const recipient = `User-${userId}`; // Mock phone lookup
        await notificationService.sendSMS(recipient, `Your appointment is scheduled for ${start_time}.`);

        res.status(201).json({
            status: 'success',
            message: 'Appointment scheduled successfully',
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

export const getBusinessAppointments = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get businesses owned by user
        const { data: businesses, error: businessError } = await supabase
            .from('businesses')
            .select('id')
            .eq('owner_id', userId);

        if (businessError) throw businessError;

        if (!businesses || businesses.length === 0) {
            return res.status(200).json({ status: 'success', data: [] });
        }

        const businessIds = businesses.map((b: any) => b.id);

        // 1.5 Auto-Process No-Shows & Expirations (30-min grace period)
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60000).toISOString();

        // Auto mark no_show for today's past due appointments
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const { data: expiredAppointments } = await supabase
            .from('appointments')
            .update({ status: 'no_show' })
            .in('business_id', businessIds)
            .in('status', ['scheduled', 'confirmed'])
            .lt('start_time', thirtyMinsAgo)
            .gte('start_time', todayStr + 'T00:00:00Z') // Only today's
            .select('id');

        // Also sync with queue entries if any expired
        if (expiredAppointments && expiredAppointments.length > 0) {
            const expiredIds = expiredAppointments.map((a: { id: string }) => a.id);
            await supabase
                .from('queue_entries')
                .update({ status: 'no_show' })
                .in('appointment_id', expiredIds)
                .in('status', ['waiting', 'serving']);
        }

        // 2. Get appointments for these businesses
        const { data, error } = await supabase
            .from('appointments')
            .select(`
                *,
                profiles (full_name, id, phone),
                appointment_services!appointment_id (
                    services!service_id (id, name, duration_minutes)
                ),
                queue_entries (id, status, ticket_number)
            `)
            .in('business_id', businessIds)
            .order('start_time', { ascending: true });

        if (error) throw error;

        const enhancedData = data.map((appt: any) => {
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
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled'
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const validStatuses = ['scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'expired'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ status: 'error', message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        // 1. Fetch appointment with business and service info
        const { data: appts, error: fetchError } = await supabase
            .from('appointments')
            .select(`
                *,
                businesses!business_id (id, name, owner_id),
                appointment_services!appointment_id (
                    id,
                    price,
                    duration_minutes,
                    services!service_id (id, name)
                )
            `)
            .eq('id', id);

        const appointment = appts && appts.length > 0 ? (appts[0] as any) : null;

        if (fetchError || !appointment) {
            console.error('[UpdateStatus] Fetch Error:', fetchError);
            console.error('[UpdateStatus] Params - ID:', id, 'User:', userId);
            return res.status(404).json({
                status: 'error',
                message: 'Appointment not found',
                details: fetchError?.message
            });
        }

        // 1.1 Date Validation for Check-In
        if (status === 'checked_in') {
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const aptDateStr = new Date(appointment.start_time).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

            if (aptDateStr !== todayStr) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Past or future appointments cannot be checked in. This customer must join the queue fresh or book a new appointment for today.'
                });
            }
        }

        // Handle possible array/object from join
        const business = Array.isArray(appointment.businesses) ? appointment.businesses[0] : appointment.businesses;

        if (!business || business.owner_id !== userId) {
            console.error('[UpdateStatus] Ownership failure:', { business, userId });
            return res.status(403).json({ status: 'error', message: 'Unauthorized to update this appointment' });
        }

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // --- PREVENT ILLEGAL TRANSITIONS ---
        const currentStatus = appointment.status;
        const terminalStatuses = ['cancelled', 'no_show', 'completed'];

        if (terminalStatuses.includes(currentStatus)) {
            return res.status(400).json({ status: 'error', message: `Cannot update appointment in terminal state: ${currentStatus}` });
        }

        const allowedTransitions: Record<string, string[]> = {
            'scheduled': ['confirmed', 'checked_in', 'cancelled', 'no_show'],
            'confirmed': ['checked_in', 'cancelled', 'no_show'],
            'checked_in': ['in_service', 'cancelled', 'no_show'],
            'in_service': ['completed', 'cancelled', 'no_show'],
            'no_show': [], // Terminal
            'cancelled': [], // Terminal
            'completed': [] // Terminal
        };

        if (allowedTransitions[currentStatus] && !allowedTransitions[currentStatus].includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: `Invalid transition from ${currentStatus} to ${status}. Expected flow: scheduled → confirmed → checked_in → in_service → completed`
            });
        }
        // -----------------------------------

        let updateData: any = { status };

        if (status === 'checked_in') {
            updateData.checked_in_at = new Date().toISOString();
        }

        // 2. Handle Logic for specific transitions
        if (status === 'checked_in') {
            // Only create a queue entry if business setting allows
            if (business.checkin_creates_queue_entry !== false) { // Defaults to true if column missing or true
                // First, find an open queue for this business
                const { data: queue } = await supabase
                    .from('queues')
                    .select('id')
                    .eq('business_id', appointment.business_id)
                    .eq('status', 'open')
                    .limit(1)
                    .single();

                if (!queue) {
                    return res.status(400).json({ status: 'error', message: 'No open queue found for this business. Please open a queue first.' });
                }

                // Check if queue entry already exists for this appointment
                const { data: existingEntry } = await supabase
                    .from('queue_entries')
                    .select('id')
                    .eq('appointment_id', id)
                    .single();

                if (!existingEntry) {
                    // Get next position
                    const { data: maxPosData } = await supabase
                        .from('queue_entries')
                        .select('position')
                        .eq('queue_id', queue.id)
                        .eq('entry_date', todayStr)
                        .order('position', { ascending: false })
                        .limit(1);

                    const nextPosition = (maxPosData && maxPosData.length > 0) ? maxPosData[0].position + 1 : 1;

                    const apptData = appointment as any;
                    const total_duration_minutes = apptData.appointment_services?.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0) || 0;
                    const total_price = apptData.appointment_services?.reduce((acc: number, s: any) => acc + (Number(s.price) || 0), 0) || 0;
                    const serviceNamesDisplay = apptData.appointment_services?.map((s: any) => s.services?.name).filter(Boolean).join(', ') || 'Appointment Service';

                    const { data: newEntry, error: entryError } = await supabase
                        .from('queue_entries')
                        .insert([{
                            queue_id: queue.id,
                            appointment_id: id,
                            user_id: apptData.user_id,
                            customer_name: (apptData.profiles?.full_name || apptData.guest_name || 'Appointment Customer'),
                            phone: (apptData.profiles?.phone || apptData.guest_phone || null),
                            service_name: serviceNamesDisplay,
                            status: 'waiting',
                            position: nextPosition,
                            ticket_number: `A-${nextPosition}`,
                            entry_date: todayStr,
                            total_price,
                            total_duration_minutes
                        }])
                        .select()
                        .single();

                    if (entryError) throw entryError;
                    if (apptData.appointment_services && apptData.appointment_services.length > 0) {
                        const junctionEntries = apptData.appointment_services.map((as: any) => ({
                            queue_entry_id: newEntry.id,
                            service_id: as.services.id,
                            price: as.price || 0,
                            duration_minutes: as.duration_minutes || 0
                        }));
                        await supabase.from('queue_entry_services').insert(junctionEntries);
                    }
                }
            }
        }
        else if (status === 'in_service') {
            // --- PARALLEL SERVING LOGIC & PROVIDER ASSIGNMENT ---
            const { data: qIn } = await supabase
                .from('queue_entries')
                .select(`
                    id, 
                    queue_id, 
                    entry_date, 
                    total_duration_minutes,
                    assigned_provider_id,
                    queue_entry_services (service_id)
                `)
                .eq('appointment_id', id)
                .single();

            if (qIn) {
                // 1. Get current busy providers for this business today
                const { data: busyProviders } = await supabase
                    .from('queue_entries')
                    .select('assigned_provider_id')
                    .eq('entry_date', qIn.entry_date)
                    .eq('status', 'serving')
                    .not('assigned_provider_id', 'is', null);

                const busyProviderIds = busyProviders?.map((p: any) => p.assigned_provider_id) || [];

                let eligibleProviderId = qIn.assigned_provider_id;

                // 2. Provider Assignment Logic
                if (!eligibleProviderId) {
                    const requiredServiceIds = (qIn as any).queue_entry_services?.map((s: any) => s.service_id) || [];

                    // Find providers for this business
                    const { data: providers, error: provError } = await supabase
                        .from('service_providers')
                        .select(`
                            id,
                            name,
                            provider_services (service_id)
                        `)
                        .eq('business_id', appointment.business_id)
                        .eq('is_active', true);

                    if (provError) throw provError;

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

                // 2.5 Validation: Expert On Leave check
                const { data: leaves } = await supabase
                    .from('provider_leaves')
                    .select('id')
                    .eq('provider_id', eligibleProviderId)
                    .lte('start_date', qIn.entry_date)
                    .gte('end_date', qIn.entry_date);

                if (leaves && leaves.length > 0) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Cannot start: This expert is on leave today.'
                    });
                }

                // 3. Timing snapshots and SMS ETA
                const now = new Date();
                const duration = Number(qIn.total_duration_minutes || 0);
                const estEnd = new Date(now.getTime() + duration * 60000);

                await supabase
                    .from('queue_entries')
                    .update({
                        status: 'serving',
                        served_at: now.toISOString(),
                        service_started_at: now.toISOString(),
                        estimated_end_at: estEnd.toISOString(),
                        assigned_provider_id: eligibleProviderId
                    })
                    .eq('appointment_id', id);

                // Update per-service assignment in queue_entry_services
                await supabase
                    .from('queue_entry_services')
                    .update({ assigned_provider_id: eligibleProviderId })
                    .eq('queue_entry_id', qIn.id);

                const recipient = appointment.guest_phone || `User-${appointment.user_id}`;
                const etaStr = estEnd.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
                await notificationService.sendSMS(recipient, `Hello ${appointment.guest_name || 'Guest'},\n\nIt's now your turn at *${appointment.businesses.name}*! Estimated completion is ${etaStr}. Please proceed to the service area.\n\nThank you!`);

                // Recompute delays for this provider's upcoming appointments
                await recomputeProviderDelays(eligibleProviderId, appointment.business_id, estEnd).catch(err => {
                    console.error('[appointmentController] Failed to recompute delays in in_service:', err);
                });
            } else {
                // If no queue entry found, just update appointment (though there should be one if checked_in)
                console.warn(`[Appointment] No queue entry found for appointment ${id} during in_service transition`);
            }

        } else if (status === 'completed') {
            const now = new Date();
            updateData.completed_at = now.toISOString();

            // 1. Fetch timing data from queue entry to calculate delay
            const { data: timingData } = await supabase
                .from('queue_entries')
                .select('id, service_started_at, estimated_end_at, assigned_provider_id')
                .eq('appointment_id', id)
                .single();

            let entryUpdates: any = {
                status: 'completed',
                completed_at: now.toISOString()
            };

            if (timingData?.service_started_at) {
                const start = new Date(timingData.service_started_at);
                const actualDuration = Math.round((now.getTime() - start.getTime()) / 60000);
                entryUpdates.actual_duration_minutes = actualDuration;

                if (timingData.estimated_end_at) {
                    const estEnd = new Date(timingData.estimated_end_at);
                    const delay = Math.max(0, Math.round((now.getTime() - estEnd.getTime()) / 60000));
                    entryUpdates.delay_minutes = delay;
                }
            }

            // 2. Update queue entry and its services
            await supabase
                .from('queue_entries')
                .update(entryUpdates)
                .eq('appointment_id', id);

            // 3. Update services to 'done' for analytics
            if (timingData?.id) {
                await supabase
                    .from('queue_entry_services')
                    .update({
                        task_status: 'done',
                        completed_at: now.toISOString(),
                        actual_minutes: entryUpdates.actual_duration_minutes || null
                    })
                    .eq('queue_entry_id', timingData.id);
            }

            if (timingData?.assigned_provider_id) {
                await recomputeProviderDelays(timingData.assigned_provider_id, appointment.business_id, now).catch(err => {
                    console.error('[appointmentController] Failed to recompute delays in completed:', err);
                });
            }
        }

        // updateData.started_at = new Date().toISOString(); // Column missing

        // 3. Perform the main appointment update
        // 3. Update Sync Logic for Terminal Statuses
        if (status === 'no_show' || status === 'cancelled') {
            await supabase
                .from('queue_entries')
                .update({ status: status })
                .eq('appointment_id', id)
                .in('status', ['waiting', 'serving']);
        }

        const { data, error: updateError } = await supabase
            .from('appointments')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        // --- SYNC STATUS TO QUEUE ENTRY ---
        if (['no_show', 'cancelled', 'completed'].includes(status)) {
            let entryStatus = status;
            if (status === 'cancelled') entryStatus = 'cancelled'; // Explicitly set

            const { data: qeUpdate } = await supabase
                .from('queue_entries')
                .update({
                    status: entryStatus,
                    completed_at: status === 'completed' ? new Date().toISOString() : null
                })
                .eq('appointment_id', id)
                .select();

            // Create a queue entry for appointments marked no_show directly, so they appear in Live Queue
            if (status === 'no_show' && (!qeUpdate || qeUpdate.length === 0)) {
                const { data: queue } = await supabase
                    .from('queues')
                    .select('id')
                    .eq('business_id', appointment.business_id)
                    .eq('status', 'open')
                    .limit(1)
                    .single();

                if (queue) {
                    const apptData = appointment as any;
                    const total_duration_minutes = apptData.appointment_services?.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0) || 0;
                    const total_price = apptData.appointment_services?.reduce((acc: number, s: any) => acc + (Number(s.price) || 0), 0) || 0;
                    const serviceNamesDisplay = apptData.appointment_services?.map((s: any) => s.services?.name).filter(Boolean).join(', ') || 'Appointment Service';

                    await supabase
                        .from('queue_entries')
                        .insert([{
                            queue_id: queue.id,
                            appointment_id: id,
                            user_id: apptData.user_id,
                            customer_name: (apptData.profiles?.full_name || apptData.guest_name || 'Appointment Customer'),
                            phone: (apptData.profiles?.phone || apptData.guest_phone || null),
                            service_name: serviceNamesDisplay,
                            status: 'no_show',
                            position: 0,
                            ticket_number: `A-NS`,
                            entry_date: todayStr,
                            total_price,
                            total_duration_minutes
                        }]);
                }
            }
        }
        // ----------------------------------

        // 4. Compute derived fields for the response
        const now = new Date();
        const startTime = new Date(data.start_time);
        const duration = appointment.appointment_services?.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0) || 30;
        const expectedEndAt = new Date(startTime.getTime() + duration * 60000);

        const isLate = ['scheduled', 'confirmed', 'checked_in'].includes(data.status) && now > startTime;
        const lateMinutes = isLate ? Math.max(0, Math.round((now.getTime() - startTime.getTime()) / 60000)) : 0;

        let appointmentState = data.status.toUpperCase();
        if (isLate) appointmentState = 'LATE';
        if (data.status === 'scheduled' && now < startTime) appointmentState = 'UPCOMING';

        res.status(200).json({
            status: 'success',
            message: `Appointment status updated to ${status}`,
            data: {
                ...data,
                appointment_state: appointmentState,
                is_late: isLate,
                late_minutes: lateMinutes,
                expected_end_at: expectedEndAt.toISOString()
            }
        });

    } catch (error: any) {
        console.error('[UpdateStatus] Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const bookPublicAppointment = async (req: Request, res: Response) => {
    try {
        const { business_id, service_ids, start_time, end_time, customer_name, phone } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!business_id || !start_time || !customer_name || !phone) {
            return res.status(400).json({
                status: 'error',
                message: 'Business ID, Start Time, Name, and Phone are required'
            });
        }

        // Fetch business for closing time validation
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('name, close_time, is_closed')
            .eq('id', business_id)
            .single();

        if (bizError || !business) {
            return res.status(404).json({ status: 'error', message: 'Business not found' });
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
        const closeMins = require('../utils/timeUtils').parseTimeToMinutes(business.close_time);
        const startMins = require('../utils/timeUtils').getISTMinutes(new Date(start_time));
        const estEndMins = startMins + totalDuration;

        if (estEndMins > (closeMins - bufferMins)) {
            return res.status(400).json({
                status: 'error',
                message: "We’re fully booked for today. Please select a slot for tomorrow."
            });
        }

        const calculatedEndTime = end_time || new Date(new Date(start_time).getTime() + totalDuration * 60000).toISOString();

        const { data, error } = await supabase
            .from('appointments')
            .insert([
                {
                    business_id,
                    service_id: firstServiceId,
                    start_time,
                    end_time: calculatedEndTime,
                    status: 'scheduled', // Updated status to scheduled
                    guest_name: customer_name,
                    guest_phone: phone
                }
            ])
            .select()
            .single();

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
                    duration_minutes: s.duration_minutes || 0
                }));
                await supabase.from('appointment_services').insert(junctionEntries);
            }
        }

        // Send Notification to Business Owner
        // For simplicity, just log it
        console.log(`[PUBLIC APPOINTMENT] New request from ${customer_name} (${phone}) for ${start_time}`);

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
                businesses (close_time, owner_id, name),
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
        const closeMins = require('../utils/timeUtils').parseTimeToMinutes(appointment.businesses.close_time);
        const startMins = require('../utils/timeUtils').getISTMinutes(new Date(start_time));
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
        const recipient = appointment.guest_phone || `User-${appointment.user_id}`;
        await notificationService.sendSMS(recipient, `Your appointment at ${appointment.businesses.name} has been rescheduled to ${new Date(start_time).toLocaleString('en-IN')}.`);

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

        // Notify client
        const recipient = appointment.guest_phone || `User-${appointment.user_id}`;
        await notificationService.sendSMS(recipient, `Your appointment at ${appointment.businesses.name} has been cancelled.`);

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
