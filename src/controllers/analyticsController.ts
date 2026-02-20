import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const getProviderAnalytics = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const businessId = req.query.business_id as string;
        const range = (req.query.range as string) || 'daily';
        const dateParam = (req.query.date as string) || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!businessId) {
            return res.status(400).json({ status: 'error', message: 'business_id is required' });
        }

        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // Verify ownership
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', businessId)
            .eq('owner_id', userId)
            .single();

        if (bizError || !business) {
            return res.status(403).json({ status: 'error', message: 'Forbidden' });
        }

        // --- Calculate Time Boundaries (Asia/Kolkata) ---
        // dateParam is "YYYY-MM-DD"
        let startISO: string, endISO: string;

        const parseIST = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (range === 'weekly') {
            const date = new Date(dateParam);
            const day = date.getDay(); // 0 is Sunday, 1 is Monday
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            const mon = new Date(date.setDate(diff));
            const sun = new Date(new Date(mon).setDate(mon.getDate() + 6));

            startISO = `${parseIST(mon)}T00:00:00.000+05:30`;
            endISO = `${parseIST(sun)}T23:59:59.999+05:30`;
        } else if (range === 'monthly') {
            const date = new Date(dateParam);
            const y = date.getFullYear();
            const m = date.getMonth();
            const first = new Date(y, m, 1);
            const last = new Date(y, m + 1, 0);

            startISO = `${parseIST(first)}T00:00:00.000+05:30`;
            endISO = `${parseIST(last)}T23:59:59.999+05:30`;
        } else {
            // Daily
            startISO = `${dateParam}T00:00:00.000+05:30`;
            endISO = `${dateParam}T23:59:59.999+05:30`;
        }

        // --- Fetch Completed Tasks ---
        const { data: tasks, error: tasksError } = await supabase
            .from('queue_entry_services')
            .select(`
                id,
                price,
                started_at,
                completed_at,
                service_id,
                assigned_provider_id,
                services!service_id (name),
                service_providers!assigned_provider_id (id, name),
                queue_entries!inner (
                    queues!inner (business_id)
                )
            `)
            .eq('queue_entries.queues.business_id', businessId)
            .eq('task_status', 'done')
            .not('assigned_provider_id', 'is', null)
            .not('completed_at', 'is', null)
            .gte('completed_at', startISO)
            .lte('completed_at', endISO);

        if (tasksError) throw tasksError;

        // --- Group by Provider ---
        const providerStats: Record<string, any> = {};

        tasks?.forEach((t: any) => {
            const pId = t.assigned_provider_id;
            const pName = t.service_providers?.name || 'Unknown';
            const durationArr = t.completed_at && t.started_at ?
                (new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()) / (1000 * 60) : 0;
            const duration = Math.max(0, durationArr);

            if (!providerStats[pId]) {
                providerStats[pId] = {
                    provider_id: pId,
                    provider_name: pName,
                    services_completed: 0,
                    total_revenue: 0,
                    total_active_minutes: 0,
                    service_breakdown: {}
                };
            }

            const stats = providerStats[pId];
            stats.services_completed++;
            stats.total_revenue += (t.price || 0);
            stats.total_active_minutes += duration;

            // Breakdown for modal
            const sName = t.services?.name || 'Unnamed Service';
            if (!stats.service_breakdown[sName]) {
                stats.service_breakdown[sName] = { count: 0, revenue: 0, total_duration: 0 };
            }
            stats.service_breakdown[sName].count++;
            stats.service_breakdown[sName].revenue += (t.price || 0);
            stats.service_breakdown[sName].total_duration += duration;
        });

        // --- Finalize array and calculate averages ---
        const result = Object.values(providerStats).map((p: any) => {
            return {
                ...p,
                avg_service_time_minutes: p.services_completed > 0 ? Math.round(p.total_active_minutes / p.services_completed) : 0,
                service_breakdown: Object.entries(p.service_breakdown).map(([name, data]: [string, any]) => ({
                    service_name: name,
                    count: data.count,
                    revenue: data.revenue,
                    avg_time: data.count > 0 ? Math.round(data.total_duration / data.count) : 0
                }))
            };
        });

        // --- Calculation Summaries ---
        const summary = {
            total_revenue: result.reduce((sum, p) => sum + p.total_revenue, 0),
            total_services: result.reduce((sum, p) => sum + p.services_completed, 0),
            avg_service_time: result.length > 0 ?
                Math.round(result.reduce((sum, p) => sum + p.total_active_minutes, 0) / result.reduce((sum, p) => sum + p.services_completed, 0) || 0) : 0
        };

        res.status(200).json({
            status: 'success',
            data: result,
            summary
        });

    } catch (error: any) {
        console.error('Provider Analytics Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

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
