/**
 * Utility functions for business hours and time comparisons
 * Calculations are based on the business's configured timezone (defaulting to UTC)
 */

export type BusinessAvailabilityState = 'open' | 'closed' | 'emergency_closed';

export interface BusinessAvailabilityResult {
    isOpen: boolean;
    state: BusinessAvailabilityState;
    message?: string;
    currentTime?: string;
    opensAt?: string;
    closesAt?: string;
}

const availabilityText = (
    language: string,
    key: 'missing_business' | 'emergency_closed' | 'not_open_yet' | 'closed_for_day',
    params?: { time?: string }
) => {
    const l = String(language || 'en').toLowerCase();

    if (l === 'ar') {
        if (key === 'missing_business') return 'معلومات النشاط غير متوفرة.';
        if (key === 'emergency_closed') return 'النشاط مغلق مؤقتاً بسبب حالة طارئة. يرجى المحاولة بعد قليل.';
        if (key === 'not_open_yet') return `النشاط غير مفتوح بعد. يفتح عند ${params?.time || ''}.`;
        return `النشاط مغلق لهذا اليوم. تم الإغلاق عند ${params?.time || ''}.`;
    }
    if (l === 'hi') {
        if (key === 'missing_business') return 'व्यवसाय की जानकारी उपलब्ध नहीं है।';
        if (key === 'emergency_closed') return 'आपातकाल के कारण व्यवसाय अस्थायी रूप से बंद है। कृपया थोड़ी देर बाद पुनः प्रयास करें।';
        if (key === 'not_open_yet') return `व्यवसाय अभी खुला नहीं है। यह ${params?.time || ''} पर खुलेगा।`;
        return `व्यवसाय आज के लिए बंद हो गया है। यह ${params?.time || ''} पर बंद हुआ।`;
    }
    if (l === 'es') {
        if (key === 'missing_business') return 'Falta la información del negocio.';
        if (key === 'emergency_closed') return 'El negocio está cerrado temporalmente por una emergencia. Inténtalo de nuevo en breve.';
        if (key === 'not_open_yet') return `El negocio aún no está abierto. Abre a las ${params?.time || ''}.`;
        return `El negocio ya cerró por hoy. Cerró a las ${params?.time || ''}.`;
    }

    if (key === 'missing_business') return 'Business information is missing.';
    if (key === 'emergency_closed') return 'The business is temporarily closed due to an emergency. Please try again shortly.';
    if (key === 'not_open_yet') return `The business is not open yet. It opens at ${params?.time || ''}.`;
    return `The business is closed for the day. It closed at ${params?.time || ''}.`;
};

