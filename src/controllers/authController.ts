import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';

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

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Authentication failed' });
        }

        // 1. Fetch existing profile OR check pending_registrations
        // We do this AFTER verifyOtp to ensure we have the auth.uid()
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError) {
            console.error('[AUTH] Error fetching profile:', profileError);
        }

        const { data: pending, error: pendingError } = await supabase
            .from('pending_registrations')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();

        if (pendingError) {
            console.error('[AUTH] Error fetching pending registration:', pendingError);
        }

        // 2. Access Control: Only invited users or existing users can login
        if (!profile && !pending) {
            console.log(`[AUTH] Access denied for phone ${phone}. No profile or pending registration found.`);
            return res.status(403).json({ 
                status: 'error', 
                message: 'Access denied. Please contact your business owner to get an invitation.' 
            });
        }

        let isNewUser = false;
        let finalProfileData = profile;

        // 3. Handle New User from Invitation or Trigger
        // If profile doesn't exist yet (or trigger hasn't finished), but we have a pending invite
        if (!profile && pending) {
            isNewUser = true;
            console.log(`[AUTH] Creating new profile from pending registration for ${phone}`);
            
            // Use UPSERT to handle case where the trigger might have already inserted it
            const { data: newProfile, error: upsertError } = await supabase.from('profiles').upsert([
                {
                    id: user.id,
                    full_name: pending.full_name || 'New User',
                    role: pending.role || 'employee',
                    phone: phone,
                    status: 'ACTIVE',
                    is_verified: true,
                    business_id: pending.business_id,
                    updated_at: new Date().toISOString()
                }
            ], { onConflict: 'id' }).select().single();

            if (upsertError) {
                console.error('[AUTH] Profile upsert failed:', upsertError);
                throw upsertError;
            }
            
            finalProfileData = newProfile;
            
            // Clean up pending registration
            const { error: deleteError } = await supabase.from('pending_registrations').delete().eq('phone', phone);
            if (deleteError) console.error('[AUTH] Failed to delete pending registration:', deleteError);

        } else if (profile) {
            // 4. Status Check for existing users
            if (profile.status === 'INACTIVE' || profile.status === 'BLOCKED') {
                console.log(`[AUTH] Blocked access for user ${user.id}. Status: ${profile.status}`);
                return res.status(403).json({ 
                    status: 'error', 
                    message: `Your account is ${profile.status.toLowerCase()}. Access denied.` 
                });
            }

            // Update status if INVITED to ACTIVE
            if (profile.status === 'INVITED') {
                const { data: activatedProfile, error: updateError } = await supabase.from('profiles')
                    .update({ status: 'ACTIVE' })
                    .eq('id', user.id)
                    .select()
                    .single();
                
                if (updateError) {
                    console.error('[AUTH] Failed to activate profile:', updateError);
                } else {
                    finalProfileData = activatedProfile;
                }
            }

            // Sync phone if missing
            if (!profile.phone || profile.phone !== phone) {
                await supabase.from('profiles').update({ phone: phone }).eq('id', user.id);
            }
        }

        console.log(`[AUTH] Login successful for user: ${user.id}, Role: ${finalProfileData?.role}`);
        res.status(200).json({
            status: 'success',
            message: 'Login successful',
            data: {
                user: { ...user, ...finalProfileData },
                session: session,
                is_new_user: isNewUser
            }
        });

    } catch (error: any) {
        console.error('[AUTH] verifyOtp critical error:', error);
        
        // Differentiate between Auth errors (bad OTP) and Server errors
        const isAuthError = error.status === 400 || error.message?.toLowerCase().includes('otp') || error.message?.toLowerCase().includes('verification');
        
        res.status(isAuthError ? 401 : 500).json({
            status: 'error',
            message: error.message || 'An unexpected error occurred'
        });
    }
};
