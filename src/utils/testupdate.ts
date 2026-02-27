import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function testUpdate() {
    console.log("Fetching businesses...");
    const { data: b, error } = await supabase.from('businesses').select('*').limit(1);
    if (!b || b.length === 0) return console.log("No business found");

    // Test update using admin/service role but I don't have it here. Let's see if anon key rejects it 
    // Wait, anon key rejects updates if no RLS token is passed.
    // I need a signed JWT passing as global headers!
    const jwt = require('jsonwebtoken');
    const ownerId = b[0].owner_id;
    const token = jwt.sign({ sub: ownerId, id: ownerId, aud: 'authenticated', role: 'authenticated' }, process.env.SUPABASE_JWT_SECRET || 'your-super-secret-jwt-token-with-at-least-32-characters-long', { expiresIn: '1h' });

    const authSupabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    });

    console.log("Updating business with user token...");

    const { data: updated, error: updateError } = await authSupabase.from('businesses')
        .update({ language: 'hi', currency: 'INR', timezone: 'Asia/Kolkata' })
        .eq('id', b[0].id)
        .select('*');

    if (updateError) {
        console.error("Update error:", updateError);
    } else {
        console.log("Updated result:", JSON.stringify(updated, null, 2));
    }
}

testUpdate();
