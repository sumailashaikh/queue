/**
 * Count queue_entry_services rows that actually block deactivation:
 * assigned to this provider, not done/cancelled, on today's business calendar date,
 * and the parent queue entry is still waiting or serving.
 */
export async function countBlockingLiveQueueTasks(
    adminSupabase: any,
    providerId: string,
    businessId: string
): Promise<number> {
    const { data: biz } = await adminSupabase
        .from('businesses')
        .select('timezone')
        .eq('id', businessId)
        .maybeSingle();
    const tz = biz?.timezone || 'UTC';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const { count, error } = await adminSupabase
        .from('queue_entry_services')
        .select(
            `
            id,
            queue_entries!inner (
                status,
                entry_date,
                queues!inner ( business_id )
            )
        `,
            { count: 'exact', head: true }
        )
        .eq('assigned_provider_id', providerId)
        .in('task_status', ['pending', 'in_progress'])
        .eq('queue_entries.entry_date', todayStr)
        .in('queue_entries.status', ['waiting', 'serving'])
        .eq('queue_entries.queues.business_id', businessId);

    if (error) {
        console.warn('[liveQueueTaskCount] nested business filter failed, using date+status only:', error.message);
        const { count: loose } = await adminSupabase
            .from('queue_entry_services')
            .select(
                `
            id,
            queue_entries!inner (
                status,
                entry_date
            )
        `,
                { count: 'exact', head: true }
            )
            .eq('assigned_provider_id', providerId)
            .in('task_status', ['pending', 'in_progress'])
            .eq('queue_entries.entry_date', todayStr)
            .in('queue_entries.status', ['waiting', 'serving']);
        return loose || 0;
    }

    return count || 0;
}
