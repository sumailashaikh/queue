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
export type SendDeliveryResult = {
    notified: boolean;
    sms: SendChannelResult;
    whatsapp: SendChannelResult;
};

// Interface for Notification Service
export interface NotificationService {
    isMock: boolean;
    sendSMS(to: string, message: string): Promise<boolean>;
    sendWhatsApp(to: string, message: string): Promise<boolean>;
    sendMessageWithStatus(to: string, message: string): Promise<SendDeliveryResult>;
    sendInviteNotification(to: string, message: string, options?: {
        allowWhatsappFallback?: boolean;
    }): Promise<{
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
        // In mock mode keep behavior simple and successful.
        return this.sendMessageWithStatus(to, message);
    }

    async sendMessageWithStatus(to: string, message: string): Promise<SendDeliveryResult> {
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
    private inviteCooldownMs: number;
    private inviteLastAttemptByPhone: Map<string, number>;

    private readEnvSmart(key: string): string {
        if (process.env[key]) return String(process.env[key]);
        const hit = Object.keys(process.env).find((k) => String(k || '').trim() === key);
        return hit ? String(process.env[hit] || '') : '';
    }

    constructor() {
        const sid = this.readEnvSmart('TWILIO_ACCOUNT_SID');
        const auth = this.readEnvSmart('TWILIO_AUTH_TOKEN');
        this.fromNumber = this.readEnvSmart('TWILIO_PHONE_NUMBER');
        this.messagingServiceSid = this.readEnvSmart('TWILIO_MESSAGING_SERVICE_SID');
        // Optional: dedicated WhatsApp-enabled sender (sandbox or approved WA number)
        this.whatsappFrom = this.readEnvSmart('TWILIO_WHATSAPP_FROM') || this.fromNumber || '';
        this.inviteCooldownMs = Number(this.readEnvSmart('INVITE_NOTIFY_COOLDOWN_MS') || 120000);
        this.inviteLastAttemptByPhone = new Map();

        if (sid && sid.startsWith('AC') && auth) {
            this.client = twilio(sid, auth);
        } else {
            console.warn('⚠️ Twilio credentials missing or invalid (must start with AC). Notification service will fallback to mock.');
        }
    }

    async sendSMS(to: string, message: string): Promise<boolean> {
        const e164 = toE164Phone(to);
        if (!this.client) {
            console.error(`[Twilio SMS Disabled] Missing/invalid client. To: ${e164}`);
            return false;
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
            console.error(`[Twilio WhatsApp Disabled] Missing/invalid client. To: ${e164}`);
            return false;
        }

        try {
            // WhatsApp requires 'whatsapp:' prefix
            const formattedTo = e164.startsWith('whatsapp:') ? e164 : `whatsapp:${e164}`;
            const baseFrom = this.whatsappFrom || this.fromNumber;
            if (baseFrom) {
                const formattedFrom = baseFrom.startsWith('whatsapp:') ? baseFrom : `whatsapp:${baseFrom}`;
                await this.client.messages.create({
                    body: message,
                    from: formattedFrom,
                    to: formattedTo
                });
                return true;
            }
            if (this.messagingServiceSid && this.messagingServiceSid.startsWith('MG')) {
                await this.client.messages.create({
                    body: message,
                    messagingServiceSid: this.messagingServiceSid,
                    to: formattedTo
                });
                return true;
            }
            console.error('[Twilio WhatsApp] Missing TWILIO_WHATSAPP_FROM / TWILIO_PHONE_NUMBER or WhatsApp-enabled messaging service');
            return false;
        } catch (error) {
            console.error('[Twilio WhatsApp Error]', error);
            return false;
        }
    }

    /**
     * Employee invites: try SMS first (usually works with standard numbers),
     * then WhatsApp (needs WA-enabled sender / sandbox opt-in).
     */
    async sendInviteNotification(
        to: string,
        message: string,
        options?: { allowWhatsappFallback?: boolean }
    ) {
        const e164 = toE164Phone(to);
        const now = Date.now();
        const lastAttempt = this.inviteLastAttemptByPhone.get(e164) || 0;
        if (lastAttempt && now - lastAttempt < this.inviteCooldownMs) {
            return {
                notified: false,
                sms: {
                    ok: false,
                    channel: 'sms' as const,
                    error: `Invite cooldown active. Please retry after ${Math.ceil((this.inviteCooldownMs - (now - lastAttempt)) / 1000)}s.`
                },
                whatsapp: { ok: false, channel: 'whatsapp' as const, error: 'Invite cooldown active' }
            };
        }
        this.inviteLastAttemptByPhone.set(e164, now);

        const allowWhatsappFallback = options?.allowWhatsappFallback === true;
        let smsOk = false;
        let whatsappOk = false;
        let smsErr: string | undefined;
        let waErr: string | undefined;

        if (!this.client) {
            return {
                notified: false,
                sms: { ok: false, channel: 'sms' as const, error: 'Twilio client not initialized' },
                whatsapp: { ok: false, channel: 'whatsapp' as const, error: 'Twilio client not initialized' }
            };
        }

        try {
            const payload: Record<string, string> = { body: message, to: e164 };
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

        // Default invite policy: SMS only. WhatsApp fallback is opt-in.
        if (!smsOk && allowWhatsappFallback) {
            const smsErrBlob = String(smsErr || '').toLowerCase();
            // If daily limit is already hit, avoid spending another attempt.
            if (/63038|daily messages limit|maximum amount of messages per 24 hours/i.test(smsErrBlob)) {
                waErr = 'Skipped WhatsApp fallback because Twilio daily limit is already hit.';
            } else {
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
            }
        } else if (!smsOk) {
            waErr = 'WhatsApp fallback disabled for invite notifications.';
        }

        return {
            notified: smsOk || whatsappOk,
            sms: { ok: smsOk, channel: 'sms' as const, error: smsErr },
            whatsapp: { ok: whatsappOk, channel: 'whatsapp' as const, error: waErr }
        };
    }

    async sendMessageWithStatus(to: string, message: string): Promise<SendDeliveryResult> {
        const e164 = toE164Phone(to);
        let smsOk = false;
        let whatsappOk = false;
        let smsErr: string | undefined;
        let waErr: string | undefined;

        if (!this.client) {
            console.error(`[Twilio Invite Disabled] Missing/invalid client. To: ${e164}`);
            return {
                notified: false,
                sms: { ok: false, channel: 'sms' as const, error: 'Twilio client not initialized' },
                whatsapp: { ok: false, channel: 'whatsapp' as const, error: 'Twilio client not initialized' }
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
// Mock mode should be explicit (local/testing only), otherwise use Twilio service and return real failures.
const allowMock = String(process.env.ALLOW_MOCK_NOTIFICATIONS || '').toLowerCase() === 'true' || process.env.NODE_ENV === 'test';
export const notificationService = allowMock ? new MockNotificationService() : new TwilioNotificationService();
