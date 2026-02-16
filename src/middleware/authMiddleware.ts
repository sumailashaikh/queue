import { Response, NextFunction } from 'express';
import { supabase } from '../config/supabaseClient';

// Extend Express Request interface to include user
declare global {
    namespace Express {
        interface Request {
            user?: any;
            supabase?: any;
        }
    }
}

export const requireAuth = async (req: any, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ error: 'Authorization header missing' });
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Bearer token missing' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Attach user to request object
        req.user = user;
        console.log(`[AUTH] Authenticated user: ${user.id}`);

        // Create an authenticated Supabase client for this request
        // This is CRITICAL for RLS to work properly
        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_ANON_KEY!;

        req.supabase = require('@supabase/supabase-js').createClient(supabaseUrl, supabaseKey, {
            global: {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        });

        next();
    } catch (err) {
        console.error('Auth Middleware Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
export const requireAdmin = async (req: any, res: Response, next: NextFunction) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Fetch user profile to check role
        // IMPORTANT: Use req.supabase (authenticated) instead of global supabase
        // to ensure RLS allows reading the user's own profile.
        const { data: profile, error } = await req.supabase
            .from('profiles')
            .select('role')
            .eq('id', req.user.id)
            .single();

        if (error || !profile || profile.role !== 'admin') {
            console.log(`[AUTH] Admin access denied for user ${req.user.id}. Role: ${profile?.role}`);
            return res.status(403).json({ error: 'Admin access required' });
        }

        next();
    } catch (err) {
        console.error('Admin Middleware Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
