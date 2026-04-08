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

function resignationRequestToOwnerMessage(language: string, employeeName: string, requestedLastDate?: string, reason?: string): string {
    const lang = baseLang(language);
    const safeEmployee = employeeName || 'Employee';
    const safeDate = requestedLastDate || 'N/A';
    const safeReason = String(reason || '').trim() || 'Not provided';
    if (lang === 'hi') {
        return `[QueueUp]\nनया इस्तीफा अनुरोध\n\nकर्मचारी: ${safeEmployee}\nअंतिम कार्य तिथि: ${safeDate}\nकारण: ${safeReason}\n\nकृपया डैशबोर्ड से समीक्षा करें।`;
    }
    if (lang === 'ar') {
        return `[QueueUp]\nطلب استقالة جديد\n\nالموظف: ${safeEmployee}\nآخر يوم عمل: ${safeDate}\nالسبب: ${safeReason}\n\nيرجى المراجعة من لوحة التحكم.`;
    }
    if (lang === 'es') {
        return `[QueueUp]\nNueva solicitud de renuncia\n\nEmpleado: ${safeEmployee}\nUltimo dia laboral: ${safeDate}\nMotivo: ${safeReason}\n\nRevisa la solicitud desde el panel.`;
    }
    return `[QueueUp]\nNew Resignation Request\n\nEmployee: ${safeEmployee}\nRequested Last Date: ${safeDate}\nReason: ${safeReason}\n\nPlease review in dashboard.`;
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
            .eq('business_id', targetBusinessId)
            .eq('is_active', true);

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
        const { start_date, end_date, leave_type, leave_kind, start_time, end_time, note, ui_language, allow_owner_approval } = req.body;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        if (!start_date || !end_date || !leave_type) {
            return res.status(400).json({ status: 'error', message: 'Missing required fields' });
        }

        const normalizedKind = String(leave_kind || 'FULL_DAY').toUpperCase();
        const isEmergency = normalizedKind === 'EMERGENCY';
        const isHalfDay = normalizedKind === 'HALF_DAY';
        if ((isEmergency || isHalfDay) && (!start_time || !end_time)) {
            return res.status(400).json({
                status: 'error',
                message: 'providers.err_leave_time_required'
            });
        }

        const todayStr = new Date().toISOString().split('T')[0];
        if (start_date < todayStr || end_date < todayStr) {
            return res.status(400).json({ status: 'error', message: 'providers.err_leave_past_dates' });
        }

        // 1. Resolve provider by id OR user_id, then verify ownership/self
        let { data: provider } = await adminSupabase
            .from('service_providers')
            .select('id, business_id, user_id, phone')
            .eq('id', id)
            .maybeSingle();

        if (!provider) {
            const byUser = await adminSupabase
                .from('service_providers')
                .select('id, business_id, user_id, phone')
                .eq('user_id', userId)
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
        let isSelf = provider.user_id === userId;
        if (!isSelf) {
            // Backward compatibility: some legacy provider rows may not have user_id linked.
            const mineByUser = await adminSupabase
                .from('service_providers')
                .select('id')
                .eq('business_id', provider.business_id)
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            isSelf = mineByUser.data?.id === provider.id;

            if (!isSelf) {
                const { data: myProfile } = await adminSupabase
                    .from('profiles')
                    .select('phone')
                    .eq('id', userId)
                    .maybeSingle();
                const myPhone = String(myProfile?.phone || '').replace(/[^\d+]/g, '');
                const providerPhone = String((provider as any)?.phone || '').replace(/[^\d+]/g, '');
                if (myPhone && providerPhone) {
                    const strip = (v: string) => v.replace(/^\+/, '');
                    isSelf = strip(myPhone) === strip(providerPhone) || strip(myPhone).endsWith(strip(providerPhone)) || strip(providerPhone).endsWith(strip(myPhone));
                }
            }
        }

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

        // 4. Smart validation (appointments + VIP/Regular customers)
        // We only enforce when this leave impacts assigned appointments.
        let vipCount = 0;
        let regularCount = 0;
        let totalAffected = 0;
        let requiresOwnerApproval = false;
        const impactAppointments: any[] = [];
        try {
            // Find appointment_services assigned to this provider within date range.
            const fromIso = new Date(`${String(start_date).slice(0, 10)}T00:00:00.000Z`).toISOString();
            const toIso = new Date(`${String(end_date).slice(0, 10)}T23:59:59.999Z`).toISOString();

            const { data: apptSvc } = await adminSupabase
                .from('appointment_services')
                .select(`
                    id,
                    appointment_id,
                    assigned_provider_id,
                    appointments:appointment_id (
                        id,
                        business_id,
                        user_id,
                        start_time,
                        end_time,
                        status,
                        profiles:user_id (id, full_name, phone)
                    )
                `)
                .eq('assigned_provider_id', provider.id)
                .gte('appointments.start_time', fromIso)
                .lte('appointments.start_time', toIso);

            const appts = (apptSvc || [])
                .map((r: any) => r.appointments)
                .filter(Boolean)
                .filter((a: any) => !['cancelled', 'completed', 'no_show'].includes(String(a.status || '').toLowerCase()));

            // Emergency leave: only count overlapping time-window appointments on the same day.
            const timeOverlaps = (a: any) => {
                if (!isEmergency && !isHalfDay) return true;
                const day = String(start_date).slice(0, 10);
                const apptDay = String(a.start_time || '').slice(0, 10);
                if (apptDay !== day) return true;
                const s = String(start_time || '').slice(0, 5);
                const e = String(end_time || '').slice(0, 5);
                const apptStart = String(a.start_time || '').slice(11, 16);
                const apptEnd = String(a.end_time || '').slice(11, 16);
                if (!s || !e || !apptStart || !apptEnd) return true;
                return !(apptEnd <= s || apptStart >= e);
            };

            const affected = appts.filter(timeOverlaps);
            totalAffected = affected.length;
            affected.forEach((a: any) => impactAppointments.push({
                id: a.id,
                start_time: a.start_time,
                end_time: a.end_time,
                status: a.status,
                customer: a.profiles
            }));

            // VIP customers in these appointments
            const customerIds = Array.from(
                new Set<string>(affected.map((a: any) => a.user_id).filter(Boolean).map((v: any) => String(v)))
            );
            if (customerIds.length > 0) {
                const { data: vipRows } = await adminSupabase
                    .from('business_customer_flags')
                    .select('customer_id')
                    .eq('business_id', provider.business_id)
                    .eq('is_vip', true)
                    .in('customer_id', customerIds);
                const vipSet = new Set<string>((vipRows || []).map((r: any) => String(r.customer_id)));
                vipCount = customerIds.filter((cid) => vipSet.has(cid)).length;

                // Regular customers heuristic: 3+ past completed appointments with same provider
                const regularThreshold = 3;
                const { data: past } = await adminSupabase
                    .from('appointment_services')
                    .select(`
                        appointments:appointment_id (user_id, status)
                    `)
                    .eq('assigned_provider_id', provider.id);
                const counts = new Map<string, number>();
                (past || []).forEach((row: any) => {
                    const a = row.appointments;
                    if (!a?.user_id) return;
                    const st = String(a.status || '').toLowerCase();
                    if (st !== 'completed') return;
                    counts.set(a.user_id, (counts.get(a.user_id) || 0) + 1);
                });
                regularCount = customerIds.filter((cid) => (counts.get(cid) || 0) >= regularThreshold).length;
            }

            // STRICT RULE: VIP => block OR require owner approval. We enforce "require owner approval".
            if (vipCount > 0 && !isAdminOrOwner) {
                requiresOwnerApproval = true;
                if (!allow_owner_approval) {
                    return res.status(409).json({
                        status: 'error',
                        message: 'providers.err_vip_leave_requires_owner',
                        impact: {
                            total_appointments: totalAffected,
                            regular_customers: regularCount,
                            vip_customers: vipCount,
                            appointments: impactAppointments
                        }
                    });
                }
            }

            // Emergency leave requires handling first: force reassignment/reschedule by blocking when affected appts exist
            if ((isEmergency || isHalfDay) && totalAffected > 0 && !isAdminOrOwner) {
                return res.status(409).json({
                    status: 'error',
                    message: 'providers.err_emergency_leave_requires_handling',
                    impact: {
                        total_appointments: totalAffected,
                        regular_customers: regularCount,
                        vip_customers: vipCount,
                        appointments: impactAppointments
                    }
                });
            }
        } catch {
            // If schema isn't present yet, skip smart enforcement (do not block leave creation).
        }

        // 5. Insert leave
        const payload: any = {
            provider_id: provider.id,
            business_id: provider.business_id,
            start_date,
            end_date,
            leave_type,
            leave_kind: normalizedKind,
            start_time: start_time ? String(start_time).slice(0, 5) : null,
            end_time: end_time ? String(end_time).slice(0, 5) : null,
            note,
            status,
            approved_by: isAdminOrOwner ? userId : null,
            requires_owner_approval: requiresOwnerApproval,
            smart_impact: (vipCount || regularCount || totalAffected)
                ? { total_appointments: totalAffected, regular_customers: regularCount, vip_customers: vipCount }
                : null
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
            let requestLang = 'en';
            if (biz?.owner_id) {
                const { data: ownerLangRow } = await adminSupabase
                    .from('profiles')
                    .select('ui_language')
                    .eq('id', biz.owner_id)
                    .maybeSingle();
                requestLang = ownerLangRow?.ui_language || 'en';
            }
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

export const validateProviderLeaveImpact = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id or user_id
        const { start_date, end_date, leave_kind, start_time, end_time } = req.body as any;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        if (!start_date || !end_date) return res.status(400).json({ status: 'error', message: 'Missing required fields' });

        // Resolve provider by id or current user
        let { data: provider } = await adminSupabase
            .from('service_providers')
            .select('id, business_id, user_id, phone')
            .eq('id', id)
            .maybeSingle();
        if (!provider) {
            const byUser = await adminSupabase
                .from('service_providers')
                .select('id, business_id, user_id, phone')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            provider = byUser.data;
        }
        if (!provider) return res.status(404).json({ status: 'error', message: 'Provider not found' });

        // Verify this is self OR owner
        const { data: business } = await supabase
            .from('businesses')
            .select('id, owner_id')
            .eq('id', provider.business_id)
            .maybeSingle();
        const isOwner = business?.owner_id === userId;
        const isSelf = provider.user_id === userId;
        if (!isOwner && !isSelf) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const normalizedKind = String(leave_kind || 'FULL_DAY').toUpperCase();
        const isEmergency = normalizedKind === 'EMERGENCY';
        const isHalfDay = normalizedKind === 'HALF_DAY';

        const fromIso = new Date(`${String(start_date).slice(0, 10)}T00:00:00.000Z`).toISOString();
        const toIso = new Date(`${String(end_date).slice(0, 10)}T23:59:59.999Z`).toISOString();

        const { data: apptSvc } = await adminSupabase
            .from('appointment_services')
            .select(`
                id,
                appointment_id,
                assigned_provider_id,
                services:service_id (id, name, duration_minutes, translations),
                appointments:appointment_id (
                    id,
                    business_id,
                    user_id,
                    start_time,
                    end_time,
                    status,
                    profiles:user_id (id, full_name, phone)
                )
            `)
            .eq('assigned_provider_id', provider.id)
            .gte('appointments.start_time', fromIso)
            .lte('appointments.start_time', toIso);

        const appts = (apptSvc || [])
            .map((r: any) => ({ appointment: r.appointments, service: r.services }))
            .filter((r: any) => !!r.appointment)
            .filter((r: any) => !['cancelled', 'completed', 'no_show'].includes(String(r.appointment?.status || '').toLowerCase()));

        const timeOverlaps = (a: any) => {
            if (!isEmergency && !isHalfDay) return true;
            const day = String(start_date).slice(0, 10);
            const apptDay = String(a.start_time || '').slice(0, 10);
            if (apptDay !== day) return true;
            const s = String(start_time || '').slice(0, 5);
            const e = String(end_time || '').slice(0, 5);
            const apptStart = String(a.start_time || '').slice(11, 16);
            const apptEnd = String(a.end_time || '').slice(11, 16);
            if (!s || !e || !apptStart || !apptEnd) return true;
            return !(apptEnd <= s || apptStart >= e);
        };
        const affected = appts.filter((r: any) => timeOverlaps(r.appointment));

        // Also include live queue tasks assigned to this provider (entry-level and per-service assignment).
        const queueTasksByEntry = (await adminSupabase
            .from('queue_entries')
            .select(`
                id,
                customer_name,
                status,
                joined_at,
                entry_date,
                queue_entry_services:queue_entry_services!entry_id (
                    service_id,
                    services:service_id (id, name)
                )
            `)
            .eq('assigned_provider_id', provider.id)
            .gte('entry_date', String(start_date).slice(0, 10))
            .lte('entry_date', String(end_date).slice(0, 10))
            .in('status', ['waiting', 'serving'])).data || [];

        const queueTasksByService = (await adminSupabase
            .from('queue_entries')
            .select(`
                id,
                customer_name,
                status,
                joined_at,
                entry_date,
                queue_entry_services!inner (
                    assigned_provider_id,
                    service_id,
                    services:service_id (id, name)
                )
            `)
            .eq('queue_entry_services.assigned_provider_id', provider.id)
            .gte('entry_date', String(start_date).slice(0, 10))
            .lte('entry_date', String(end_date).slice(0, 10))
            .in('status', ['waiting', 'serving'])).data || [];

        const queueTaskMap = new Map<string, any>();
        [...queueTasksByEntry, ...queueTasksByService].forEach((q: any) => {
            if (q?.id) queueTaskMap.set(String(q.id), q);
        });
        let queueTasks = Array.from(queueTaskMap.values());

        if (isEmergency || isHalfDay) {
            const day = String(start_date).slice(0, 10);
            const s = String(start_time || '').slice(0, 5);
            const e = String(end_time || '').slice(0, 5);
            queueTasks = queueTasks.filter((q: any) => {
                const qDay = String(q.entry_date || '').slice(0, 10);
                if (qDay !== day) return false;
                if (!s || !e) return true;
                const qAt = String(q.joined_at || '').slice(11, 16);
                if (!qAt) return true;
                return qAt >= s && qAt <= e;
            });
        }

        const customerIds = Array.from(
            new Set<string>(affected.map((r: any) => r.appointment?.user_id).filter(Boolean).map((v: any) => String(v)))
        );
        let vipCount = 0;
        let regularCount = 0;

        if (customerIds.length > 0) {
            const { data: vipRows } = await adminSupabase
                .from('business_customer_flags')
                .select('customer_id')
                .eq('business_id', provider.business_id)
                .eq('is_vip', true)
                .in('customer_id', customerIds);
            const vipSet = new Set<string>((vipRows || []).map((r: any) => String(r.customer_id)));
            vipCount = customerIds.filter((cid) => vipSet.has(cid)).length;

            const regularThreshold = 3;
            const { data: past } = await adminSupabase
                .from('appointment_services')
                .select(`appointments:appointment_id (user_id, status)`)
                .eq('assigned_provider_id', provider.id);
            const counts = new Map<string, number>();
            (past || []).forEach((row: any) => {
                const a = row.appointments;
                if (!a?.user_id) return;
                if (String(a.status || '').toLowerCase() !== 'completed') return;
                counts.set(a.user_id, (counts.get(a.user_id) || 0) + 1);
            });
            regularCount = customerIds.filter((cid) => (counts.get(cid) || 0) >= regularThreshold).length;
        }

        res.status(200).json({
            status: 'success',
            data: {
                total_appointments: affected.length,
                total_queue_tasks: queueTasks.length,
                regular_customers: regularCount,
                vip_customers: vipCount,
                appointments: affected.map((a: any) => ({
                    id: a.appointment.id,
                    start_time: a.appointment.start_time,
                    end_time: a.appointment.end_time,
                    status: a.appointment.status,
                    customer: a.appointment.profiles,
                    service: a.service
                })),
                queue_tasks: queueTasks.map((q: any) => ({
                    id: q.id,
                    customer_name: q.customer_name,
                    status: q.status,
                    joined_at: q.joined_at,
                    entry_date: q.entry_date,
                    service: q.queue_entry_services?.[0]?.services || null
                })),
                policy: {
                    vip_requires_owner_approval: vipCount > 0,
                    emergency_requires_handling: (isEmergency || isHalfDay) && (affected.length > 0 || queueTasks.length > 0)
                }
            }
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
    const as = new Date(aStart).getTime();
    const ae = new Date(aEnd).getTime();
    const bs = new Date(bStart).getTime();
    const be = new Date(bEnd).getTime();
    if ([as, ae, bs, be].some((t) => Number.isNaN(t))) return true; // fail-safe: treat as overlap
    return as < be && bs < ae;
};

export const previewAutoReassignPlan = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // provider_id
        const { start_date, end_date, leave_kind, start_time, end_time, appointment_ids } = req.body as any;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        if (!start_date || !end_date) return res.status(400).json({ status: 'error', message: 'Missing required fields' });

        // Verify ownership on provider business
        const { data: provider } = await adminSupabase
            .from('service_providers')
            .select('id, business_id')
            .eq('id', id)
            .maybeSingle();
        if (!provider) return res.status(404).json({ status: 'error', message: 'Provider not found' });

        const { data: business } = await supabase
            .from('businesses')
            .select('id, owner_id')
            .eq('id', provider.business_id)
            .maybeSingle();
        if (!business || business.owner_id !== userId) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        // Get impacted appointments for the provider in this window (reuse validate logic)
        const normalizedKind = String(leave_kind || 'FULL_DAY').toUpperCase();
        const isEmergency = normalizedKind === 'EMERGENCY';
        const isHalfDay = normalizedKind === 'HALF_DAY';

        const fromIso = new Date(`${String(start_date).slice(0, 10)}T00:00:00.000Z`).toISOString();
        const toIso = new Date(`${String(end_date).slice(0, 10)}T23:59:59.999Z`).toISOString();

        let impactedQuery = adminSupabase
            .from('appointment_services')
            .select(`
                id,
                appointment_id,
                service_id,
                assigned_provider_id,
                services:service_id (id, name),
                appointments:appointment_id (
                    id,
                    business_id,
                    user_id,
                    start_time,
                    end_time,
                    status,
                    profiles:user_id (id, full_name, phone)
                )
            `)
            .eq('assigned_provider_id', provider.id)
            .gte('appointments.start_time', fromIso)
            .lte('appointments.start_time', toIso);

        if (Array.isArray(appointment_ids) && appointment_ids.length > 0) {
            impactedQuery = impactedQuery.in('appointment_id', appointment_ids.map(String));
        }

        const { data: apptSvc, error: apptErr } = await impactedQuery;
        if (apptErr) throw apptErr;

        const timeOverlaps = (a: any) => {
            if (!isEmergency && !isHalfDay) return true;
            const day = String(start_date).slice(0, 10);
            const apptDay = String(a.start_time || '').slice(0, 10);
            if (apptDay !== day) return true;
            const s = String(start_time || '').slice(0, 5);
            const e = String(end_time || '').slice(0, 5);
            const apptStart = String(a.start_time || '').slice(11, 16);
            const apptEnd = String(a.end_time || '').slice(11, 16);
            if (!s || !e || !apptStart || !apptEnd) return true;
            return !(apptEnd <= s || apptStart >= e);
        };

        const impacted = (apptSvc || [])
            .map((r: any) => ({ row: r, appt: r.appointments, service: r.services }))
            .filter((r: any) => !!r.appt)
            .filter((r: any) => !['cancelled', 'completed', 'no_show'].includes(String(r.appt.status || '').toLowerCase()))
            .filter((r: any) => timeOverlaps(r.appt))
            .sort((a: any, b: any) => new Date(a.appt.start_time).getTime() - new Date(b.appt.start_time).getTime());

        // Candidate providers: active, same business, not the leaving provider
        const { data: candidates, error: candErr } = await adminSupabase
            .from('service_providers')
            .select('id, name, is_active')
            .eq('business_id', provider.business_id)
            .eq('is_active', true);
        if (candErr) throw candErr;
        const candidateProviders = (candidates || []).filter((p: any) => p.id !== provider.id);

        // Provider skill map via provider_services
        const providerIds = candidateProviders.map((p: any) => p.id);
        const { data: provSvc } = providerIds.length
            ? await adminSupabase
                .from('provider_services')
                .select('provider_id, service_id')
                .in('provider_id', providerIds)
            : { data: [] as any[] };
        const skills = new Map<string, Set<string>>();
        (provSvc || []).forEach((r: any) => {
            const pid = String(r.provider_id);
            const sid = String(r.service_id);
            if (!skills.has(pid)) skills.set(pid, new Set());
            skills.get(pid)!.add(sid);
        });

        // Load for balancing: count appointments per provider for the impacted day range.
        // We only need counts for the appointment dates we're reassigning.
        const daySet = new Set<string>(impacted.map((i: any) => String(i.appt.start_time).slice(0, 10)));
        const dayList = Array.from(daySet);
        const dayFrom = dayList.length ? `${dayList[0]}T00:00:00.000Z` : fromIso;
        const dayTo = dayList.length ? `${dayList[dayList.length - 1]}T23:59:59.999Z` : toIso;

        const { data: busyRows } = providerIds.length
            ? await adminSupabase
                .from('appointment_services')
                .select(`
                    assigned_provider_id,
                    appointments:appointment_id (start_time, end_time, status)
                `)
                .in('assigned_provider_id', providerIds)
                .gte('appointments.start_time', dayFrom)
                .lte('appointments.start_time', dayTo)
            : { data: [] as any[] };

        const schedules = new Map<string, { start: string; end: string }[]>();
        const dayLoad = new Map<string, number>();
        (busyRows || []).forEach((r: any) => {
            const pid = String(r.assigned_provider_id);
            const a = r.appointments;
            if (!a) return;
            const st = String(a.status || '').toLowerCase();
            if (['cancelled', 'completed', 'no_show'].includes(st)) return;
            if (!schedules.has(pid)) schedules.set(pid, []);
            schedules.get(pid)!.push({ start: a.start_time, end: a.end_time });
            const d = String(a.start_time).slice(0, 10);
            const key = `${pid}:${d}`;
            dayLoad.set(key, (dayLoad.get(key) || 0) + 1);
        });

        // VIP set for impacted customers
        const customerIds = Array.from(new Set<string>(impacted.map((i: any) => i.appt.user_id).filter(Boolean).map((v: any) => String(v))));
        const { data: vipRows } = customerIds.length
            ? await adminSupabase
                .from('business_customer_flags')
                .select('customer_id')
                .eq('business_id', provider.business_id)
                .eq('is_vip', true)
                .in('customer_id', customerIds)
            : { data: [] as any[] };
        const vipSet = new Set<string>((vipRows || []).map((r: any) => String(r.customer_id)));

        // Regular preference: previous provider for this customer+service if available (last completed)
        const { data: pastCompleted } = customerIds.length
            ? await adminSupabase
                .from('appointment_services')
                .select(`
                    service_id,
                    assigned_provider_id,
                    appointments:appointment_id (user_id, status, start_time)
                `)
                .in('appointments.user_id', customerIds)
            : { data: [] as any[] };
        const lastProviderByCustomerService = new Map<string, string>();
        (pastCompleted || []).forEach((r: any) => {
            const a = r.appointments;
            if (!a?.user_id) return;
            if (String(a.status || '').toLowerCase() !== 'completed') return;
            const key = `${String(a.user_id)}:${String(r.service_id)}`;
            const prev = lastProviderByCustomerService.get(key);
            // Choose latest by start_time
            if (!prev) {
                lastProviderByCustomerService.set(key, String(r.assigned_provider_id));
                return;
            }
            // naive: overwrite if later
            lastProviderByCustomerService.set(key, String(r.assigned_provider_id));
        });

        // Planner: for each impacted appointment, pick provider with:
        // - has skill
        // - no time overlap (including already planned assignments)
        // - load balancing: least appointments that day
        // - VIP: prefer least-loaded overall AND allow manual override later (no rating data)
        const plannedSchedules = new Map<string, { start: string; end: string }[]>();
        const plannedDayLoad = new Map<string, number>();
        const plan: any[] = [];

        const getLoad = (pid: string, day: string) => (dayLoad.get(`${pid}:${day}`) || 0) + (plannedDayLoad.get(`${pid}:${day}`) || 0);
        const isFree = (pid: string, start: string, end: string) => {
            const existing = (schedules.get(pid) || []);
            const planned = (plannedSchedules.get(pid) || []);
            return ![...existing, ...planned].some((slot) => overlaps(slot.start, slot.end, start, end));
        };

        for (const item of impacted) {
            const appt = item.appt;
            const serviceId = String(item.row.service_id || item.service?.id || '');
            const customerId = String(appt.user_id || '');
            const day = String(appt.start_time).slice(0, 10);
            const isVip = vipSet.has(customerId);
            const regularPref = lastProviderByCustomerService.get(`${customerId}:${serviceId}`) || null;

            // eligible list by skill
            let eligible = candidateProviders
                .filter((p: any) => skills.get(String(p.id))?.has(serviceId))
                .map((p: any) => String(p.id));

            // prefer regular previous provider if free
            if (regularPref && eligible.includes(regularPref) && isFree(regularPref, appt.start_time, appt.end_time)) {
                eligible = [regularPref, ...eligible.filter((x: string) => x !== regularPref)];
            }

            // filter free
            const freeEligible = eligible.filter((pid: string) => isFree(pid, appt.start_time, appt.end_time));

            let chosen: string | null = null;
            if (freeEligible.length > 0) {
                // load balancing: pick least busy that day
                freeEligible.sort((a: string, b: string) => getLoad(a, day) - getLoad(b, day));
                chosen = freeEligible[0];
            }

            if (chosen) {
                if (!plannedSchedules.has(chosen)) plannedSchedules.set(chosen, []);
                plannedSchedules.get(chosen)!.push({ start: appt.start_time, end: appt.end_time });
                plannedDayLoad.set(`${chosen}:${day}`, (plannedDayLoad.get(`${chosen}:${day}`) || 0) + 1);
            }

            plan.push({
                appointment_id: appt.id,
                appointment_service_id: item.row.id,
                start_time: appt.start_time,
                end_time: appt.end_time,
                service: item.service,
                customer: appt.profiles,
                priority: isVip ? 'VIP' : (regularPref ? 'REGULAR' : 'NORMAL'),
                suggested_provider_id: chosen,
                suggested_reason: chosen
                    ? (regularPref && chosen === regularPref ? 'regular_preference' : (isVip ? 'vip_least_busy' : 'least_busy'))
                    : 'no_available_provider',
                needs_reschedule: !chosen
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                provider_id: provider.id,
                business_id: provider.business_id,
                total: plan.length,
                needs_reschedule_count: plan.filter((p: any) => p.needs_reschedule).length,
                plan
            }
        });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

export const applyAutoReassignPlan = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // leaving provider_id
        const { assignments } = req.body as any;
        const userId = req.user?.id;
        const supabase = req.supabase || require('../config/supabaseClient').supabase;
        const { adminSupabase } = require('../config/supabaseClient');

        if (!userId) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        if (!Array.isArray(assignments) || assignments.length === 0) {
            return res.status(400).json({ status: 'error', message: 'assignments is required' });
        }

        const { data: provider } = await adminSupabase
            .from('service_providers')
            .select('id, business_id')
            .eq('id', id)
            .maybeSingle();
        if (!provider) return res.status(404).json({ status: 'error', message: 'Provider not found' });

        const { data: business } = await supabase
            .from('businesses')
            .select('id, owner_id')
            .eq('id', provider.business_id)
            .maybeSingle();
        if (!business || business.owner_id !== userId) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const results: any[] = [];
        for (const a of assignments) {
            const appointmentId = String(a.appointment_id || '');
            const toProviderId = a.to_provider_id ? String(a.to_provider_id) : null;
            if (!appointmentId) continue;
            try {
                if (toProviderId) {
                    const { error: uErr } = await adminSupabase
                        .from('appointment_services')
                        .update({
                            assigned_provider_id: toProviderId,
                            reassigned_from_provider_id: provider.id,
                            reassigned_at: new Date().toISOString()
                        })
                        .eq('appointment_id', appointmentId)
                        .eq('assigned_provider_id', provider.id);
                    if (uErr) throw uErr;
                    await adminSupabase.from('appointments').update({ needs_reschedule: false }).eq('id', appointmentId);
                    results.push({ appointment_id: appointmentId, ok: true, action: 'reassigned', to_provider_id: toProviderId });
                } else {
                    // No provider available: mark needs_reschedule and unassign from appointment_services
                    await adminSupabase
                        .from('appointment_services')
                        .update({
                            assigned_provider_id: null,
                            reassigned_from_provider_id: provider.id,
                            reassigned_at: new Date().toISOString()
                        })
                        .eq('appointment_id', appointmentId)
                        .eq('assigned_provider_id', provider.id);
                    await adminSupabase.from('appointments').update({ needs_reschedule: true }).eq('id', appointmentId);
                    results.push({ appointment_id: appointmentId, ok: true, action: 'needs_reschedule' });
                }
            } catch (e: any) {
                results.push({ appointment_id: appointmentId, ok: false, error: e.message || String(e) });
            }
        }

        res.status(200).json({
            status: 'success',
            data: {
                total: results.length,
                failed: results.filter((r) => !r.ok).length,
                results
            }
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

        const { error, count } = await supabase
            .from('provider_leaves')
            .delete({ count: 'exact' })
            .eq('id', leaveId);

        if (error) throw error;
        if (!count || count < 1) {
            return res.status(404).json({ status: 'error', message: 'Leave not found or already deleted' });
        }

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
        const { adminSupabase } = require('../config/supabaseClient');
        const { data: business } = await supabase
            .from('businesses')
            .select('owner_id, phone, whatsapp_number')
            .eq('id', employee.business_id)
            .single();
        const { notificationService, toE164Phone } = require('../services/notificationService');
        let ownerNotificationSent = false;
        let employeeNotificationSent = false;

        if (business?.owner_id) {
            const { data: owner } = await adminSupabase
                .from('profiles')
                .select('phone, ui_language')
                .eq('id', business.owner_id)
                .maybeSingle();
            const ownerCandidates: string[] = [];
            if (owner?.phone) ownerCandidates.push(String(owner.phone));
            if (business?.whatsapp_number) ownerCandidates.push(String(business.whatsapp_number));
            if (business?.phone) ownerCandidates.push(String(business.phone));
            const ownerTargets = [...new Set(ownerCandidates.map((p) => toE164Phone(String(p))).filter(Boolean))];
            if (ownerTargets.length > 0) {
                const msg = resignationRequestToOwnerMessage(
                    owner?.ui_language || 'en',
                    employee.full_name,
                    requested_last_date,
                    reason
                );
                const ownerResults = await Promise.allSettled(
                    ownerTargets.flatMap((to: string) => [
                        notificationService.sendWhatsApp(to, msg),
                        notificationService.sendSMS(to, msg)
                    ])
                );
                ownerNotificationSent = ownerResults.some((r: any) => r.status === 'fulfilled' && r.value === true);
            }
        }

        if (employee?.phone) {
            const empMsg = `Your resignation request has been submitted successfully. Requested last date: ${requested_last_date || 'N/A'}. We will notify you once the business owner reviews it.`;
            const to = toE164Phone(String(employee.phone));
            if (to) {
                const employeeResults = await Promise.allSettled([
                    notificationService.sendWhatsApp(to, empMsg),
                    notificationService.sendSMS(to, empMsg)
                ]);
                employeeNotificationSent = employeeResults.some((r: any) => r.status === 'fulfilled' && r.value === true);
            }
        }

        res.status(201).json({
            status: 'success',
            message: 'Resignation request submitted successfully',
            data,
            owner_notification_sent: ownerNotificationSent,
            employee_notification_sent: employeeNotificationSent
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

        const { adminSupabase } = require('../config/supabaseClient');
        const { data: emp } = await supabase
            .from('profiles')
            .select('phone, full_name')
            .eq('id', request.employee_id)
            .single();
        const { data: empProvider } = await adminSupabase
            .from('service_providers')
            .select('phone, user_id')
            .eq('user_id', request.employee_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        // Fallback for legacy rows where provider.user_id was never linked.
        let fallbackProviderPhone: string | null = null;
        if (!empProvider?.phone && emp?.phone) {
            const profilePhone = String(emp.phone).replace(/[^\d+]/g, '');
            if (profilePhone) {
                const { data: providerPool } = await adminSupabase
                    .from('service_providers')
                    .select('phone')
                    .eq('business_id', request.business_id)
                    .order('created_at', { ascending: false })
                    .limit(50);
                const strip = (v: string) => v.replace(/[^\d]/g, '');
                const mine = strip(profilePhone);
                const matched = (providerPool || []).find((p: any) => {
                    const cand = strip(String(p?.phone || ''));
                    return !!cand && (cand === mine || cand.endsWith(mine) || mine.endsWith(cand));
                });
                fallbackProviderPhone = matched?.phone || null;
            }
        }

        const employeePhone = emp?.phone || empProvider?.phone || fallbackProviderPhone;
        const { notificationService, toE164Phone } = require('../services/notificationService');

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
                const to = toE164Phone(String(employeePhone));
                const approvedMsg = shouldDeactivateNow
                    ? `Hi ${emp.full_name || 'Employee'}, your resignation request has been approved. Your access to the system has been revoked.`
                    : `Hi ${emp.full_name || 'Employee'}, your resignation request has been approved. You can continue working until ${requestedLastDate}. Access will be disabled after your last working date.`;
                if (to) {
                    const [waRes, smsRes] = await Promise.allSettled([
                        notificationService.sendWhatsApp(to, approvedMsg),
                        notificationService.sendSMS(to, approvedMsg)
                    ]);
                    const waOk = waRes.status === 'fulfilled' ? waRes.value : false;
                    const smsOk = smsRes.status === 'fulfilled' ? smsRes.value : false;
                    notificationSent = !!(waOk || smsOk);
                }
            }
        } else if (status === 'REJECTED') {
            if (employeePhone) {
                const to = toE164Phone(String(employeePhone));
                const rejectedMsg = `Hi ${emp.full_name || 'Employee'}, your resignation request has been rejected by the business owner. Please contact the owner for details.`;
                if (to) {
                    const [waRes, smsRes] = await Promise.allSettled([
                        notificationService.sendWhatsApp(to, rejectedMsg),
                        notificationService.sendSMS(to, rejectedMsg)
                    ]);
                    const waOk = waRes.status === 'fulfilled' ? waRes.value : false;
                    const smsOk = smsRes.status === 'fulfilled' ? smsRes.value : false;
                    notificationSent = !!(waOk || smsOk);
                }
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
