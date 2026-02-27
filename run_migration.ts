import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Use service key to bypass RLS

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    try {
        const sql = fs.readFileSync('34_add_service_translations.sql', 'utf8');

        // Supabase REST API does not support arbitrary SQL execution directly without an RPC function.
        // But let's check if the project has the 'exec_sql' RPC function we created earlier?
        // Let's try to ping the postgrest API or try to use an existing exec_sql function.
        const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            console.error('Migration failed (RPC exec_sql might not exist).', error.message);
            // Alternative: The user might be expecting me to give them the SQL file to run on their Supabase dashboard manually.
        } else {
            console.log('Migration executed successfully!');
        }
    } catch (e) {
        console.error("Migration script error:", e);
    }
}

runMigration();
