import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient';
import { countBlockingLiveQueueTasks } from '../utils/liveQueueTaskCount';
import { isBlockingApprovedLeave } from '../utils/leaveStatus';

/** Human-readable dates for SMS (en-US, date-only safe). */
function formatLeaveDateForMessage(isoOrDate: string): string {
    const s = String(isoOrDate || '')
        .trim()
        .slice(0, 10);
    if (!s || s.length < 8) return String(isoOrDate || '').trim() || 'your requested dates';
    const d = new Date(`${s}T12:00:00`);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatLeaveRangeForMessage(start: string, end: string): string {
    const a = formatLeaveDateForMessage(start);
    const b = formatLeaveDateForMessage(end);
    if (a === b) return a;
    return `${a} through ${b}`;
}

function baseLang(input?: string): 'en' | 'es' | 'hi' | 'ar' {
    const l = String(input || 'en').toLowerCase().split('-')[0];
    if (l === 'es' || l === 'hi' || l === 'ar') return l;
    return 'en';
}

function leaveRequestToOwnerMessage(language: string, employeeName: string, businessName: string, start: string, end: string, note?: string): string {
    const when = formatLeaveRangeForMessage(start, end);
    const noteText = String(note || '').trim();
    const safeEmployee = employeeName || 'Employee';
    const lang = baseLang(language);
    if (lang === 'hi') {
        return `[QueueUp]\nछुट्टी अनुरोध\n\nकर्मचारी: ${safeEmployee}\nतारीख: ${when}\nकारण: ${noteText || 'उल्लेख नहीं किया गया'}\n\nकृपया डैशबोर्ड में Approve/Reject करें।`;
    }
    if (lang === 'ar') {
        return `[QueueUp]\nطلب إجازة جديد\n\nاسم الموظف: ${safeEmployee}\nالتاريخ: ${when}\nالسبب: ${noteText || 'غير مذكور'}\n\nيرجى الموافقة أو الرفض من لوحة التحكم.`;
    }
    if (lang === 'es') {
        return `[QueueUp]\nNueva solicitud de permiso\n\nEmpleado: ${safeEmployee}\nFecha: ${when}\nMotivo: ${noteText || 'No especificado'}\n\nAprueba o rechaza desde el panel.`;
    }
    return `[QueueUp]\nNew Leave Request\n\nEmployee Name: ${safeEmployee}\nDate: ${when}\nReason: ${noteText || 'Not provided'}\n\nApprove or Reject from dashboard.`;
}

function leaveDecisionToEmployeeMessage(language: string, firstName: string, when: string, approved: boolean, reason?: string): string {
    const name = firstName || 'there';
    const note = String(reason || '').trim();
    const lang = baseLang(language);
    if (approved) {
        if (lang === 'hi') return `[QueueUp]\nछुट्टी स्वीकृत\n\nनमस्ते ${name},\nआपकी छुट्टी (${when}) स्वीकृत हो गई है।\n\nअपने अवकाश का आनंद लें।`;
        if (lang === 'ar') return `[QueueUp]\nتمت الموافقة على الإجازة\n\nمرحباً ${name},\nتمت الموافقة على إجازتك بتاريخ ${when}.\n\nنتمنى لك وقتاً سعيداً.`;
        if (lang === 'es') return `[QueueUp]\nPermiso aprobado\n\nHola ${name},\nTu permiso para ${when} fue aprobado.\n\nDisfruta tu descanso.`;
        return `[QueueUp]\nLeave Approved\n\nHello ${name},\nYour leave for ${when} has been approved.\n\nEnjoy your time off!`;
    }
    if (lang === 'hi') return `[QueueUp]\nछुट्टी अस्वीकृत\n\nनमस्ते ${name},\n${when} की आपकी छुट्टी अनुरोध अस्वीकृत कर दी गई है।${note ? `\nकारण: ${note}` : ''}\n\nकृपया अनुसार योजना बनाएं।`;
    if (lang === 'ar') return `[QueueUp]\nتم رفض الإجازة\n\nمرحباً ${name},\nتم رفض طلب إجازتك بتاريخ ${when}.${note ? `\nالسبب: ${note}` : ''}\n\nيرجى التخطيط وفقاً لذلك.`;
    if (lang === 'es') return `[QueueUp]\nPermiso rechazado\n\nHola ${name},\nTu solicitud de permiso para ${when} fue rechazada.${note ? `\nMotivo: ${note}` : ''}\n\nPor favor, planifica en consecuencia.`;
    return `[QueueUp]\nLeave Rejected\n\nHello ${name},\nYour leave request for ${when} has been rejected.${note ? `\nReason: ${note}` : ''}\n\nPlease plan accordingly.`;
}

function leaveDecisionToOwnerMessage(language: string, employeeName: string, when: string, approved: boolean, reason?: string): string {
    const lang = baseLang(language);
    const safeEmployee = employeeName || 'Employee';
    const note = String(reason || '').trim();
    if (approved) {
        if (lang === 'hi') return `[QueueUp]\nछुट्टी निर्णय अपडेट\n\n${safeEmployee} की छुट्टी ${when} के लिए स्वीकृत कर दी गई है।`;
        if (lang === 'ar') return `[QueueUp]\nتحديث قرار الإجازة\n\nتمت الموافقة على إجازة ${safeEmployee} بتاريخ ${when}.`;
        if (lang === 'es') return `[QueueUp]\nActualización de permiso\n\nSe aprobó el permiso de ${safeEmployee} para ${when}.`;
        return `[QueueUp]\nLeave Decision Update\n\n${safeEmployee}'s leave for ${when} has been approved.`;
    }
    if (lang === 'hi') return `[QueueUp]\nछुट्टी निर्णय अपडेट\n\n${safeEmployee} की छुट्टी ${when} के लिए अस्वीकृत कर दी गई है।${note ? `\nकारण: ${note}` : ''}`;
    if (lang === 'ar') return `[QueueUp]\nتحديث قرار الإجازة\n\nتم رفض إجازة ${safeEmployee} بتاريخ ${when}.${note ? `\nالسبب: ${note}` : ''}`;
    if (lang === 'es') return `[QueueUp]\nActualización de permiso\n\nSe rechazó el permiso de ${safeEmployee} para ${when}.${note ? `\nMotivo: ${note}` : ''}`;
    return `[QueueUp]\nLeave Decision Update\n\n${safeEmployee}'s leave for ${when} has been rejected.${note ? `\nReason: ${note}` : ''}`;
}

const isMissingColumnError = (error: any, columnName: string) => {
    const raw = error?.message || error?.error || (error as any)?.details || (error as any)?.hint || '';
    const message = String(raw).toLowerCase();
    const col = columnName.toLowerCase();
    if (!message) return false;
    // PostgREST: "Could not find the 'status' column..."; Postgres: "column provider_leaves.status does not exist"
    const mentionsCol =
        message.includes(`'${col}'`) ||
        message.includes(`"${col}"`) ||
        message.includes(`column '${col}'`) ||
        message.includes(`.${col}`) ||
        message.includes(` ${col} `) ||
        (message.includes(col) && (message.includes('provider_leave') || message.includes('provider_leav')));
    const schemaIssue =
        message.includes('column') ||
        message.includes('schema cache') ||
        message.includes('does not exist') ||
        message.includes('undefined column');
    return mentionsCol && schemaIssue;
};

const isLeaveOverlapConstraintError = (error: any): boolean => {
    const raw = String(error?.message || error?.error || (error as any)?.details || '').toLowerCase();
    return raw.includes('exclusion constraint') || raw.includes('provider_leaves_overlap');
};

const validateTextByLanguage = (text: string, language: string): boolean => {
    if (!text || !text.trim()) return true;
    const baseLang = (language || 'en').split('-')[0].toLowerCase();
    const commonPattern = "0-9\\s\\.,!?'\"()&@#%*+=\\-\\/\\[\\]{}|_\\\\";
    const patterns: Record<string, string> = {
        en: `a-zA-Z${commonPattern}`,
        es: `a-zA-ZáéíóúüñÁÉÍÓÚÜÑ${commonPattern}`,
        hi: `\\u0900-\\u097F${commonPattern}`,
        ar: `\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF${commonPattern}`
    };
    const pattern = patterns[baseLang] || patterns.en;
    try {
        return new RegExp(`^[${pattern}]*$`, 'u').test(text);
    } catch {
        return new RegExp(`^[${pattern}]*$`).test(text);
    }
};

export const createServiceProvider = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id, name, phone, role, department, translations } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!business_id || !name || !phone || !role || !department) {
            return res.status(400).json({ status: 'error', message: 'providers.all_fields_required' });
        }

        // Verify ownership via RLS or explicit check
        const { data: business, error: bizError } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (bizError || !business) {
            return res.status(403).json({ status: 'error', message: 'providers.err_unauthorized_add' });
        }

        const trimmedName = name.trim();

        // Check if a provider with this name already exists for this business (case-insensitive)
        // We use limit(1) instead of maybeSingle() to handle cases where duplicates might already exist
        const { data: matches, error: checkError } = await supabase
            .from('service_providers')
            .select('id, is_active')
            .eq('business_id', business_id)
            .ilike('name', trimmedName)
            .limit(1);

        if (checkError) throw checkError;

        const existing = matches && matches.length > 0 ? matches[0] : null;

        if (existing) {
            if (existing.is_active) {
                return res.status(409).json({ 
                    status: 'error', 
                    message: 'providers.already_exists' 
                });
            } else {
                // Reactivate and update the existing record
                const { data, error: updateError } = await supabase
                    .from('service_providers')
                    .update({ 
                        is_active: true,
                        name: trimmedName, // Ensure name is trimmed
                        phone,
                        role,
                        department,
                        translations: translations || {}
                    })
                    .eq('id', existing.id)
                    .select()
                    .single();

                if (updateError) throw updateError;
                
                return res.status(200).json({
                    status: 'success',
                    message: 'providers.success_reactivate',
                    data
                });
            }
        }

        const { data, error } = await supabase
            .from('service_providers')
            .insert([{ business_id, name: trimmedName, phone, role, department, translations: translations || {} }])
            .select()
            .single();

        if (error && isMissingColumnError(error, 'status')) {
            return res.status(400).json({
                status: 'error',
                message: 'Leave approval is unavailable because this database is missing the provider_leaves.status column. Please run the latest leave migration.'
            });
        }
        if (error) throw error;

        res.status(201).json({
            status: 'success',
            message: 'providers.success_add',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getServiceProviders = async (req: Request, res: Response) => {
    try {
        const { business_id, date } = req.query;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const { adminSupabase } = require('../config/supabaseClient');
        
        let targetBusinessId = business_id;
        
        // 1. Ownership & Permission check
        if (targetBusinessId) {
            const { data: biz } = await req.supabase.from('businesses').select('id').eq('id', targetBusinessId).single();
            if (!biz) return res.status(403).json({ status: 'error', message: 'Forbidden' });
        } else {
            // Find businesses owned by user first (using authenticated client to check RLS)
            const { data: businesses } = await req.supabase.from('businesses').select('id');
            if (!businesses || businesses.length === 0) {
                return res.status(200).json({ status: 'success', data: [] });
            }
            targetBusinessId = businesses[0].id; // Fallback to first if not provided
        }

        // 2. Fetch using adminSupabase to see ALL providers (including those without user_id yet)
        let query = adminSupabase
            .from('service_providers')
            .select('*, services:provider_services(services(id, name))')
            .eq('business_id', targetBusinessId);

        const { data: providers, error } = await query.order('name', { ascending: true });

        if (error) throw error;

        // Determine the target timezone
        let timezone = 'UTC';
        if (business_id) {
            const { data: biz } = await supabase.from('businesses').select('timezone').eq('id', business_id).single();
            if (biz?.timezone) timezone = biz.timezone;
        }

        // Determine the target date for availability
        const targetDateStr = date ? String(date) : new Date().toLocaleDateString('en-CA', { timeZone: timezone });

        // Enhancement: Fetch leaves for these providers to compute "upcoming" / on-leave (approved only)
        let allRecentLeaves: any[] = [];
        if (providers && providers.length > 0) {
            const providerIds = providers.map((p: any) => p.id);
            const { data: recentLeaves } = await adminSupabase
                .from('provider_leaves')
                .select('*')
                .in('provider_id', providerIds)
                .gte('end_date', targetDateStr);
            if (recentLeaves) allRecentLeaves = recentLeaves.filter(isBlockingApprovedLeave);
        }

        // Enhance with current task count and availability
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone });

        const enhancedProviders = await Promise.all((providers || []).map(async (p: any) => {
            let currentTasksCount = 0;
            // Only fetch task count if assessing today's data to save DB hits if checking future dates
            if (targetDateStr === todayStr) {
                const { data: busyTasks } = await supabase
                    .from('queue_entry_services')
                    .select(`
                        id,
                        queue_entries!inner (
                            entry_date,
                            status
                        )
                    `)
                    .eq('assigned_provider_id', p.id)
                    .eq('task_status', 'in_progress')
                    .eq('queue_entries.entry_date', todayStr)
                    .eq('queue_entries.status', 'serving');
                currentTasksCount = busyTasks?.length || 0;
            }

            // Compute leave status
            const providerLeaves = allRecentLeaves.filter((l: any) => l.provider_id === p.id);
            const currentLeave = providerLeaves.find((l: any) => l.start_date <= targetDateStr && l.end_date >= targetDateStr);
            const upcomingLeave = providerLeaves.find((l: any) => l.start_date > targetDateStr && l.start_date <= tomorrowStr);

            let leave_status = 'available';
            let leave_until = null;
            let leave_starts_at = null;

            if (currentLeave) {
                leave_status = 'on_leave';
                leave_until = currentLeave.end_date;
            } else if (upcomingLeave) {
                leave_status = 'upcoming';
                leave_starts_at = upcomingLeave.start_date;
            }

            return {
                ...p,
                is_available: leave_status === 'available' && p.is_active !== false,
                leave_status,
                leave_until,
                leave_starts_at,
                current_tasks_count: currentTasksCount,
                services: p.services?.map((ps: any) => ps.services).filter(Boolean) || []
            };
        }));

        res.status(200).json({
            status: 'success',
            data: enhancedProviders
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateServiceProvider = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body || {};
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // PATCH semantics: allow partial updates
        const hasAnyUpdates =
            Object.prototype.hasOwnProperty.call(updates, 'name') ||
            Object.prototype.hasOwnProperty.call(updates, 'phone') ||
            Object.prototype.hasOwnProperty.call(updates, 'role') ||
            Object.prototype.hasOwnProperty.call(updates, 'department') ||
            Object.prototype.hasOwnProperty.call(updates, 'translations') ||
            Object.prototype.hasOwnProperty.call(updates, 'is_active') ||
            Object.prototype.hasOwnProperty.call(updates, 'is_available');

        if (!hasAnyUpdates) {
            return res.status(400).json({ status: 'error', message: 'providers.all_fields_required' });
        }

        const trimmedName = typeof updates.name === 'string' ? updates.name.trim() : undefined;

        // 1. Ownership check (Implicit via user_id/RLS, but let's confirm the business_id of the record)
        const { data: currentProvider, error: fetchError } = await supabase
            .from('service_providers')
            .select('business_id')
            .eq('id', id)
            .single();

        if (fetchError || !currentProvider) {
            return res.status(404).json({ status: 'error', message: 'providers.err_not_found' });
        }

        // 2. Check for name collision with OTHER providers in the same business (only when updating name)
        if (trimmedName) {
            const { data: collision, error: collisionError } = await supabase
                .from('service_providers')
                .select('id')
                .eq('business_id', currentProvider.business_id)
                .ilike('name', trimmedName)
                .neq('id', id) // Exclude current record
                .maybeSingle();

            if (collisionError) throw collisionError;

            if (collision) {
                return res.status(400).json({ status: 'error', message: 'providers.already_exists' });
            }
        }

        const safeUpdates: any = {};
        if (trimmedName !== undefined) safeUpdates.name = trimmedName;
        if (Object.prototype.hasOwnProperty.call(updates, 'phone')) safeUpdates.phone = updates.phone;
        if (Object.prototype.hasOwnProperty.call(updates, 'role')) safeUpdates.role = updates.role;
        if (Object.prototype.hasOwnProperty.call(updates, 'department')) safeUpdates.department = updates.department;
        if (Object.prototype.hasOwnProperty.call(updates, 'translations')) safeUpdates.translations = updates.translations;
        if (Object.prototype.hasOwnProperty.call(updates, 'is_active')) safeUpdates.is_active = updates.is_active;
        if (Object.prototype.hasOwnProperty.call(updates, 'is_available')) safeUpdates.is_available = updates.is_available;

        // RLS handles ownership, but we check if we got data back
        const { data, error } = await supabase
            .from('service_providers')
            .update(safeUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ status: 'error', message: 'providers.err_not_found' });
        }

        res.status(200).json({
            status: 'success',
            message: 'providers.success_update',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const deleteServiceProvider = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data: provRow, error: provFetchErr } = await supabase
            .from('service_providers')
            .select('business_id')
            .eq('id', id)
            .maybeSingle();

        if (provFetchErr) throw provFetchErr;
        if (!provRow) {
            return res.status(404).json({ status: 'error', message: 'providers.err_not_found' });
        }

        const { adminSupabase } = require('../config/supabaseClient');
        const taskCount = await countBlockingLiveQueueTasks(adminSupabase, id, provRow.business_id);

        if (taskCount > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'providers.err_active_tasks',
                count: taskCount
            });
        }

        // 2. Soft delete
        const { data, error, count } = await supabase
            .from('service_providers')
            .update({ is_active: false })
            .eq('id', id)
            .select('*', { count: 'exact', head: true });

        if (error) throw error;

        if (count === 0) {
            return res.status(404).json({ status: 'error', message: 'providers.err_not_found' });
        }

        res.status(200).json({
            status: 'success',
            message: 'providers.success_deactivate'
        });

    } catch (error: any) {
        console.error('[SP] Delete Provider Error:', error);
        res.status(500).json({ status: 'error', message: error.message || 'providers.err_generic' });
    }
};

