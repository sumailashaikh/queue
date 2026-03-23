import { Response } from 'express';
import { supabase } from '../config/supabaseClient';

/**
 * Get public platform-wide statistics for the landing page
 */
export const getPublicPlatformStats = async (req: any, res: Response) => {
    try {
        const supabase = req.supabase;

        // 1. Total Users
        const { count: totalUsers } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        // 2. Total Businesses
        const { count: totalBusinesses } = await supabase
            .from('businesses')
            .select('*', { count: 'exact', head: true });

        res.status(200).json({
            status: 'success',
            data: {
                totalUsers: (totalUsers || 0) + 120, // Add base for social proof
                totalBusinesses: (totalBusinesses || 0) + 40
            }
        });
    } catch (error: any) {
        console.error('[PUBLIC] GetPlatformStats Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};
