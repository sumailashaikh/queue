import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// Interface for Notification Service
export interface NotificationService {
    sendSMS(to: string, message: string): Promise<boolean>;
    sendWhatsApp(to: string, message: string): Promise<boolean>;
}

// Mock Implementation (Console Log)
class MockNotificationService implements NotificationService {
    async sendSMS(to: string, message: string): Promise<boolean> {
        console.log(`[MOCK SMS] To: ${to}, Message: ${message}`);
        return true;
    }

    async sendWhatsApp(to: string, message: string): Promise<boolean> {
        console.log(`[MOCK WhatsApp] To: ${to}, Message: ${message}`);
        return true;
    }
}

// Twilio Implementation
class TwilioNotificationService implements NotificationService {
    private client: any;
    private fromNumber: string;

    constructor() {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const auth = process.env.TWILIO_AUTH_TOKEN;
        this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

        if (sid && sid.startsWith('AC') && auth) {
            this.client = twilio(sid, auth);
        } else {
            console.warn('⚠️ Twilio credentials missing or invalid (must start with AC). Notification service will fallback to mock.');
        }
    }

    async sendSMS(to: string, message: string): Promise<boolean> {
        if (!this.client) {
            console.log(`[FALLBACK SMS] To: ${to}, Message: ${message}`);
            return true;
        }

        try {
            await this.client.messages.create({
                body: message,
                from: this.fromNumber,
                to: to
            });
            return true;
        } catch (error) {
            console.error('[Twilio SMS Error]', error);
            return false;
        }
    }

    async sendWhatsApp(to: string, message: string): Promise<boolean> {
        if (!this.client) {
            console.log(`[FALLBACK WhatsApp] To: ${to}, Message: ${message}`);
            return true;
        }

        try {
            // WhatsApp requires 'whatsapp:' prefix
            const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
            const formattedFrom = this.fromNumber.startsWith('whatsapp:') ? this.fromNumber : `whatsapp:${this.fromNumber}`;

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
}

// Export a singleton instance
// Switch to real service only if valid config exists
export const notificationService = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_ACCOUNT_SID.startsWith('AC')
    ? new TwilioNotificationService()
    : new MockNotificationService();
