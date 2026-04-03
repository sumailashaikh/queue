import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

/** Normalize to E.164 where possible (digits + optional leading +). */
export function toE164Phone(input: string): string {
    const raw = String(input || '').replace(/[^\d+]/g, '');
    if (!raw) return '';
    if (raw.startsWith('+')) return raw;
    // Common case: 10-digit local India number → +91
    if (/^\d{10}$/.test(raw)) return `+91${raw}`;
    if (/^91\d{10}$/.test(raw)) return `+${raw}`;
    return `+${raw.replace(/^\+/, '')}`;
}

export type SendChannelResult = { ok: boolean; channel: 'sms' | 'whatsapp'; error?: string };

// Interface for Notification Service
export interface NotificationService {
    isMock: boolean;
    sendSMS(to: string, message: string): Promise<boolean>;
    sendWhatsApp(to: string, message: string): Promise<boolean>;
    sendInviteNotification(to: string, message: string): Promise<{
        notified: boolean;
        sms: SendChannelResult;
        whatsapp: SendChannelResult;
    }>;
}

// Mock Implementation (Console Log)
class MockNotificationService implements NotificationService {
    isMock = true;
    async sendSMS(to: string, message: string): Promise<boolean> {
        console.log(`[MOCK SMS] To: ${to}, Message: ${message}`);
        return true;
    }

    async sendWhatsApp(to: string, message: string): Promise<boolean> {
        console.log(`[MOCK WhatsApp] To: ${to}, Message: ${message}`);
        return true;
    }

    async sendInviteNotification(to: string, message: string) {
        await this.sendSMS(to, message);
        await this.sendWhatsApp(to, message);
        return {
            notified: true,
            sms: { ok: true, channel: 'sms' as const },
            whatsapp: { ok: true, channel: 'whatsapp' as const }
        };
    }
}

// Twilio Implementation
function twilioErrorMessage(err: unknown): string {
    const e = err as any;
    const code = e?.code ?? e?.status;
    const msg = e?.message || String(err);
    return code ? `${msg} (code ${code})` : msg;
}

class TwilioNotificationService implements NotificationService {
    isMock = false;
    private client: any;
    private fromNumber: string;
    private messagingServiceSid: string;
    private whatsappFrom: string;

    constructor() {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const auth = process.env.TWILIO_AUTH_TOKEN;
        this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
        this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
        // Optional: dedicated WhatsApp-enabled sender (sandbox or approved WA number)
        this.whatsappFrom =
            process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_PHONE_NUMBER || '';

        if (sid && sid.startsWith('AC') && auth) {
            this.client = twilio(sid, auth);
        } else {
            console.warn('⚠️ Twilio credentials missing or invalid (must start with AC). Notification service will fallback to mock.');
        }
    }

    async sendSMS(to: string, message: string): Promise<boolean> {
        const e164 = toE164Phone(to);
        if (!this.client) {
            console.log(`[FALLBACK SMS] To: ${e164}, Message: ${message}`);
            return true;
        }

        try {
            const payload: Record<string, string> = {
                body: message,
                to: e164
            };
            if (this.messagingServiceSid && this.messagingServiceSid.startsWith('MG')) {
                payload.messagingServiceSid = this.messagingServiceSid;
            } else if (this.fromNumber) {
                payload.from = this.fromNumber;
            } else {
                console.error('[Twilio SMS] Missing TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID');
                return false;
            }
            await this.client.messages.create(payload);
            return true;
        } catch (error) {
            console.error('[Twilio SMS Error]', error);
            return false;
        }
    }

    async sendWhatsApp(to: string, message: string): Promise<boolean> {
        const e164 = toE164Phone(to);
        if (!this.client) {
            console.log(`[FALLBACK WhatsApp] To: ${e164}, Message: ${message}`);
            return true;
        }

        try {
            // WhatsApp requires 'whatsapp:' prefix
            const formattedTo = e164.startsWith('whatsapp:') ? e164 : `whatsapp:${e164}`;
            const baseFrom = this.whatsappFrom || this.fromNumber;
            if (!baseFrom) {
                console.error('[Twilio WhatsApp] Missing TWILIO_WHATSAPP_FROM / TWILIO_PHONE_NUMBER');
                return false;
            }
            const formattedFrom = baseFrom.startsWith('whatsapp:') ? baseFrom : `whatsapp:${baseFrom}`;

            await this.client.messages.create({
                body: message,
                from: formattedFrom,
                to: formattedTo
            });
            return true;
        } catch (error) {
            console.error('[Twilio WhatsApp Error]', error);
            return false;
        }
    }

    /**
     * Employee invites: try SMS first (usually works with standard numbers),
     * then WhatsApp (needs WA-enabled sender / sandbox opt-in).
     */
    async sendInviteNotification(to: string, message: string) {
        const e164 = toE164Phone(to);
        let smsOk = false;
        let whatsappOk = false;
        let smsErr: string | undefined;
        let waErr: string | undefined;

        if (!this.client) {
            console.log(`[FALLBACK invite notify] To: ${e164}`);
            return {
                notified: true,
                sms: { ok: true, channel: 'sms' as const },
                whatsapp: { ok: true, channel: 'whatsapp' as const }
            };
        }

        try {
            const payload: Record<string, string> = {
                body: message,
                to: e164
            };
            if (this.messagingServiceSid && this.messagingServiceSid.startsWith('MG')) {
                payload.messagingServiceSid = this.messagingServiceSid;
            } else if (this.fromNumber) {
                payload.from = this.fromNumber;
            } else {
                smsErr = 'Missing TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID';
            }
            if (!smsErr) {
                await this.client.messages.create(payload);
                smsOk = true;
            }
        } catch (err) {
            smsErr = twilioErrorMessage(err);
            console.error('[Twilio SMS invite]', smsErr);
        }

        try {
            const formattedTo = `whatsapp:${e164}`;
            const baseFrom = this.whatsappFrom || this.fromNumber;
            if (!baseFrom) {
                waErr = 'Missing TWILIO_WHATSAPP_FROM / TWILIO_PHONE_NUMBER';
            } else {
                const formattedFrom = baseFrom.startsWith('whatsapp:') ? baseFrom : `whatsapp:${baseFrom}`;
                await this.client.messages.create({
                    body: message,
                    from: formattedFrom,
                    to: formattedTo
                });
                whatsappOk = true;
            }
        } catch (err) {
            waErr = twilioErrorMessage(err);
            console.error('[Twilio WhatsApp invite]', waErr);
        }

        return {
            notified: smsOk || whatsappOk,
            sms: { ok: smsOk, channel: 'sms' as const, error: smsErr },
            whatsapp: { ok: whatsappOk, channel: 'whatsapp' as const, error: waErr }
        };
    }
}

// Export a singleton instance
// Switch to real service only if valid config exists
export const notificationService = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID.startsWith('AC')
    ? new TwilioNotificationService()
    : new MockNotificationService();
