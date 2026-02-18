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

    // 3. Compare as strings (HH:mm:ss format allows direct string comparison)
    if (istTimeStr < open) {
        const displayOpen = formatTime12(open);
        return { isOpen: false, message: `The business is not open yet. It opens at ${displayOpen}.` };
    }

    if (istTimeStr > close) {
        const displayClose = formatTime12(close);
        return { isOpen: false, message: `The business is closed for the day. It closed at ${displayClose}.` };
    }

    return { isOpen: true };
};

export const formatTime12 = (timeStr: string): string => {
    if (!timeStr) return "";
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
};
