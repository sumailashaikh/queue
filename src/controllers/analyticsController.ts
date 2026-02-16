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
        const { data: entries, error: entriesError } = await supabase
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

        if (entriesError) throw entriesError;

        // 3. Calculate Stats
        let totalCustomers = entries?.length || 0;
        let completedVisits = 0;
        let totalRevenue = 0;
        let totalWaitTime = 0;
        let waitTimeCount = 0;

        entries?.forEach((entry: any) => {
            if (entry.status === 'completed') {
                completedVisits++;
                totalRevenue += Number(entry.queues?.services?.price || 0);
            }

            // Wait time is difference between joined_at and served_at
            if (entry.joined_at && entry.served_at) {
                const joined = new Date(entry.joined_at).getTime();
                const served = new Date(entry.served_at).getTime();
                const waitMin = Math.max(0, (served - joined) / (1000 * 60));
                totalWaitTime += waitMin;
                waitTimeCount++;
            }
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
