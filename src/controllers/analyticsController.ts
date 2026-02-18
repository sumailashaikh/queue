import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const getDailySummary = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get businesses owned by this user
        const { data: businesses, error: businessError } = await supabase
            .from('businesses')
            .select('id')
            .eq('owner_id', userId);

        if (businessError) throw businessError;

        if (!businesses || businesses.length === 0) {
            return res.status(200).json({
                status: 'success',
                data: {
                    totalCustomers: 0,
                    completedVisits: 0,
                    totalRevenue: 0,
                    avgWaitTimeMinutes: 0
                }
            });
        }

        const businessIds = businesses.map((b: any) => b.id);

        // Get current date string (India Time)
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        // 2. Fetch all entries for today across all queues of these businesses
        const { data: qEntries, error: qError } = await supabase
            .from('queue_entries')
            .select(`
                id,
                status,
                joined_at,
                served_at,
                completed_at,
                queues!inner (
                    business_id,
                    services (price)
                )
            `)
            .in('queues.business_id', businessIds)
            .eq('entry_date', todayStr);

        if (qError) throw qError;

        // 3. Fetch all appointments for today for these businesses
        const { data: appointments, error: aError } = await supabase
            .from('appointments')
            .select(`
                id,
                status,
                services (price)
            `)
            .in('business_id', businessIds)
            .gte('start_time', `${todayStr}T00:00:00`)
            .lte('start_time', `${todayStr}T23:59:59`);

        if (aError) throw aError;

        // 4. Calculate Aggregate Stats
        let completedVisits = 0;
        let totalRevenue = 0;
        let totalCustomers = (qEntries?.length || 0) + (appointments?.length || 0);

        // Stats from Queues
        qEntries?.forEach((entry: any) => {
            if (entry.status === 'completed') {
                completedVisits++;
                totalRevenue += Number(entry.queues?.services?.price || 0);
            }
        });

        // Stats from Appointments
        appointments?.forEach((appt: any) => {
            if (appt.status === 'completed') {
                completedVisits++;
                totalRevenue += Number(appt.services?.price || 0);
            }
        });

        // Wait time remains queue-centric
        let totalWaitTime = 0;
        let waitTimeCount = 0;
        const { data: waitStats } = await supabase
            .from('queue_entries')
            .select('joined_at, served_at')
            .in('queues.business_id', businessIds)
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
                avgWaitTimeMinutes
            }
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