export const getMyProviderProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        let { data, error } = await supabase
            .from('service_providers')
            .select('*, businesses(*), services:provider_services(services(*))')
            .eq('user_id', userId)
            .maybeSingle();

        // Fallback for invited employees whose provider row was created by phone before first login.
        if (!data) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('phone')
                .eq('id', userId)
                .maybeSingle();

            const normalizedPhone = (profile?.phone || '').replace(/[^\d+]/g, '');
            if (normalizedPhone) {
                const { adminSupabase } = require('../config/supabaseClient');
                const { data: phoneProvider } = await adminSupabase
                    .from('service_providers')
                    .select('id, user_id')
                    .eq('phone', normalizedPhone)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (phoneProvider) {
                    if (!phoneProvider.user_id) {
                        await adminSupabase
                            .from('service_providers')
                            .update({ user_id: userId })
                            .eq('id', phoneProvider.id);
                    }

                    const relinked = await supabase
                        .from('service_providers')
                        .select('*, businesses(*), services:provider_services(services(*))')
                        .eq('id', phoneProvider.id)
                        .maybeSingle();
                    data = relinked.data;
                    error = relinked.error as any;
                }
            }
        }

        if (error || !data) {
            return res.status(404).json({ status: 'error', message: 'Provider profile not found' });
        }

        res.status(200).json({ status: 'success', data });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const assignProviderServices = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { service_ids } = req.body; // array of service_ids
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!Array.isArray(service_ids)) {
            return res.status(400).json({ status: 'error', message: 'service_ids must be an array' });
        }

        // 1. Verify provider belongs to owner
        const { data: provider } = await supabase
            .from('service_providers')
            .select('id, business_id')
            .eq('id', id)
            .single();

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Provider not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', provider.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Clear existing services
        await supabase.from('provider_services').delete().eq('provider_id', id);

        // 3. Insert new services
        if (service_ids.length > 0) {
            const inserts = service_ids.map(sid => ({
                provider_id: id,
                service_id: sid
            }));
            const { error: insertError } = await supabase.from('provider_services').insert(inserts);
            if (insertError) throw insertError;
        }

        res.status(200).json({
            status: 'success',
            message: 'Services assigned to provider successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getProviderAvailability = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        const { data, error } = await supabase
            .from('provider_availability')
            .select('*')
            .eq('provider_id', id)
            .order('day_of_week', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: data || []
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateProviderAvailability = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { availability } = req.body; // Array of {day_of_week, start_time, end_time, is_available}
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Verify ownership
        const { data: provider } = await supabase
            .from('service_providers')
            .select('id, business_id')
            .eq('id', id)
            .single();

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Provider not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', provider.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Clear existing availability
        await supabase.from('provider_availability').delete().eq('provider_id', id);

        // 3. Insert new availability
        if (Array.isArray(availability) && availability.length > 0) {
            const inserts = availability.map((a: any) => ({
                provider_id: id,
                day_of_week: a.day_of_week,
                start_time: a.start_time,
                end_time: a.end_time,
                is_available: a.is_available ?? true
            }));
            const { error: insertError } = await supabase.from('provider_availability').insert(inserts);
            if (insertError) throw insertError;
        }

        res.status(200).json({
            status: 'success',
            message: 'Provider availability updated successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const assignProviderToEntry = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // entry_id
        const { provider_id } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Verify entry belongs to business owned by user
        const { data: entry, error: entryError } = await supabase
            .from('queue_entries')
            .select('id, queue_id, queues(business_id)')
            .eq('id', id)
            .single();

        if (entryError || !entry) {
            return res.status(404).json({ status: 'error', message: 'Entry not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', (entry as any).queues.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. If provider_id is provided, verify it exists and is active for this business
        if (provider_id) {
            const { data: provider } = await supabase
                .from('service_providers')
                .select('id')
                .eq('id', provider_id)
                .eq('business_id', (entry as any).queues.business_id)
                .eq('is_active', true)
                .single();

            if (!provider) {
                return res.status(400).json({ status: 'error', message: 'Invalid or inactive provider' });
            }
        }

        // 3. Update entry
        const { error: updateError } = await supabase
            .from('queue_entries')
            .update({ assigned_provider_id: provider_id || null })
            .eq('id', id);

        if (updateError) throw updateError;

        res.status(200).json({
            status: 'success',
            message: 'Expert assigned to entry successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ----------------------------------------------------
// Provider Leaves
// ----------------------------------------------------

export const getProviderLeaves = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id or user_id
        const { business_id } = req.query; // optional but recommended
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        // Resolve provider when frontend passes auth user id instead of provider id.
        let providerId = id;
        const { data: providerById } = await adminSupabase
            .from('service_providers')
            .select('id')
            .eq('id', id)
            .maybeSingle();
        if (!providerById) {
            const { data: providerByUser } = await adminSupabase
                .from('service_providers')
                .select('id')
                .eq('user_id', id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (providerByUser) providerId = providerByUser.id;
        }

        let query = supabase
            .from('provider_leaves')
            .select('*')
            .eq('provider_id', providerId);

        if (business_id) {
            query = query.eq('business_id', business_id);
        }

        const { data, error } = await query.order('start_date', { ascending: true });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: data || []
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const addProviderLeave = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id or user_id
        const { start_date, end_date, leave_type, note, ui_language } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!start_date || !end_date || !leave_type) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        const todayStr = new Date().toISOString().split('T')[0];
        if (start_date < todayStr || end_date < todayStr) {
            return res.status(400).json({ status: 'error', message: 'providers.err_leave_past_dates' });
        }

        // 1. Resolve provider by id OR user_id, then verify ownership/self
        let { data: provider } = await adminSupabase
            .from('service_providers')
            .select('id, business_id, user_id')
            .eq('id', id)
            .maybeSingle();

        if (!provider) {
            const byUser = await adminSupabase
                .from('service_providers')
                .select('id, business_id, user_id')
                .eq('user_id', id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            provider = byUser.data;
        }

        if (!provider) {
            return res.status(404).json({ status: 'error', message: 'Provider not found' });
        }

        // Check if user is the owner of the business OR the provider themselves
        const { data: business } = await supabase
            .from('businesses')
            .select('id, owner_id')
            .eq('id', provider.business_id)
            .single();

        const isOwner = business?.owner_id === userId;
        const isSelf = provider.user_id === userId;

        if (!isOwner && !isSelf) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: You can only apply for your own leave or for employees you own.' });
        }

        // 2. Overlap check application level (avoid .neq(status) if column missing)
        let overlapsRes = await supabase
            .from('provider_leaves')
            .select('id')
            .eq('provider_id', provider.id)
            .lte('start_date', end_date)
            .gte('end_date', start_date)
            .neq('status', 'REJECTED');

        if (overlapsRes.error) {
            if (isMissingColumnError(overlapsRes.error, 'status')) {
                overlapsRes = await supabase
                    .from('provider_leaves')
                    .select('id')
                    .eq('provider_id', provider.id)
                    .lte('start_date', end_date)
                    .gte('end_date', start_date);
            } else {
                throw overlapsRes.error;
            }
        }

        const overlaps = overlapsRes.data;
        if (overlaps && overlaps.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'This provider already has a leave scheduled or pending during these dates.'
            });
        }

        // 3. Determine status based on role
        const { data: profile } = await supabase.from('profiles').select('role, full_name, ui_language').eq('id', userId).single();
        const isAdminOrOwner = profile?.role === 'owner' || profile?.role === 'admin';
        const status = isAdminOrOwner ? 'APPROVED' : 'PENDING';

        if (note && !validateTextByLanguage(note, profile?.ui_language || 'en')) {
            return res.status(400).json({
                status: 'error',
                message: 'common.err_invalid_chars'
            });
        }

        // 4. Insert leave
        const payload: any = {
            provider_id: provider.id,
            business_id: provider.business_id,
            start_date,
            end_date,
            leave_type,
            note,
            status,
            approved_by: isAdminOrOwner ? userId : null
        };
        let data: any = null;
        let error: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const insertRes = await supabase
                .from('provider_leaves')
                .insert([payload])
                .select()
                .limit(1)
                .maybeSingle();
            data = insertRes.data;
            error = insertRes.error;
            if (!error) break;
            if (isLeaveOverlapConstraintError(error)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'providers.err_leave_overlap'
                });
            }
            if (isMissingColumnError(error, 'approved_by')) {
                delete payload.approved_by;
                continue;
            }
            if (isMissingColumnError(error, 'status')) {
                delete payload.status;
                continue;
            }
            break;
        }

        if (error) throw error;

        // 5. Notify owner (SMS + WhatsApp when possible; multiple phone fallbacks)
        let notificationSent = false;
        let ownerNotifyTarget: string | null = null;
        if (!isAdminOrOwner) {
            const { data: biz } = await adminSupabase
                .from('businesses')
                .select('owner_id, name, phone, whatsapp_number')
                .eq('id', provider.business_id)
                .maybeSingle();

            const businessName = biz?.name || 'Your Business';
            const employeeFullname = profile?.full_name || 'An Employee';
            const requestLang = ui_language || profile?.ui_language || 'en';
            const msg = leaveRequestToOwnerMessage(
                requestLang,
                employeeFullname,
                businessName,
                start_date,
                end_date,
                note
            );

            const { notificationService, toE164Phone } = require('../services/notificationService');
            const candidates: string[] = [];
            if (biz?.owner_id) {
                const { data: ownerRow } = await adminSupabase
                    .from('profiles')
                    .select('phone')
                    .eq('id', biz.owner_id)
                    .maybeSingle();
                if (ownerRow?.phone) candidates.push(String(ownerRow.phone));
            }
            if (biz?.whatsapp_number) candidates.push(String(biz.whatsapp_number));
            if (biz?.phone) candidates.push(String(biz.phone));

            const normalized = [...new Set(candidates.map((c) => toE164Phone(String(c))).filter(Boolean))];
            ownerNotifyTarget = normalized[0] || null;

            if (normalized.length === 0) {
                notificationSent = false;
            } else {
                const results = await Promise.allSettled(
                    normalized.flatMap((to) => [
                        notificationService.sendWhatsApp(to, msg),
                        notificationService.sendSMS(to, msg)
                    ])
                );
                notificationSent = results.some(
                    (r) => r.status === 'fulfilled' && r.value === true
                );
            }
        }

        res.status(201).json({
            status: 'success',
            message: isAdminOrOwner ? 'Leave added successfully' : 'Leave request submitted successfully',
            data,
            notification_sent: isAdminOrOwner ? undefined : notificationSent,
            owner_phone_configured: isAdminOrOwner ? undefined : !!ownerNotifyTarget
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateLeaveStatus = async (req: Request, res: Response) => {
    try {
        const { leaveId } = req.params;
        const { status } = req.body; // APPROVED or REJECTED
        const reasonRaw = String(req.body?.reason || '').trim();
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        if (status === 'REJECTED' && !reasonRaw) {
            return res.status(400).json({
                status: 'error',
                message: 'Rejection reason is required'
            });
        }

        // 1. Verify ownership
        const { data: leave } = await supabase
            .from('provider_leaves')
            .select('*, service_providers(name, phone, user_id)')
            .eq('id', leaveId)
            .single();

        if (!leave) {
            return res.status(404).json({ status: 'error', message: 'Leave not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, phone, whatsapp_number')
            .eq('id', leave.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Update status and optional reason
        const updatePayload: any = {
            status,
            approved_by: userId,
            rejection_reason: status === 'REJECTED' ? reasonRaw : null
        };
        let { data, error } = await supabase
            .from('provider_leaves')
            .update(updatePayload)
            .eq('id', leaveId)
            .select()
            .single();

        // Backward-compatibility: columns may not exist on older DBs.
        if (error && isMissingColumnError(error, 'approved_by')) {
            delete updatePayload.approved_by;
            const retry = await supabase
                .from('provider_leaves')
                .update(updatePayload)
                .eq('id', leaveId)
                .select()
                .single();
            data = retry.data as any;
            error = retry.error as any;
        }
        if (error && isMissingColumnError(error, 'rejection_reason')) {
            delete updatePayload.rejection_reason;
            const retry = await supabase
                .from('provider_leaves')
                .update(updatePayload)
                .eq('id', leaveId)
                .select()
                .single();
            data = retry.data as any;
            error = retry.error as any;
        }

        if (error && isMissingColumnError(error, 'status')) {
            return res.status(400).json({
                status: 'error',
                message: 'Leave approval is unavailable because this database is missing the provider_leaves.status column. Please run the latest leave migration.'
            });
        }
        if (error) throw error;

        // 3. Notify Employee
        let recipientPhone = leave.service_providers?.phone;
        if (!recipientPhone && leave.service_providers?.user_id) {
            const { data: empProfile } = await adminSupabase
                .from('profiles')
                .select('phone')
                .eq('id', leave.service_providers.user_id)
                .maybeSingle();
            recipientPhone = empProfile?.phone;
        }

        let notificationSent = false;
        let ownerNotificationSent = false;
        const { notificationService, toE164Phone } = require('../services/notificationService');
        const firstName = String(leave.service_providers?.name || 'there').trim().split(/\s+/)[0];
        const employeeName = String(leave.service_providers?.name || 'Employee').trim();
        const when = formatLeaveRangeForMessage(leave.start_date, leave.end_date);
        const { data: approverProfile } = await supabase
            .from('profiles')
            .select('ui_language, phone')
            .eq('id', userId)
            .maybeSingle();
        if (recipientPhone) {
            const msg = leaveDecisionToEmployeeMessage(
                approverProfile?.ui_language || 'en',
                firstName,
                when,
                status === 'APPROVED',
                reasonRaw
            );

            const to = toE164Phone(String(recipientPhone));
            if (!to) {
                notificationSent = false;
            } else {
                const [waRes, smsRes] = await Promise.allSettled([
                    notificationService.sendWhatsApp(to, msg),
                    notificationService.sendSMS(to, msg)
                ]);
                const waOk = waRes.status === 'fulfilled' ? waRes.value : false;
                const smsOk = smsRes.status === 'fulfilled' ? smsRes.value : false;
                notificationSent = !!(waOk || smsOk);
            }
        }

        // 4. Owner confirmation notification (non-blocking)
        const ownerMsg = leaveDecisionToOwnerMessage(
            approverProfile?.ui_language || 'en',
            employeeName,
            when,
            status === 'APPROVED',
            reasonRaw
        );
        const ownerCandidates: string[] = [];
        if (approverProfile?.phone) ownerCandidates.push(String(approverProfile.phone));
        if (business?.whatsapp_number) ownerCandidates.push(String(business.whatsapp_number));
        if (business?.phone) ownerCandidates.push(String(business.phone));
        const ownerTargets = [...new Set(ownerCandidates.map((p) => toE164Phone(String(p))).filter(Boolean))];
        if (ownerTargets.length > 0) {
            const ownerResults = await Promise.allSettled(
                ownerTargets.flatMap((to: string) => [
                    notificationService.sendWhatsApp(to, ownerMsg),
                    notificationService.sendSMS(to, ownerMsg)
                ])
            );
            ownerNotificationSent = ownerResults.some((r: any) => r.status === 'fulfilled' && r.value === true);
        }

        res.status(200).json({
            status: 'success',
            message: 'providers.success_leave_status_updated',
            data,
            leave_status: status,
            notification_sent: notificationSent,
            owner_notification_sent: ownerNotificationSent
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const deleteProviderLeave = async (req: Request, res: Response) => {
    try {
        const { leaveId } = req.params;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // We could explicitly check owner_id again for max security, but we rely on RLS 
        // to restrict deletes if configured, or we can just double check ownership manually here.

        const { data: leave } = await supabase
            .from('provider_leaves')
            .select('business_id')
            .eq('id', leaveId)
            .single();

        if (!leave) {
            return res.status(404).json({ status: 'error', message: 'Leave not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', leave.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized to delete this leave' });
        }

        const { error } = await supabase
            .from('provider_leaves')
            .delete()
            .eq('id', leaveId);

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: 'Leave removed successfully'
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getBulkLeaveStatus = async (req: Request, res: Response) => {
    try {
        const { business_id, date } = req.query;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!business_id) {
            return res.status(400).json({ status: 'error', message: 'Business ID is required' });
        }

        // Verify ownership
        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const { data: providers } = await supabase
            .from('service_providers')
            .select('id, name')
            .eq('business_id', business_id)
            .eq('is_active', true);

        // Get business timezone
        const { data: bizInfo } = await supabase.from('businesses').select('timezone').eq('id', business_id).single();
        const timezone = bizInfo?.timezone || 'UTC';

        const targetDateStr = date ? String(date) : new Date().toLocaleDateString('en-CA', { timeZone: timezone });
        const tomorrow = new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone });

        const { data: leavesRaw } = await supabase
            .from('provider_leaves')
            .select('*')
            .eq('business_id', business_id)
            .gte('end_date', targetDateStr);

        const leaves = (leavesRaw || []).filter(isBlockingApprovedLeave);

        const results = (providers || []).map((p: any) => {
            const providerLeaves = (leaves || []).filter((l: any) => l.provider_id === p.id);
            const currentLeave = providerLeaves.find((l: any) => l.start_date <= targetDateStr && l.end_date >= targetDateStr);
            const upcomingLeave = providerLeaves.find((l: any) => l.start_date > targetDateStr && l.start_date <= tomorrowStr);

            let leave_status = 'available';
            let leave_until = null;
            let leave_starts_at = null;

            if (currentLeave) {
                leave_status = 'on_leave';
                leave_until = currentLeave.end_date;
            } else if (upcomingLeave) {
                leave_status = 'upcoming';
                leave_starts_at = upcomingLeave.start_date;
            }

            return {
                provider_id: p.id,
                name: p.name,
                leave_status,
                leave_until,
                leave_starts_at
            };
        });

        res.status(200).json({
            status: 'success',
            data: results
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

/** Pending leave requests (employee-submitted, awaiting owner action) — for owner dashboard alerts */
export const getPendingLeaveRequestsCount = async (req: Request, res: Response) => {
    try {
        const { business_id } = req.query;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }
        if (!business_id) {
            return res.status(400).json({ status: 'error', message: 'business_id is required' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const { count, error } = await adminSupabase
            .from('provider_leaves')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', business_id)
            .eq('status', 'PENDING');
        if (error && isMissingColumnError(error, 'status')) {
            return res.status(200).json({
                status: 'success',
                data: { pending_count: 0 }
            });
        }
        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: { pending_count: count || 0 }
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ----------------------------------------------------
// Resignation Requests
// ----------------------------------------------------

export const submitResignation = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { reason, requested_last_date } = req.body;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        // 1. Get employee details
        const { data: employee } = await supabase
            .from('profiles')
            .select('id, business_id, full_name, role, phone, ui_language')
            .eq('id', userId)
            .single();

        if (!employee || employee.role !== 'employee') {
            return res.status(403).json({ status: 'error', message: 'Only employees can submit resignation' });
        }

        // 1.5. Validate date and existing pending requests
        if (new Date(requested_last_date) < new Date()) {
            return res.status(400).json({ status: 'error', message: 'Requested last date cannot be in the past' });
        }

        const { data: existingPending } = await supabase
            .from('resignation_requests')
            .select('id')
            .eq('employee_id', userId)
            .eq('status', 'PENDING')
            .maybeSingle();

        if (existingPending) {
            return res.status(400).json({ status: 'error', message: 'You already have a pending resignation request' });
        }

        // 2. Submit request
        const { data, error } = await supabase
            .from('resignation_requests')
            .insert([{
                employee_id: userId,
                business_id: employee.business_id,
                reason,
                requested_last_date,
                status: 'PENDING'
            }])
            .select()
            .single();

        if (error) throw error;

        // 3. Notify Owner + Employee confirmation
        const { data: business } = await supabase.from('businesses').select('owner_id').eq('id', employee.business_id).single();
        const { notificationService } = require('../services/notificationService');
        const notificationJobs: Promise<any>[] = [];

        if (business?.owner_id) {
            const { data: owner } = await supabase.from('profiles').select('phone').eq('id', business.owner_id).single();
            if (owner?.phone) {
                const msg = `Resignation request received from ${employee.full_name}. Reason: ${reason || 'Not provided'}. Requested Last Date: ${requested_last_date || 'N/A'}.`;
                notificationJobs.push(notificationService.sendWhatsApp(owner.phone, msg));
                notificationJobs.push(notificationService.sendSMS(owner.phone, msg));
            }
        }

        if (employee?.phone) {
            const empMsg = `Your resignation request has been submitted successfully. Requested last date: ${requested_last_date || 'N/A'}. We will notify you once the business owner reviews it.`;
            notificationJobs.push(notificationService.sendWhatsApp(employee.phone, empMsg));
            notificationJobs.push(notificationService.sendSMS(employee.phone, empMsg));
        }

        if (notificationJobs.length > 0) {
            await Promise.allSettled(notificationJobs);
        }

        res.status(201).json({
            status: 'success',
            message: 'Resignation request submitted successfully',
            data
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const getResignationRequests = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const { business_id } = req.query;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        // 1. Verify owner
        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. Fetch requests
        const { data, error } = await supabase
            .from('resignation_requests')
            .select('*, profiles:employee_id(full_name, phone)')
            .eq('business_id', business_id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            data: data || []
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const updateResignationStatus = async (req: Request, res: Response) => {
    try {
        const { requestId } = req.params;
        const { status } = req.body; // APPROVED or REJECTED
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        // 1. Verify request and ownership
        const { data: request } = await supabase
            .from('resignation_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (!request) {
            return res.status(404).json({ status: 'error', message: 'Request not found' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id')
            .eq('id', request.business_id)
            .eq('owner_id', userId)
            .single();

        if (!business) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        // 2. If APPROVED, run safety checks BEFORE updating status
        if (status === 'APPROVED') {
            // Safety check: active tasks assigned to this employee
            const { data: provider } = await supabase
                .from('service_providers')
                .select('id')
                .eq('user_id', request.employee_id)
                .maybeSingle();

            if (provider) {
                const { data: bizInfo } = await supabase
                    .from('businesses')
                    .select('timezone')
                    .eq('id', request.business_id)
                    .maybeSingle();
                const timezone = bizInfo?.timezone || 'UTC';
                const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

                const { data: activeTasks, error: activeTasksError } = await supabase
                    .from('queue_entry_services')
                    .select(`
                        id,
                        queue_entries!inner (
                            entry_date,
                            status
                        )
                    `)
                    .eq('assigned_provider_id', provider.id)
                    .in('task_status', ['pending', 'in_progress'])
                    .eq('queue_entries.entry_date', todayStr)
                    .in('queue_entries.status', ['waiting', 'serving', 'skipped']);

                if (activeTasksError) throw activeTasksError;
                const taskCount = activeTasks?.length || 0;

                if (taskCount && taskCount > 0) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Safety Block: This employee has ${taskCount} active tasks. Please reassign or complete them before approving resignation.`
                    });
                }
            }
        }

        // 3. Update resignation request after all validations pass
        const { error: updateReqError } = await supabase
            .from('resignation_requests')
            .update({ status })
            .eq('id', requestId);

        if (updateReqError) throw updateReqError;

        const { data: emp } = await supabase
            .from('profiles')
            .select('phone, full_name')
            .eq('id', request.employee_id)
            .single();
        const { data: empProvider } = await supabase
            .from('service_providers')
            .select('phone')
            .eq('user_id', request.employee_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const employeePhone = emp?.phone || empProvider?.phone;
        const { notificationService } = require('../services/notificationService');

        let notificationSent = false;

        // 4. Apply post-status effects + notify employee
        if (status === 'APPROVED') {
            const { data: bizInfo } = await supabase
                .from('businesses')
                .select('timezone')
                .eq('id', request.business_id)
                .maybeSingle();
            const timezone = bizInfo?.timezone || 'UTC';
            const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
            const requestedLastDate = String(request.requested_last_date || '');
            const shouldDeactivateNow = !!requestedLastDate && todayStr >= requestedLastDate;

            if (shouldDeactivateNow) {
                const { error: updateEmpError } = await supabase
                    .from('profiles')
                    .update({ status: 'INACTIVE' })
                    .eq('id', request.employee_id);
                if (updateEmpError) throw updateEmpError;

                await supabase
                    .from('service_providers')
                    .update({ is_active: false })
                    .eq('user_id', request.employee_id);
            }

            if (employeePhone) {
                const approvedMsg = shouldDeactivateNow
                    ? `Hi ${emp.full_name || 'Employee'}, your resignation request has been approved. Your access to the system has been revoked.`
                    : `Hi ${emp.full_name || 'Employee'}, your resignation request has been approved. You can continue working until ${requestedLastDate}. Access will be disabled after your last working date.`;
                const [waRes, smsRes] = await Promise.allSettled([
                    notificationService.sendWhatsApp(employeePhone, approvedMsg),
                    notificationService.sendSMS(employeePhone, approvedMsg)
                ]);
                const waOk = waRes.status === 'fulfilled' ? waRes.value : false;
                const smsOk = smsRes.status === 'fulfilled' ? smsRes.value : false;
                notificationSent = !!(waOk || smsOk);
            }
        } else if (status === 'REJECTED') {
            if (employeePhone) {
                const rejectedMsg = `Hi ${emp.full_name || 'Employee'}, your resignation request has been rejected by the business owner. Please contact the owner for details.`;
                const [waRes, smsRes] = await Promise.allSettled([
                    notificationService.sendWhatsApp(employeePhone, rejectedMsg),
                    notificationService.sendSMS(employeePhone, rejectedMsg)
                ]);
                const waOk = waRes.status === 'fulfilled' ? waRes.value : false;
                const smsOk = smsRes.status === 'fulfilled' ? smsRes.value : false;
                notificationSent = !!(waOk || smsOk);
            }
        }

        res.status(200).json({
            status: 'success',
            message: `Resignation ${status.toLowerCase()} successfully`,
            notification_sent: notificationSent
        });

    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
