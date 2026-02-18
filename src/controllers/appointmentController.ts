import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';
import { isBusinessOpen } from '../utils/timeUtils';

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

        const businessStatus = isBusinessOpen(business);
        if (!businessStatus.isOpen) {
            return res.status(400).json({ status: 'error', message: businessStatus.message });
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
                    status: 'pending'
                }
            ])
            .select()
            .single();

        if (error) throw error;

        // Link services in junction table
        if (service_ids && service_ids.length > 0) {
            const junctionEntries = service_ids.map((sId: string) => ({
                appointment_id: data.id,
                service_id: sId
            }));
            await supabase.from('appointment_services').insert(junctionEntries);
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
                )
            `)
            .eq('user_id', userId)
            .order('start_time', { ascending: true });

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

        // 2. Get appointments for these businesses
        const { data, error } = await supabase
            .from('appointments')
            .select(`
                *,
                profiles (full_name, id, phone),
                appointment_services!appointment_id (
                    services!service_id (id, name, duration_minutes)
                )
            `)
            .in('business_id', businessIds)
            .order('start_time', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data
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

        const validStatuses = ['scheduled', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ status: 'error', message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        // 1. Fetch appointment with business and service info
        const { data: appointment, error: fetchError } = await supabase
            .from('appointments')
            .select(`
                *,
                businesses (id, name, owner_id),
                appointment_services!appointment_id (
                    services!service_id (id, name, duration_minutes)
                )
            `)
            .eq('id', id)
            .single();

        if (fetchError || !appointment) {
            return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        }

        if (appointment.businesses.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized to update this appointment' });
        }

        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        let updateData: any = { status };

        // 2. Handle Logic for specific transitions
        if (status === 'checked_in') {
            // Create a queue entry if not already created
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
                const ticketNumber = `A-${nextPosition}`; // A for Appointment

                const services = (appointment as any).appointment_services?.map((as: any) => as.services).filter(Boolean) || [];
                const serviceNamesDisplay = services.map((s: any) => s.name).join(', ') || 'Appointment Service';

                const { data: newEntry, error: entryError } = await supabase
                    .from('queue_entries')
                    .insert([{
                        queue_id: queue.id,
                        appointment_id: id,
                        customer_name: appointment.guest_name || (appointment.profiles as any)?.full_name || 'Premium Guest',
                        phone: appointment.guest_phone || (appointment.profiles as any)?.phone,
                        status: 'waiting',
                        position: nextPosition,
                        ticket_number: ticketNumber,
                        entry_date: todayStr,
                        service_name: serviceNamesDisplay
                    }])
                    .select()
                    .single();

                if (entryError) throw entryError;

                // Sync services to queue_entry_services
                if (services.length > 0 && newEntry) {
                    const queueServiceEntries = services.map((s: any) => ({
                        entry_id: newEntry.id,
                        service_id: s.id
                    }));
                    await supabase.from('queue_entry_services').insert(queueServiceEntries);
                }
            }
        } else if (status === 'in_service') {
            // Update queue entry to 'serving'
            await supabase
                .from('queue_entries')
                .update({ status: 'serving', served_at: new Date().toISOString() })
                .eq('appointment_id', id);

            // WhatsApp: Send "It's your turn now"
            const recipient = appointment.guest_phone || `User-${appointment.user_id}`;
            await notificationService.sendSMS(recipient, `Hello ${appointment.guest_name || 'Guest'},\n\nIt's now your turn at *${appointment.businesses.name}*! Please proceed to the service area.\n\nThank you!`);

        } else if (status === 'completed') {
            updateData.completed_at = new Date().toISOString();
            // Update queue entry to 'completed'
            await supabase
                .from('queue_entries')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('appointment_id', id);
        }

        // 3. Perform the main appointment update
        const { data, error } = await supabase
            .from('appointments')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // 4. Send confirmation for regular statuses if needed
        const recipient = appointment.guest_phone || `User-${appointment.user_id}`;
        if (status === 'confirmed') {
            await notificationService.sendSMS(recipient, `Your appointment at *${appointment.businesses.name}* is now **CONFIRMED**! We look forward to seeing you.`);
        } else if (status === 'cancelled') {
            await notificationService.sendSMS(recipient, `Your appointment at ${appointment.businesses.name} has been cancelled.`);
        }

        res.status(200).json({
            status: 'success',
            message: `Appointment status updated to ${status}`,
            data
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

        const calculatedEndTime = end_time || new Date(new Date(start_time).getTime() + totalDuration * 60000).toISOString();

        const { data, error } = await supabase
            .from('appointments')
            .insert([
                {
                    business_id,
                    service_id: firstServiceId,
                    start_time,
                    end_time: calculatedEndTime,
                    status: 'pending',
                    guest_name: customer_name,
                    guest_phone: phone
                }
            ])
            .select()
            .single();

        if (error) throw error;

        // Link services in junction table
        if (service_ids && service_ids.length > 0) {
            const junctionEntries = service_ids.map((sId: string) => ({
                appointment_id: data.id,
                service_id: sId
            }));
            await supabase.from('appointment_services').insert(junctionEntries);
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
