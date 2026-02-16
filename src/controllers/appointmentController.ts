import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';

export const createAppointment = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id, service_id, start_time, end_time } = req.body;
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

        // TODO: Check for double booking here (future enhancement)

        const { data, error } = await supabase
            .from('appointments')
            .insert([
                {
                    user_id: userId,
                    business_id,
                    service_id,
                    start_time,
                    end_time: end_time || new Date(new Date(start_time).getTime() + 30 * 60000).toISOString(),
                    status: 'pending'
                }
            ])
            .select()
            .single();

        if (error) throw error;

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
                services (name, duration_minutes)
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
                services (name, duration_minutes)
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
        const { status } = req.body; // 'confirmed', 'completed', 'cancelled'
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!['scheduled', 'confirmed', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        // Verify ownership (RLS should handle it, but explicit check is good)
        // We need to check if the appointment belongs to a business owned by the user.

        const { data: appointment } = await supabase
            .from('appointments')
            .select('business_id')
            .eq('id', id)
            .single();

        if (!appointment) {
            return res.status(404).json({ status: 'error', message: 'Appointment not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('owner_id')
            .eq('id', appointment.business_id)
            .single();

        if (!business || business.owner_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized to update this appointment' });
        }

        const { data, error } = await supabase
            .from('appointments')
            .update({ status })
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Appointment not found or update not allowed'
            });
        }

        const appt = data[0];

        // Send Notification
        // In real app, we'd fetch user's phone.
        const recipient = `User-${appt.user_id}`;

        if (status === 'confirmed') {
            await notificationService.sendSMS(recipient, `Your appointment has been confirmed!`);
        } else if (status === 'cancelled') {
            await notificationService.sendSMS(recipient, `Your appointment has been cancelled.`);
        }

        res.status(200).json({
            status: 'success',
            message: 'Appointment status updated',
            data: appt
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