export const resolveBusinessAvailability = (bizInput: any, now: Date = new Date()): BusinessAvailabilityResult => {
    // 0. Handle array vs object
    const business = Array.isArray(bizInput) ? bizInput[0] : bizInput;

    if (!business) {
        return { isOpen: false, state: 'closed', message: availabilityText('en', 'missing_business') };
    }
    const uiLang = String(business?.language || 'en').toLowerCase();

    const normalize = (t: string) => (t && t.length === 5) ? `${t}:00` : t;
    const open = normalize(business.open_time || '09:00:00');
    const close = normalize(business.close_time || '21:00:00');

    // Emergency override should not mutate regular schedule timings.
    const emergencyUntil = business?.emergency_closed_until ? new Date(business.emergency_closed_until) : null;
    const emergencyActiveByTime = emergencyUntil instanceof Date && !Number.isNaN(emergencyUntil.getTime()) && emergencyUntil.getTime() > now.getTime();
    const emergencyActive =
        business?.is_emergency_closed === true ||
        business?.emergency_closure_active === true ||
        emergencyActiveByTime ||
        business?.is_closed === true;

    if (emergencyActive) {
        return {
            isOpen: false,
            state: 'emergency_closed',
            message: availabilityText(uiLang, 'emergency_closed'),
            opensAt: formatTime12(open),
            closesAt: formatTime12(close)
        };
    }

    // 2. Get current time in local timezone
    const istTimeStr = now.toLocaleTimeString('en-GB', {
        timeZone: business.timezone || 'UTC',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    console.log(`[resolveBusinessAvailability] Now: ${istTimeStr} | Open: ${open} | Close: ${close}`);

    // 3. Handle midnight crossover (e.g., open 10:00, close 02:00)
    const closesNextDay = close < open;

    if (closesNextDay) {
        // If it closes next day, it is closed ONLY between close time and open time.
        // e.g. close=02:00, open=10:00. Closed if current time is between 02:00 and 10:00.
        if (istTimeStr >= close && istTimeStr < open) {
            const displayOpen = formatTime12(open);
            return { isOpen: false, state: 'closed', message: availabilityText(uiLang, 'not_open_yet', { time: displayOpen }), currentTime: istTimeStr, opensAt: displayOpen, closesAt: formatTime12(close) };
        }
    } else {
        // Normal case (open 09:00, close 21:00)
        if (istTimeStr < open) {
            const displayOpen = formatTime12(open);
            return { isOpen: false, state: 'closed', message: availabilityText(uiLang, 'not_open_yet', { time: displayOpen }), currentTime: istTimeStr, opensAt: displayOpen, closesAt: formatTime12(close) };
        }
        if (istTimeStr >= close) {
            const displayClose = formatTime12(close);
            return { isOpen: false, state: 'closed', message: availabilityText(uiLang, 'closed_for_day', { time: displayClose }), currentTime: istTimeStr, opensAt: formatTime12(open), closesAt: displayClose };
        }
    }

    return { isOpen: true, state: 'open', currentTime: istTimeStr, opensAt: formatTime12(open), closesAt: formatTime12(close) };
};

export const isBusinessOpen = (bizInput: any): { isOpen: boolean; message?: string } => {
    const result = resolveBusinessAvailability(bizInput);
    return { isOpen: result.isOpen, message: result.message };
};


/**
 * Gets the current minutes since midnight in a specific timezone
 */
export const getLocalMinutes = (timezone: string = 'UTC', date: Date = new Date()): number => {
    const timeStr = date.toLocaleTimeString('en-GB', {
        timeZone: timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
};

/**
 * Gets the current date string (YYYY-MM-DD) in a specific timezone
 */
export const getLocalDateString = (timezone: string = 'UTC', date: Date = new Date()): string => {
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
};

/**
 * Converts HH:mm string to minutes since midnight
 */
export const parseTimeToMinutes = (timeStr: string): number => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60) + m;
};

/**
 * Checks if a service can be completed before the business closes
 * Logic:
 * estimated_start_time = max(current_time, last_estimated_end_in_queue)
 * estimated_end_time = estimated_start_time + total_service_duration
 * Reject if estimated_end_time > (closing_time - buffer_minutes)
 */
export const canCompleteBeforeClosing = (
    bizInput: any,
    currentWaitMins: number,
    serviceDurationMins: number,
    _graceBufferMins: number = 0
): { canJoin: boolean; finishTimeStr?: string; closingTimeStr?: string; message?: string } => {
    // 0. Handle array vs object
    const business = Array.isArray(bizInput) ? bizInput[0] : bizInput;

    if (!business) {
        return { canJoin: true }; // Fallback
    }

    const timezone = business.timezone || 'UTC';
    const nowMins = getLocalMinutes(timezone);
    const openMins = parseTimeToMinutes(business.open_time || '09:00:00');
    const closeTime = business.close_time || '21:00:00';
    let closeMins = parseTimeToMinutes(closeTime);

    const closesNextDay = closeMins < openMins;

    // Adjust closeMins if the business closes on the next day
    if (closesNextDay) {
        if (nowMins >= (openMins - 120)) { // 2 hour grace before opening to consider it "towards closing"
            closeMins += (24 * 60);
        }
    }

    const estimatedStartMins = nowMins + currentWaitMins;
    const estimatedEndMins = estimatedStartMins + serviceDurationMins;
    const hardLimitMins = closeMins;

    console.log(`[canCompleteBeforeClosing] Now: ${nowMins} | Wait: ${currentWaitMins} | Service: ${serviceDurationMins} | EstEnd: ${estimatedEndMins} | HardLimit: ${hardLimitMins} (Close: ${closeMins})`);

    if (estimatedEndMins > hardLimitMins) {
        const h = Math.floor(estimatedEndMins / 60) % 24;
        const m = estimatedEndMins % 60;
        const finishTimeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return {
            canJoin: false,
            finishTimeStr: formatTime12(finishTimeStr),
            closingTimeStr: formatTime12(closeTime),
            message: "We’re fully booked for today. Please select a slot for tomorrow."
        };
    }

    return { canJoin: true };
};

export const formatTime12 = (timeStr: string): string => {
    if (!timeStr) return "";
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]);
    const minutes = parts[1] || "00";
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
};
