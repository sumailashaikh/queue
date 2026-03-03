/**
 * Utility functions for business hours and time comparisons
 * All calculations are based on Asia/Kolkata (IST) timezone
 */

export const isBusinessOpen = (business: { open_time: string; close_time: string; is_closed: boolean }): { isOpen: boolean; message?: string } => {
    // 1. Check manual closure
    if (business.is_closed) {
        return { isOpen: false, message: "The business is currently closed by the owner." };
    }

    // 2. Get current time in Asia/Kolkata
    const now = new Date();
    const istTimeStr = now.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const normalize = (t: string) => (t && t.length === 5) ? `${t}:00` : t;
    const open = normalize(business.open_time || '09:00:00');
    const close = normalize(business.close_time || '21:00:00');

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
 * Gets the current minutes since midnight in IST
 */
export const getISTMinutes = (date: Date = new Date()): number => {
    const istTimeStr = date.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    const [h, m] = istTimeStr.split(':').map(Number);
    return (h * 60) + m;
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
    business: { close_time: string; open_time?: string },
    currentWaitMins: number,
    serviceDurationMins: number,
    bufferMins: number = 10 // Default 10 min buffer
): { canJoin: boolean; finishTimeStr?: string; closingTimeStr?: string; message?: string } => {
    const nowMins = getISTMinutes();
    const openMins = parseTimeToMinutes(business.open_time || '09:00:00'); // Use default if not provided
    let closeMins = parseTimeToMinutes(business.close_time);

    const closesNextDay = closeMins < openMins;

    // Adjust closeMins if the business closes on the next day
    if (closesNextDay) {
        // If current time is before the 'next day' closing time (e.g., 01:00 AM, closes 02:00 AM)
        // OR if current time is after the open time (e.g., 10:00 PM, closes 02:00 AM next day)
        // We need to determine if the closing time refers to today or tomorrow.
        if (nowMins >= openMins) {
            // If current time is after open time, the closing time is on the next day
            closeMins += (24 * 60);
        }
        // If nowMins < openMins (e.g., 01:00 AM, open 10:00 AM, close 02:00 AM),
        // then closeMins is already correct for the current day's early morning closing.
    }

    // estimated_start_time = max(current_time, last_estimated_end_in_queue)
    // currentWaitMins already represents (last_estimated_end_in_queue - current_time) if positive
    // So estimated_start_time = current_time + currentWaitMins
    const estimatedStartMins = nowMins + currentWaitMins;
    const estimatedEndMins = estimatedStartMins + serviceDurationMins;

    const limitMins = closeMins - bufferMins;

    if (estimatedEndMins > limitMins) {
        const h = Math.floor(estimatedEndMins / 60);
        const m = estimatedEndMins % 60;
        const finishTimeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        return {
            canJoin: false,
            finishTimeStr: formatTime12(finishTimeStr),
            closingTimeStr: formatTime12(business.close_time),
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
