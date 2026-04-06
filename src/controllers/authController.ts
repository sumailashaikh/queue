import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { notificationService } from '../services/notificationService';

export const sendOtp = async (req: Request, res: Response) => {
    try {
        let { phone } = req.body;
        console.log(`[AUTH] Received OTP request for phone: ${phone}`);

        if (!phone) {
            console.log('[AUTH] Phone number missing');
            return res.status(400).json({
                status: 'error',
                message: 'Phone number is required'
            });
        }

        // Normalize phone number early: strictly digits and leading +
        phone = phone.replace(/[^\d+]/g, '');
        console.log(`[AUTH] Normalized phone: ${phone}`);

        console.log('[AUTH] Calling supabase.auth.signInWithOtp...');
        const start = Date.now();
        const otpPromise = supabase.auth.signInWithOtp({ phone });
        const timeoutPromise = new Promise<{ error: Error }>((resolve) =>
            setTimeout(() => resolve({ error: new Error('OTP service timeout. Please try again.') }), 15000)
        );
        const { error } = await Promise.race([otpPromise, timeoutPromise]);
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
        const raw = String(error?.message || '').toLowerCase();
        const safeMessage = (raw.includes('63038') || raw.includes('daily messages limit') || raw.includes('twilio'))
            ? 'OTP service is temporarily busy. Please try again after some time.'
            : (error.message || 'Failed to send OTP');
        res.status(400).json({
            status: 'error',
            message: safeMessage
        });
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        let { phone, otp, invite_token } = req.body as any;

        if (!phone || !otp) {
            return res.status(400).json({
                status: 'error',
                message: 'Phone number and OTP are required'
            });
        }

        // Normalize phone number early to ensure DB lookups match correctly
        // This resolves "Service configuration error" caused by lookup failures
        const originalPhone = phone; // Keep for verifyOtp if needed
        phone = phone.replace(/[^\d+]/g, '');

        const { data, error } = await supabase.auth.verifyOtp({
            phone: phone, // Must match normalized phone from signInWithOtp
            token: otp,
            type: 'sms'
        });

        if (error) throw error;

        const user = data.user;
        const session = data.session;

        if (!user) {
            return res.status(401).json({ status: 'error', message: 'Authentication failed' });
        }

        // Guard approved resignations by effective last working date.
        const { data: approvedResignation } = await supabase
            .from('resignation_requests')
            .select('id, requested_last_date, business_id')
            .eq('employee_id', user.id)
            .eq('status', 'APPROVED')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (approvedResignation) {
            const { data: bizInfo } = await supabase
                .from('businesses')
                .select('timezone')
                .eq('id', approvedResignation.business_id)
                .maybeSingle();
            const timezone = bizInfo?.timezone || 'UTC';
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
            const requestedLastDate = String(approvedResignation.requested_last_date || '');
            const shouldBlockNow = !!requestedLastDate && todayStr >= requestedLastDate;

            if (shouldBlockNow) {
                await supabase.from('profiles').update({ status: 'INACTIVE' }).eq('id', user.id);
                await supabase.from('service_providers').update({ is_active: false }).eq('user_id', user.id);
                return res.status(403).json({
                    status: 'error',
                    message: 'Your resignation has been approved and your last working date has passed. Access is disabled.'
                });
            }
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

        // Optional: validate one-time invite token now; apply to profile after profile/pending resolution
        // (so former owners become employees: role + business_id are written on successful OTP).
        let validatedInvite: { token: string; business_id: string; role: string; full_name: string | null } | null = null;
        // Invite token applies role/business when valid. Stale tokens in mobile localStorage must not
        // block normal owner/admin login — ignore invalid/expired/used/mismatch and continue.
        if (invite_token) {
            try {
                const adminSupabase = require('../config/supabaseClient').supabase;
                const { data: invite, error: invErr } = await adminSupabase
                    .from('employee_invites')
                    .select('token, phone, expires_at, used_at, business_id, role, full_name')
                    .eq('token', invite_token)
                    .maybeSingle();

                if (invErr) throw invErr;
                if (!invite) {
                    console.warn('[AUTH] Ignoring unknown invite_token (client may have stale PWA storage)');
                } else if (invite.used_at) {
                    console.warn('[AUTH] Ignoring already-used invite_token');
                } else if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
                    console.warn('[AUTH] Ignoring expired invite_token');
                } else {
                    const invitePhone = (invite.phone || '').replace(/[^\d+]/g, '');
                    if (invitePhone && invitePhone !== phone) {
                        console.warn('[AUTH] Ignoring invite_token (phone mismatch)');
                    } else {
                        validatedInvite = {
                            token: invite_token,
                            business_id: invite.business_id,
                            role: invite.role || 'employee',
                            full_name: invite.full_name
                        };
                    }
                }
            } catch (e: any) {
                // Table missing in legacy DBs: continue without token-based role enforcement
                console.warn('[AUTH] Invite token validation skipped:', e?.message || e);
                validatedInvite = null;
            }
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
                    phone: phone, // Already normalized at top
                    status: 'active',
                    is_verified: true,
                    business_id: pending.business_id
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
            const normalizedStatus = String(profile.status || '').trim().toLowerCase();
            if (['inactive', 'blocked', 'resigned', 'terminated'].includes(normalizedStatus)) {
                console.log(`[AUTH] Blocked access for user ${user.id}. Status: ${profile.status}`);
                return res.status(403).json({ 
                    status: 'error', 
                    message: `Your account is ${profile.status.toLowerCase()}. Access denied.` 
                });
            }

            // Update status to active for invited/pending onboarding states
            if (profile.status === 'invited' || profile.status === 'pending') {
                const { data: activatedProfile, error: updateError } = await supabase.from('profiles')
                    .update({ status: 'active' })
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

        // 4b. Existing account + pending row (e.g. phone mismatch on invite): become employee if no owned business
        try {
            const adminSupabase = require('../config/supabaseClient').supabase;
            if (profile && pending?.business_id) {
                const { data: ownedBiz } = await adminSupabase
                    .from('businesses')
                    .select('id')
                    .eq('owner_id', user.id)
                    .limit(1);
                if (!ownedBiz?.length) {
                    const pendRole = String(pending.role || 'employee').toLowerCase();
                    const { data: merged, error: mErr } = await adminSupabase
                        .from('profiles')
                        .update({
                            role: pendRole,
                            business_id: pending.business_id,
                            status: 'active',
                            is_verified: true,
                            full_name: pending.full_name || profile.full_name
                        })
                        .eq('id', user.id)
                        .select()
                        .single();
                    if (!mErr && merged) {
                        finalProfileData = merged;
                        await adminSupabase.from('pending_registrations').delete().eq('phone', phone);
                    }
                }
            }
        } catch (mergeErr: any) {
            console.warn('[AUTH] Pending registration merge skipped:', mergeErr?.message || mergeErr);
        }

        // 4c. Apply validated invite link — sets role + business_id (fixes former owners still marked owner)
        try {
            const adminSupabase = require('../config/supabaseClient').supabase;
            if (validatedInvite) {
                const inviteRole = String(validatedInvite.role || 'employee').toLowerCase();
                const { data: upserted, error: invUpErr } = await adminSupabase
                    .from('profiles')
                    .upsert(
                        {
                            id: user.id,
                            role: inviteRole,
                            business_id: validatedInvite.business_id,
                            status: 'active',
                            is_verified: true,
                            phone,
                            full_name:
                                finalProfileData?.full_name ||
                                validatedInvite.full_name ||
                                profile?.full_name ||
                                'Team Member'
                        },
                        { onConflict: 'id' }
                    )
                    .select()
                    .single();
                if (invUpErr) throw invUpErr;
                if (upserted) finalProfileData = upserted;
                await adminSupabase.from('pending_registrations').delete().eq('phone', phone);
                await adminSupabase
                    .from('employee_invites')
                    .update({ used_at: new Date().toISOString(), used_by: user.id })
                    .eq('token', validatedInvite.token);
            }
        } catch (invApplyErr: any) {
            console.error('[AUTH] Failed to apply employee invite to profile:', invApplyErr);
            throw invApplyErr;
        }

        // 5. Ensure invited provider row is linked to this auth user (critical for employee dashboard/tasks/leaves)
        try {
            const adminSupabase = require('../config/supabaseClient').supabase;
            const normalizedPhone = phone.replace(/[^\d+]/g, '');
            const employerBizId = finalProfileData?.business_id;
            const { data: existingLinked } = await adminSupabase
                .from('service_providers')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();

            if (!existingLinked && normalizedPhone) {
                let provQuery = adminSupabase
                    .from('service_providers')
                    .select('id, user_id')
                    .eq('phone', normalizedPhone)
                    .order('created_at', { ascending: false })
                    .limit(1);
                if (employerBizId) provQuery = provQuery.eq('business_id', employerBizId);
                const { data: providerByPhone } = await provQuery.maybeSingle();

                if (providerByPhone && !providerByPhone.user_id) {
                    await adminSupabase
                        .from('service_providers')
                        .update({ user_id: user.id })
                        .eq('id', providerByPhone.id);
                }
            }
        } catch (linkErr: any) {
            console.warn('[AUTH] service_provider user link skipped:', linkErr?.message || linkErr);
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
