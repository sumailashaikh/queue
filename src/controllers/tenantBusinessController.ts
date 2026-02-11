import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { Business } from '../types';

export const createBusiness = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { name, slug, address, phone } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        if (!name || !slug) {
            return res.status(400).json({
                status: 'error',
                message: 'Name and slug are required'
            });
        }

        // Check availability of slug
        const { data: existingSlug } = await supabase
            .from('businesses')
            .select('slug')
            .eq('slug', slug)
            .single();

        if (existingSlug) {
            return res.status(400).json({
                status: 'error',
                message: 'Business URL slug is already taken'
            });
        }

        const newBusiness: Partial<Business> = {
            owner_id: userId,
            name,
            slug,
            address,
            phone
        };

        const { data, error } = await supabase
            .from('businesses')
            .insert(newBusiness)
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'Business created successfully',
            data
        });

    } catch (error: any) {
        if (error.code === '23505') { // Postgres unique_violation
            return res.status(400).json({
                status: 'error',
                message: 'Business with this slug already exists'
            });
        }

        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const getMyBusinesses = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const { data, error } = await supabase
            .from('businesses')
            .select('*')
            .eq('owner_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const updateBusiness = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, address, phone } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // RLS policy "Owners can update their own business" will handle ownership check implicitly
        // But verifying existence first is good UX

        const { data, error } = await supabase
            .from('businesses')
            .update({ name, address, phone })
            .eq('id', id)
            .eq('owner_id', userId) // Extra safety
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                status: 'error',
                message: 'Business not found or you do not have permission to update it'
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Business updated successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const deleteBusiness = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // RLS policy for delete might not exist yet, we need to check/add it.
        // Assuming we add it, or we rely on this query:

        const { error } = await supabase
            .from('businesses')
            .delete()
            .eq('id', id)
            .eq('owner_id', userId);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Business deleted successfully'
        });

    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};
