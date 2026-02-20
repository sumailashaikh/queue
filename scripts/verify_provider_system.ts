import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_URL = `http://localhost:${process.env.PORT || 4000}/api`;

async function verify() {
    console.log('--- VERIFYING SERVICE PROVIDER SYSTEM ---');

    const token = process.argv[2];
    if (!token) {
        console.log('Usage: npx ts-node scripts/verify_provider_system.ts <AUTH_TOKEN>');
        return;
    }

    try {
        // 1. Get first business and its service
        const { data: business } = await supabase.from('businesses').select('id').limit(1).single();
        if (!business) throw new Error('No business found in DB');
        console.log('Using Business ID:', business.id);

        const { data: service } = await supabase.from('services').select('id, name').eq('business_id', business.id).limit(1).single();
        if (!service) throw new Error('No service found for business');
        console.log('Using Service:', service.name, '(', service.id, ')');

        const { data: queue } = await supabase.from('queues').select('id').eq('business_id', business.id).limit(1).single();
        if (!queue) throw new Error('No queue found for business');

        // 2. Create Service Provider via API
        console.log('\nStep 2: Creating Service Provider...');
        const providerData = {
            business_id: business.id,
            name: 'Test Expert',
            role: 'Senior Stylist',
            phone: '9999999999'
        };
        const pResponse = await axios.post(`${BASE_URL}/service-providers`, providerData, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const provider = pResponse.data.data;
        console.log('✅ Provider Created:', provider.name, '(', provider.id, ')');

        // 3. Assign Service via API
        console.log('\nStep 3: Assigning Service to Provider...');
        await axios.post(`${BASE_URL}/service-providers/${provider.id}/services`,
            { service_ids: [service.id] },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        console.log('✅ Service Assigned');

        // 4. Join Queue
        console.log('\nStep 4: Joining Queue...');
        const joinData = {
            queue_id: queue.id,
            customer_name: 'Verification Guest',
            service_ids: [service.id]
        };
        const jResponse = await axios.post(`${BASE_URL}/public/queue/join`, joinData);
        const entry = jResponse.data.data;
        console.log('✅ Joined Queue. Entry ID:', entry.id);

        // 5. Update status to 'serving'
        console.log('\nStep 5: Updating status to serving (Triggering Auto-Assignment)...');
        const uResponse = await axios.patch(`${BASE_URL}/service-providers/../queues/entries/${entry.id}/status`,
            { status: 'serving' },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const updatedEntry = uResponse.data.data;
        console.log('✅ Status Updated to:', updatedEntry.status);

        if (updatedEntry.assigned_provider_id === provider.id) {
            console.log('\n🎉 VERIFICATION SUCCESSFUL: Provider correctly assigned!');
            console.log('Assigned Provider ID:', updatedEntry.assigned_provider_id);
            console.log('Provider Name (Joined):', updatedEntry.service_providers?.name);
        } else {
            console.error('\n❌ VERIFICATION FAILED: Provider not assigned or incorrect assignment.');
            console.log('Expected:', provider.id);
            console.log('Got:', updatedEntry.assigned_provider_id);
        }

    } catch (error: any) {
        console.error('\n❌ ERROR DURING VERIFICATION:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

verify();
