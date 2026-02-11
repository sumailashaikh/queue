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
