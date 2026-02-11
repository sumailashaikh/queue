import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const createService = async (req: Request, res: Response) => {
    try {
        const { name, description, duration_minutes, price, business_id } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!name || !duration_minutes) {
            return res.status(400).json({ status: 'error', message: 'Name and duration are required' });
        }

        let businessIdToUse = business_id;

        // If business_id is not provided, try to find *one* business owned by the user
        // But if they have multiple, this is risky. Better to require it or pick the first one.
        if (!businessIdToUse) {
            const { data: businesses, error: businessError } = await supabase
                .from('businesses')
                .select('id')
                .eq('owner_id', userId);

            if (businessError || !businesses || businesses.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Business not found' });
            }
            // Pick the first one if multiple
            businessIdToUse = businesses[0].id;
        } else {
            // Verify ownership of the provided business_id
            const { data: business, error: businessError } = await supabase
                .from('businesses')
                .select('id')
                .eq('id', businessIdToUse)
                .eq('owner_id', userId)
                .single();

            if (businessError || !business) {
                return res.status(403).json({ status: 'error', message: 'Business not found or unauthorized' });
            }
        }

        const { data, error } = await supabase
            .from('services')
            .insert([
                {
                    business_id: businessIdToUse,
                    name,
                    description,
                    duration_minutes,
                    price: price || 0
                }
            ])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'Service created successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getServices = async (req: Request, res: Response) => {
    try {
        const { businessId } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data, error } = await supabase
            .from('services')
            .select('*')
            .eq('business_id', businessId)
            .order('name', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getMyServices = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // Get all businesses owned by this user
        const { data: businesses, error: businessError } = await supabase
            .from('businesses')
            .select('id')
            .eq('owner_id', userId);

        if (businessError) throw businessError;

        if (!businesses || businesses.length === 0) {
            return res.status(200).json({ status: 'success', data: [] });
        }

        const businessIds = businesses.map((b: any) => b.id);

        const { data, error } = await supabase
            .from('services')
            .select('*')
            .in('business_id', businessIds)
            .order('name', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const deleteService = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // RLS should handle "Owners can delete their own services" logic
        // But we need to ensure we don't just rely on ID if RLS isn't perfect
        // For now, assume RLS works or add explicit check.
        // Let's rely on RLS + business check implicitly via the delete policy if it existed.
        // Actually, init_db.sql didn't have specific Service RLS for DELETE.
        // Let's add verification.

        const { data: service } = await supabase.from('services').select('business_id').eq('id', id).single();
        if (service) {
            const { data: business } = await supabase.from('businesses').select('owner_id').eq('id', service.business_id).single();
            if (business && business.owner_id !== userId) {
                return res.status(403).json({ status: 'error', message: 'Unauthorized to delete this service' });
            }
        }

        const { error } = await supabase
            .from('services')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Service deleted successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
