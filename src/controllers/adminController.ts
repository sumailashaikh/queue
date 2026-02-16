import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

/**
 * Get all users registered on the platform
 */
export const getAllUsers = async (req: Request, res: Response) => {
    try {
        const { search, role, page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        let query = supabase
            .from('profiles')
            .select('*', { count: 'exact' });

        if (search) {
            query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
        }

        if (role) {
            query = query.eq('role', role);
        }

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + Number(limit) - 1);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data,
            pagination: {
                total: count,
                page: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Update a user's role (admin, owner, customer)
 */
export const updateUserRole = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!['admin', 'owner', 'customer'].includes(role)) {
            return res.status(400).json({ status: 'error', message: 'Invalid role' });
        }

        const { data, error } = await supabase
            .from('profiles')
            .update({ role })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'User role updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Get all businesses registered on the platform
 */
export const getAllBusinesses = async (req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('businesses')
            .select(`
                *,
                owner:profiles!owner_id (full_name, phone)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
