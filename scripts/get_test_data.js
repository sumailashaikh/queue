const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function getTestData() {
    console.log('Fetching test data...');
    const { data: business } = await supabase.from('businesses').select('id, slug').limit(1).single();
    const { data: queue } = await supabase.from('queues').select('id').eq('business_id', business.id).eq('status', 'open').limit(1).single();
    const { data: service } = await supabase.from('services').select('id').eq('business_id', business.id).limit(1).single();

    console.log(JSON.stringify({
        business_id: business.id,
        business_slug: business.slug,
        queue_id: queue?.id,
        service_id: service?.id
    }, null, 2));
}

getTestData();
