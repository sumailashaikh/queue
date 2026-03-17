/**
 * Utility functions for business hours and time comparisons
 * Calculations are based on the business's configured timezone (defaulting to UTC)
 */

export const isBusinessOpen = (bizInput: any): { isOpen: boolean; message?: string } => {
    // 0. Handle array vs object
    const business = Array.isArray(bizInput) ? bizInput[0] : bizInput;

    if (!business) {
        return { isOpen: false, message: "Business information is missing." };
    }

    // 1. Check manual closure
    if (business.is_closed) {
        return { isOpen: false, message: "The business is currently closed by the owner." };
    }

    // 2. Get current time in local timezone
    const now = new Date();
    const istTimeStr = now.toLocaleTimeString('en-GB', {
        timeZone: business.timezone || 'UTC',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const normalize = (t: string) => (t && t.length === 5) ? `${t}:00` : t;
    const open = normalize(business.open_time || '09:00:00');
    const close = normalize(business.close_time || '21:00:00');

    console.log(`[isBusinessOpen] Now: ${istTimeStr} | Open: ${open} | Close: ${close}`);

    // 3. Handle midnight crossover (e.g., open 10:00, close 02:00)
    const closesNextDay = close < open;

    if (closesNextDay) {
        // If it closes next day, it is closed ONLY between close time and open time.
        // e.g. close=02:00, open=10:00. Closed if current time is between 02:00 and 10:00.
        if (istTimeStr >= close && istTimeStr < open) {
            const displayOpen = formatTime12(open);
            return { isOpen: false, message: `The business is not open yet. It opens at ${displayOpen}.` };
        }
    } else {
        // Normal case (open 09:00, close 21:00)
        if (istTimeStr < open) {
            const displayOpen = formatTime12(open);
            return { isOpen: false, message: `The business is not open yet. It opens at ${displayOpen}.` };
        }
        if (istTimeStr >= close) {
            const displayClose = formatTime12(close);
            return { isOpen: false, message: `The business is closed for the day. It closed at ${displayClose}.` };
        }
    }

    return { isOpen: true };
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
    bufferMins: number = 10 // Default 10 min buffer
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
    const limitMins = closeMins - bufferMins;

    console.log(`[canCompleteBeforeClosing] Now: ${nowMins} | Wait: ${currentWaitMins} | Service: ${serviceDurationMins} | EstEnd: ${estimatedEndMins} | Limit: ${limitMins} (Close: ${closeMins})`);

    if (estimatedEndMins > limitMins) {
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
