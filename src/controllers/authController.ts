import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';

export const sendOtp = async (req: Request, res: Response) => {
    try {
        const { phone } = req.body;
        console.log(`[AUTH] Received OTP request for phone: ${phone}`);

        if (!phone) {
            console.log('[AUTH] Phone number missing');
            return res.status(400).json({
                status: 'error',
                message: 'Phone number is required'
            });
        }

        console.log('[AUTH] Calling supabase.auth.signInWithOtp...');
        const start = Date.now();
        const { error } = await supabase.auth.signInWithOtp({
            phone
        });
        const duration = Date.now() - start;

        if (error) {
            console.error(`[AUTH] Supabase OTP Error (${duration}ms):`, error);
            throw error;
        }

        console.log(`[AUTH] OTP sent successfully to ${phone} in ${duration}ms`);
        res.status(200).json({
            status: 'success',
            message: 'OTP sent successfully'
        });

    } catch (error: any) {
        console.error('[AUTH] sendOtp caught error:', error.message);
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

        // Check if user exists in profiles, if not create one
        if (user) {
            console.log(`[AUTH] Checking profile for user: ${user.id}`);
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', user.id)
                .single();

            if (!profile || profileError) {
                console.log('[AUTH] Profile missing or error, creating/upserting profile...');
                const { error: insertError } = await supabase.from('profiles').upsert([
                    {
                        id: user.id,
                        full_name: 'New User',
                        role: 'customer',
                        phone: phone,
                        status: 'pending',
                        is_verified: false,
                        ui_language: 'en',
                        created_at: new Date().toISOString()
                    }
                ], { onConflict: 'id' });

                if (insertError) {
                    console.error('[AUTH] Failed to create/upsert profile:', insertError);
                } else {
                    console.log('[AUTH] Profile created/upserted successfully');
                }
            } else {
                // Update phone if missing
                await supabase.from('profiles')
                    .update({ phone: phone })
                    .eq('id', user.id)
                    .is('phone', null);
            }
        }

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Authentication failed' });
        }

        // Fetch the final profile to return with the user object
        const { data: finalProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            data: {
                user: { ...user, ...finalProfile },
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
