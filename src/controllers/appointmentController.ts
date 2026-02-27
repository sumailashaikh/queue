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

            const isToday = new Date(appt.start_time).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === todayStr;
            const isTerminal = ['completed', 'no_show', 'cancelled'].includes(appt.status);

            const activeQueueEntry = (appt.queue_entries || []).find((q: any) => !['completed', 'cancelled', 'no_show', 'skipped'].includes(q.status));

            // Refined logic for queue_entry metadata
            const queueEntry = (isToday && !isTerminal) ? activeQueueEntry : null;

            return {
                ...appt,
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

export const updateAppointmentStatus = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

        const validStatuses = ['scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'expired'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        const { data: appts, error: fetchError } = await supabase
            .from('appointments')
            .select(`
                *,
                businesses!business_id (id, name, owner_id, checkin_creates_queue_entry),
                appointment_services!appointment_id (
                    id, price, duration_minutes,
                    services!service_id (id, name)
                ),
                profiles (full_name, phone)
            `)
            .eq('id', id);

        const appointment = appts?.[0];
        if (fetchError || !appointment) return res.status(404).json({ status: 'error', message: 'Appointment not found' });

        const business = Array.isArray(appointment.businesses) ? appointment.businesses[0] : appointment.businesses;
        if (!business || business.owner_id !== userId) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const currentStatus = appointment.status;

        // Terminal status check
        if (['cancelled', 'no_show', 'completed'].includes(currentStatus)) {
            return res.status(400).json({ status: 'error', message: 'Already in terminal state' });
        }

        let updateData: any = { status };
        if (status === 'checked_in') updateData.checked_in_at = new Date().toISOString();
        if (status === 'completed') updateData.completed_at = new Date().toISOString();

        // 1. Sync with Queue
        if (status === 'checked_in' && business.checkin_creates_queue_entry !== false) {
            const { data: queue } = await supabase.from('queues').select('id').eq('business_id', appointment.business_id).eq('status', 'open').limit(1).single();
            if (queue) {
                const { data: existing } = await supabase.from('queue_entries').select('id').eq('appointment_id', id).maybeSingle();
                if (!existing) {
                    const { data: maxPos } = await supabase.from('queue_entries').select('position').eq('queue_id', queue.id).eq('entry_date', todayStr).order('position', { ascending: false }).limit(1);
                    const nextPos = (maxPos?.[0]?.position || 0) + 1;
                    const totalDur = appointment.appointment_services?.reduce((acc: number, s: any) => acc + (s.duration_minutes || 0), 0) || 0;
                    const totalPri = appointment.appointment_services?.reduce((acc: number, s: any) => acc + (Number(s.price) || 0), 0) || 0;
                    const sNames = appointment.appointment_services?.map((s: any) => s.services?.name).filter(Boolean).join(', ') || 'Service';

                    const { data: newEntry } = await supabase.from('queue_entries').insert([{
                        queue_id: queue.id, appointment_id: id, user_id: appointment.user_id,
                        customer_name: (appointment.profiles?.full_name || appointment.guest_name || 'Customer'),
                        phone: (appointment.profiles?.phone || appointment.guest_phone || null),
                        service_name: sNames, status: 'waiting', position: nextPos,
                        ticket_number: `A-${nextPos}`, entry_date: todayStr,
                        total_price: totalPri, total_duration_minutes: totalDur
                    }]).select().single();

                    if (newEntry && appointment.appointment_services) {
                        const junctions = appointment.appointment_services.map((as: any) => ({
                            queue_entry_id: newEntry.id, service_id: as.services.id, price: as.price || 0, duration_minutes: as.duration_minutes || 0
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
        const { data: updated, error: updateError } = await supabase.from('appointments').update(updateData).eq('id', id).select().single();
        if (updateError) throw updateError;

        res.status(200).json({ status: 'success', data: updated });

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
