import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const sendOtp = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                status: 'error',
                message: 'Phone number is required'
            });
        }

        const { error } = await supabase.auth.signInWithOtp({
            phone
        });

        if (error) {
            console.error('Supabase OTP Error:', error);
            throw error;
        }

        res.status(200).json({
            status: 'success',
            message: 'OTP sent successfully'
        });

    } catch (error: any) {
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({
                status: 'error',
                message: 'Phone number and OTP are required'
            });
        }

        const { data, error } = await supabase.auth.verifyOtp({
            phone,
            token: otp,
            type: 'sms'
        });

        if (error) throw error;

        const user = data.user;
        const session = data.session;

        // Check if user exists in profiles, if not create one? 
        if (user) {
            // Check if profile exists
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (!profile || profileError) {
                // Create profile if missing
                console.log('Profile missing, creating fallback...');
                await supabase.from('profiles').insert([
                    { id: user.id, full_name: 'New User', role: 'customer', phone: phone }
                ]);
            } else if (!profile.phone) {
                // Update profile if phone is missing
                await supabase.from('profiles')
                    .update({ phone: phone })
                    .eq('id', user.id);
            }
        }

        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            data: {
                user: user,
                session: session
            }
        });

    } catch (error: any) {
        res.status(401).json({
            status: 'error',
            message: error.message
        });
    }
};
