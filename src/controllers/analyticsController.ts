import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const getProviderAnalytics = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const businessId = req.query.business_id as string;
        const range = (req.query.range as string) || 'daily';

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!businessId) {
            return res.status(400).json({ status: 'error', message: 'business_id is required' });
        }

        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // Verify ownership and get timezone
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('id, timezone')
            .eq('id', businessId)
            .eq('owner_id', userId)
            .single();

        if (bizError || !business) {
            return res.status(403).json({ status: 'error', message: 'Forbidden' });
        }

        const timezone = business.timezone || 'UTC';
        const dateParam = (req.query.date as string) || new Date().toLocaleDateString('en-CA', { timeZone: timezone });

        // --- Calculate Time Boundaries ---
        let startISO: string, endISO: string;

        const parseLocal = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: timezone });

        if (range === 'weekly') {
            const date = new Date(dateParam);
            const day = date.getDay(); // 0 is Sunday, 1 is Monday
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            const mon = new Date(date.setDate(diff));
            const sun = new Date(new Date(mon).setDate(mon.getDate() + 6));

            startISO = `${parseLocal(mon)}T00:00:00.000`;
            endISO = `${parseLocal(sun)}T23:59:59.999`;
        } else if (range === 'monthly') {
            const date = new Date(dateParam);
            const y = date.getFullYear();
            const m = date.getMonth();
            const first = new Date(y, m, 1);
            const last = new Date(y, m + 1, 0);

            startISO = `${parseLocal(first)}T00:00:00.000`;
            endISO = `${parseLocal(last)}T23:59:59.999`;
        } else {
            // Daily
            startISO = `${dateParam}T00:00:00.000`;
            endISO = `${dateParam}T23:59:59.999`;
        }

        const startDate = startISO.slice(0, 10);
        const endDate = endISO.slice(0, 10);
        const toIsoNoZ = (dateStr: string, endOfDay = false) => `${dateStr}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`;
        const msInDay = 24 * 60 * 60 * 1000;
        const parseYmd = (value: string) => {
            const [y, m, d] = String(value).split('-').map(Number);
            return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
        };
        const fmtYmd = (d: Date) => d.toISOString().slice(0, 10);
        const addDaysYmd = (dateStr: string, days: number) => {
            const d = parseYmd(dateStr);
            d.setUTCDate(d.getUTCDate() + days);
            return fmtYmd(d);
        };
        const clampDateRange = (a: string, b: string) => {
            const start = parseYmd(a);
            const end = parseYmd(b);
            const min = parseYmd(startDate);
            const max = parseYmd(endDate);
            const clampedStart = start < min ? min : start;
            const clampedEnd = end > max ? max : end;
            if (clampedEnd < clampedStart) return null;
            return { clampedStart, clampedEnd };
        };

        // Providers baseline (show rows even if service count is zero in selected period)
        const { data: providers, error: providersError } = await supabase
            .from('service_providers')
            .select('id, name')
            .eq('business_id', businessId)
            .neq('is_active', false);
        if (providersError) throw providersError;

        const providerStats: Record<string, any> = {};
        (providers || []).forEach((p: any) => {
            providerStats[p.id] = {
                provider_id: p.id,
                provider_name: p.name || 'Unknown',
                services_completed: 0,
                total_revenue: 0,
                total_active_minutes: 0,
                total_working_minutes: 0,
                total_working_hours: 0,
                working_days: 0,
                leave_full_days: 0,
                leave_half_days: 0,
                leaves_taken: 0,
                leave_records: [] as any[],
                on_leave_today: false,
                upcoming_leave_count: 0,
                past_leave_count: 0,
                service_breakdown: {},
                daily_work_log: [] as any[],
                task_active_dates: new Set<string>()
            };
        });

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
                    total_working_minutes: 0,
                    total_working_hours: 0,
                    working_days: 0,
                    leave_full_days: 0,
                    leave_half_days: 0,
                    leaves_taken: 0,
                    leave_records: [] as any[],
                    on_leave_today: false,
                    upcoming_leave_count: 0,
                    past_leave_count: 0,
                    service_breakdown: {},
                    daily_work_log: [] as any[],
                    task_active_dates: new Set<string>()
                };
            }

            const stats = providerStats[pId];
            stats.services_completed++;
            stats.total_revenue += (t.price || 0);
            stats.total_active_minutes += duration;
            if (t.completed_at) {
                const taskDate = String(t.completed_at).slice(0, 10);
                stats.task_active_dates.add(taskDate);
            }

            // Breakdown for modal
            const sName = t.services?.name || 'Unnamed Service';
            if (!stats.service_breakdown[sName]) {
                stats.service_breakdown[sName] = { count: 0, revenue: 0, total_duration: 0 };
            }
            stats.service_breakdown[sName].count++;
            stats.service_breakdown[sName].revenue += (t.price || 0);
            stats.service_breakdown[sName].total_duration += duration;
        });

        // --- Attendance data (work logs) ---
        const { data: attendanceRows, error: attendanceError } = await supabase
            .from('provider_attendance')
            .select('provider_id, attendance_date, clock_in_time, clock_out_time')
            .eq('business_id', businessId)
            .gte('attendance_date', startDate)
            .lte('attendance_date', endDate);
        if (attendanceError) throw attendanceError;

        const attendanceByProviderDate = new Map<string, { minutes: number; hasRow: boolean }>();
        (attendanceRows || []).forEach((r: any) => {
            const dateKey = String(r.attendance_date || '');
            if (!dateKey) return;
            const key = `${r.provider_id}__${dateKey}`;
            let minutes = 0;
            if (r.clock_in_time && r.clock_out_time) {
                minutes = Math.max(0, (new Date(r.clock_out_time).getTime() - new Date(r.clock_in_time).getTime()) / (1000 * 60));
            }
            attendanceByProviderDate.set(key, { minutes, hasRow: true });
            if (providerStats[r.provider_id]) {
                providerStats[r.provider_id].total_working_minutes += minutes;
            }
        });

        // --- Leaves data (approved only) ---
        let leaveRows: any[] = [];
        const leavesBase = await supabase
            .from('provider_leaves')
            .select('provider_id, start_date, end_date, leave_kind, status')
            .eq('business_id', businessId)
            .lte('start_date', endDate)
            .gte('end_date', startDate)
            .eq('status', 'APPROVED');
        if (leavesBase.error) {
            const msg = String((leavesBase.error as any)?.message || '').toLowerCase();
            if (msg.includes('status') && msg.includes('column')) {
                const fallbackLeaves = await supabase
                    .from('provider_leaves')
                    .select('provider_id, start_date, end_date, leave_kind')
                    .eq('business_id', businessId)
                    .lte('start_date', endDate)
                    .gte('end_date', startDate);
                if (fallbackLeaves.error) throw fallbackLeaves.error;
                leaveRows = fallbackLeaves.data || [];
            } else {
                throw leavesBase.error;
            }
        } else {
            leaveRows = leavesBase.data || [];
        }

        const leaveByProviderDate = new Map<string, 'full' | 'half'>();
        (leaveRows || []).forEach((lv: any) => {
            if (!lv?.provider_id || !lv?.start_date || !lv?.end_date) return;
            const clamped = clampDateRange(String(lv.start_date).slice(0, 10), String(lv.end_date).slice(0, 10));
            if (!clamped) return;
            const leaveKind = String(lv.leave_kind || '').toUpperCase();
            const leaveType: 'full' | 'half' = (leaveKind === 'HALF_DAY' || leaveKind === 'EMERGENCY') ? 'half' : 'full';
            for (let d = clamped.clampedStart.getTime(); d <= clamped.clampedEnd.getTime(); d += msInDay) {
                const dateKey = fmtYmd(new Date(d));
                const key = `${lv.provider_id}__${dateKey}`;
                const prev = leaveByProviderDate.get(key);
                if (!prev || prev === 'half') leaveByProviderDate.set(key, leaveType);
            }
        });

        // --- Leave tracker data for employee cards (today/upcoming/past) ---
        const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        const leaveWindowStart = addDaysYmd(todayDate, -180);
        const leaveWindowEnd = addDaysYmd(todayDate, 180);

        let leaveTrackerRows: any[] = [];
        const leaveTrackerBase = await supabase
            .from('provider_leaves')
            .select('provider_id, start_date, end_date, leave_kind, status')
            .eq('business_id', businessId)
            .lte('start_date', leaveWindowEnd)
            .gte('end_date', leaveWindowStart)
            .order('start_date', { ascending: false });

        if (leaveTrackerBase.error) {
            const msg = String((leaveTrackerBase.error as any)?.message || '').toLowerCase();
            if (msg.includes('status') && msg.includes('column')) {
                const fallbackLeaveTracker = await supabase
                    .from('provider_leaves')
                    .select('provider_id, start_date, end_date, leave_kind')
                    .eq('business_id', businessId)
                    .lte('start_date', leaveWindowEnd)
                    .gte('end_date', leaveWindowStart)
                    .order('start_date', { ascending: false });
                if (fallbackLeaveTracker.error) throw fallbackLeaveTracker.error;
                leaveTrackerRows = (fallbackLeaveTracker.data || []).map((row: any) => ({ ...row, status: 'APPROVED' }));
            } else {
                throw leaveTrackerBase.error;
            }
        } else {
            leaveTrackerRows = leaveTrackerBase.data || [];
        }

        (leaveTrackerRows || []).forEach((lv: any) => {
            const providerId = String(lv?.provider_id || '');
            if (!providerId || !providerStats[providerId]) return;

            const startDateKey = String(lv?.start_date || '').slice(0, 10);
            const endDateKey = String(lv?.end_date || '').slice(0, 10);
            if (!startDateKey || !endDateKey) return;

            const leaveKind = String(lv?.leave_kind || '').toUpperCase();
            const type = leaveKind === 'EMERGENCY'
                ? 'emergency'
                : leaveKind === 'HALF_DAY'
                    ? 'half'
                    : 'full';

            const statusRaw = String(lv?.status || 'APPROVED').toUpperCase();
            const status = statusRaw === 'PENDING'
                ? 'pending'
                : statusRaw === 'REJECTED'
                    ? 'rejected'
                    : 'approved';

            const p = providerStats[providerId];
            p.leave_records.push({
                type,
                startDate: startDateKey,
                endDate: endDateKey,
                status
            });

            if (status !== 'approved') return;
            if (startDateKey <= todayDate && endDateKey >= todayDate) p.on_leave_today = true;
            else if (startDateKey > todayDate) p.upcoming_leave_count += 1;
            else if (endDateKey < todayDate) p.past_leave_count += 1;
        });

        // --- Build daily work logs + leave/day counters ---
        Object.values(providerStats).forEach((p: any) => {
            const dates = new Set<string>();
            for (const key of attendanceByProviderDate.keys()) {
                if (key.startsWith(`${p.provider_id}__`)) dates.add(key.split('__')[1]);
            }
            for (const key of leaveByProviderDate.keys()) {
                if (key.startsWith(`${p.provider_id}__`)) dates.add(key.split('__')[1]);
            }

            const logs: any[] = [];
            let workingDays = 0;
            let leaveFullDays = 0;
            let leaveHalfDays = 0;

            Array.from(dates)
                .sort((a, b) => b.localeCompare(a))
                .forEach((dateKey) => {
                    const att = attendanceByProviderDate.get(`${p.provider_id}__${dateKey}`);
                    const leave = leaveByProviderDate.get(`${p.provider_id}__${dateKey}`);
                    const workedMinutes = Math.round(att?.minutes || 0);
                    const hasAttendance = !!att?.hasRow;

                    let status = '';
                    let status_code = '';
                    let isWorkingDay = false;
                    let isHalfLeave = false;
                    let isFullLeave = false;

                    if (leave && workedMinutes > 0) {
                        status = 'Half Day';
                        status_code = 'half_day';
                        isWorkingDay = true;
                        isHalfLeave = true;
                    } else if (leave === 'full') {
                        status = 'Leave (Full)';
                        status_code = 'leave_full';
                        isFullLeave = true;
                    } else if (leave === 'half') {
                        status = 'Leave (Half)';
                        status_code = 'leave_half';
                        isHalfLeave = true;
                    } else if (workedMinutes > 0 && workedMinutes < 240) {
                        status = 'Half Day';
                        status_code = 'half_day';
                        isWorkingDay = true;
                    } else if (workedMinutes > 0 || hasAttendance) {
                        status = 'Present';
                        status_code = 'present';
                        isWorkingDay = true;
                    }

                    if (!status) return;
                    if (isWorkingDay) workingDays += 1;
                    if (isFullLeave) leaveFullDays += 1;
                    if (isHalfLeave) leaveHalfDays += 1;

                    logs.push({
                        date: dateKey,
                        hours_worked: Math.round((workedMinutes / 60) * 100) / 100,
                        status,
                        status_code
                    });
                });

            p.working_days = workingDays;
            p.leave_full_days = leaveFullDays;
            p.leave_half_days = leaveHalfDays;
            p.leaves_taken = leaveFullDays + leaveHalfDays;
            if ((p.total_working_minutes || 0) <= 0 && (p.total_active_minutes || 0) > 0) {
                p.total_working_minutes = Math.round(p.total_active_minutes);
            }
            if ((p.working_days || 0) <= 0) {
                const fallbackWorkingDays = p.task_active_dates instanceof Set ? p.task_active_dates.size : 0;
                p.working_days = fallbackWorkingDays;
            }
            p.total_working_hours = Math.round(((p.total_working_minutes || 0) / 60) * 100) / 100;
            p.daily_work_log = logs;
        });

        // --- Finalize array and calculate averages ---
        const result = Object.values(providerStats).map((p: any) => {
            return {
                ...p,
                avg_service_time_minutes: p.services_completed > 0 ? Math.round(p.total_active_minutes / p.services_completed) : 0,
                task_active_dates: undefined,
                service_breakdown: Object.entries(p.service_breakdown).map(([name, data]: [string, any]) => ({
                    service_name: name,
                    count: data.count,
                    revenue: data.revenue,
                    avg_time: data.count > 0 ? Math.round(data.total_duration / data.count) : 0
                }))
            };
        }).sort((a: any, b: any) => b.total_revenue - a.total_revenue);

        // --- Calculation Summaries ---
        const totalServicesAll = result.reduce((sum, p) => sum + p.services_completed, 0);
        const summary = {
            total_revenue: result.reduce((sum, p) => sum + p.total_revenue, 0),
            total_services: totalServicesAll,
            avg_service_time: totalServicesAll > 0
                ? Math.round(result.reduce((sum, p) => sum + p.total_active_minutes, 0) / totalServicesAll)
                : 0,
            total_working_hours: Math.round((result.reduce((sum, p) => sum + (p.total_working_hours || 0), 0)) * 100) / 100,
            working_days: result.reduce((sum, p) => sum + (p.working_days || 0), 0),
            leaves_taken: result.reduce((sum, p) => sum + (p.leaves_taken || 0), 0)
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
            .select('id, timezone')
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

        // Get current date string (Business Time)
        const timezone = businesses[0]?.timezone || 'UTC';
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

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
