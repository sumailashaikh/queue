import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const getProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                status: 'error',
                message: 'Profile not found'
            });
        }

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

export const updateProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { full_name, role } = req.body;

        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const updates: any = {};
        if (full_name !== undefined) updates.full_name = full_name;
        if (role !== undefined) updates.role = role;
        if (req.body.phone !== undefined) updates.phone = req.body.phone;

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Profile updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};

export const updateUiLanguage = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { ui_language } = req.body;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!ui_language) {
            return res.status(400).json({ status: 'error', message: 'ui_language is required' });
        }

        let { data, error } = await supabase
            .from('profiles')
            .update({ ui_language })
            .eq('id', userId)
            .select()
            .maybeSingle();

        if (error) throw error;

        // If no data, the profile doesn't exist yet, so we upsert it
        if (!data) {
            const { createClient } = require('@supabase/supabase-js');
            const supabaseAdmin = createClient(
                process.env.SUPABASE_URL || '',
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
            );

            const { data: upsertData, error: upsertError } = await supabaseAdmin
                .from('profiles')
                .upsert({ id: userId, ui_language })
                .select()
                .maybeSingle();

            if (upsertError) throw upsertError;
            data = upsertData;
        }

        res.status(200).json({
            status: 'success',
            message: 'UI language updated successfully',
            data
        });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
};
