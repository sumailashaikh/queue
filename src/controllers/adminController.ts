import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

/**
 * Get all users registered on the platform
 */
export const getAllUsers = async (req: any, res: Response) => {
    try {
        const { search, role, page = 1, limit = 20 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const supabase = req.supabase;

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
        console.error('[ADMIN] GetUsers Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Update a user's role (admin, owner, customer)
 */
export const updateUserRole = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        const supabase = req.supabase;

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
export const getAllBusinesses = async (req: any, res: Response) => {
    try {
        const supabase = req.supabase;
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

/**
 * Update a user's status (active, pending, blocked) and verification
 */
export const updateUserStatus = async (req: any, res: Response) => {
    try {
        const { id } = req.params;
        const { status, is_verified } = req.body;
        const supabase = req.supabase;

        const updates: any = {};
        if (status) updates.status = status;
        if (is_verified !== undefined) updates.is_verified = is_verified;

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'User status updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/**
 * Promote a user to Admin by phone number (Invite)
 */
export const inviteAdmin = async (req: any, res: Response) => {
    try {
        const { phone } = req.body;
        const supabase = req.supabase;

        if (!phone) {
            return res.status(400).json({ status: 'error', message: 'Phone number is required' });
        }

        // Check if user exists
        const { data: profile, error: findError } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('phone', phone)
            .single();

        if (findError || !profile) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found. Ask them to login once first, then you can promote them.'
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .update({ role: 'admin', status: 'active', is_verified: true })
            .eq('id', profile.id)
            .select()
            .single();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: `${profile.full_name} promoted to Admin successfully`,
            data
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
