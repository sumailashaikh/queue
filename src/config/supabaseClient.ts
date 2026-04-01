import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  Supabase credential(s) missing from .env file. Database connections will fail.');
}

export const supabase = createClient(
    supabaseUrl || '',
    supabaseKey || ''
);

// Admin client for bypassing RLS in safe backend operations
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const adminSupabase = serviceRoleKey ? createClient(supabaseUrl || '', serviceRoleKey) : supabase;
