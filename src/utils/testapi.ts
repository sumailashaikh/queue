import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);

async function testApi() {
    try {
        console.log("Fetching first business...");
        const { data: b, error } = await supabase.from('businesses').select('*').limit(1);
        if (!b || b.length === 0) return console.log("No business found");

        const business = b[0];
        console.log("Business ID:", business.id);

        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ sub: business.owner_id, id: business.owner_id, aud: 'authenticated', role: 'authenticated' }, process.env.SUPABASE_JWT_SECRET || 'your-super-secret-jwt-token-with-at-least-32-characters-long', { expiresIn: '1h' });

        console.log("Calling API...");
        const res = await axios.put(`http://127.0.0.1:4000/api/businesses/${business.id}`, {
            language: 'hi',
            currency: 'INR',
            timezone: 'Asia/Kolkata',
            name: business.name + " Test"
        }, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        console.log("API Success:", res.data);
    } catch (e: any) {
        console.error("API Error:", e.response ? e.response.data : e.message);
    }
}

testApi();
