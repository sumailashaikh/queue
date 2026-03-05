const { supabase } = require('./src/config/supabaseClient');
const { isBusinessOpen, canCompleteBeforeClosing, getISTMinutes, parseTimeToMinutes } = require('./src/utils/timeUtils');

async function diagnose() {
    const slug = 'rahuls-salon';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // 1. Get business
    const { data: business } = await supabase
        .from('businesses')
        .select('*')
        .eq('slug', slug)
        .single();

    if (!business) {
        console.log('Business not found');
        return;
    }

    console.log('Business:', {
        name: business.name,
        open: business.open_time,
        close: business.close_time,
        is_closed: business.is_closed
    });

    const { isOpen, message } = isBusinessOpen(business);
    console.log('Is Open:', isOpen, message || '');

    // 2. Get Queue
    const { data: queues } = await supabase
        .from('queues')
        .select('*')
        .eq('business_id', business.id);

    for (const queue of queues) {
        console.log('\nQueue:', queue.name, 'id:', queue.id);

        // 3. Get entries
        const { data: entries } = await supabase
            .from('queue_entries')
            .select('total_duration_minutes, status, customer_name')
            .eq('queue_id', queue.id)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving']);

        console.log('Active Entries:', entries.length);
        let totalMins = 0;
        entries.forEach(e => {
            console.log(`- ${e.customer_name}: ${e.total_duration_minutes}m (${e.status})`);
            totalMins += (e.total_duration_minutes || 10);
        });

        // 4. Get providers
        const { count: activeProviders } = await supabase
            .from('service_providers')
            .select('*', { count: 'exact', head: true })
            .eq('business_id', business.id)
            .eq('is_active', true);

        const providerCount = Math.max(1, activeProviders || 1);
        const currentWaitTime = Math.round(totalMins / providerCount);

        console.log('Total Duration Mins:', totalMins);
        console.log('Active Providers:', providerCount);
        console.log('Calculated Wait Time:', currentWaitTime);

        // 5. Test joining with a 30m service
        const testServiceDuration = 30;
        const result = canCompleteBeforeClosing(business, currentWaitTime, testServiceDuration);
        console.log('Can Join (30m service):', result);
    }
}

diagnose();
