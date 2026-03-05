const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function formatTime12(timeStr) {
    if (!timeStr) return "";
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]);
    const minutes = parts[1] || "00";
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}

function getISTMinutes() {
    const now = new Date();
    const istTimeStr = now.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    const [h, m] = istTimeStr.split(':').map(Number);
    return (h * 60) + m;
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
}

async function diagnose() {
    const slug = 'rahuls-salon';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    console.log('Today IST:', todayStr);
    console.log('Current IST Mins:', getISTMinutes());

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
        close: business.close_time
    });

    const { data: queues } = await supabase
        .from('queues')
        .select('*')
        .eq('business_id', business.id);

    for (const queue of queues) {
        const { data: entries } = await supabase
            .from('queue_entries')
            .select('total_duration_minutes, status, customer_name')
            .eq('queue_id', queue.id)
            .eq('entry_date', todayStr)
            .in('status', ['waiting', 'serving']);

        let totalMins = 0;
        entries.forEach(e => {
            totalMins += (e.total_duration_minutes || 10);
        });

        const { count: activeProviders } = await supabase
            .from('service_providers')
            .select('*', { count: 'exact', head: true })
            .eq('business_id', business.id)
            .eq('is_active', true);

        const providerCount = Math.max(1, activeProviders || 1);
        const currentWaitTime = Math.round(totalMins / providerCount);

        console.log(`Queue ${queue.name}: Wait ${currentWaitTime}m, Entries ${entries.length}, Providers ${providerCount}`);

        const nowMins = getISTMinutes();
        const closeMins = parseTimeToMinutes(business.close_time);
        const serviceMins = 30;
        const bufferMins = 10;
        const estEndMins = nowMins + currentWaitTime + serviceMins;
        const limitMins = closeMins - bufferMins;

        console.log(`Est End: ${estEndMins} vs Limit: ${limitMins}`);
        if (estEndMins > limitMins) {
            console.log('REJECTED: End time after limit');
        } else {
            console.log('ACCEPTED: Within hours');
        }
    }
}

diagnose();
