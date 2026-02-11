
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

// Twilio Implementation (Placeholder)
class TwilioNotificationService implements NotificationService {
    async sendSMS(to: string, message: string): Promise<boolean> {
        // TODO: Implement Twilio
        console.log(`[Twilio SMS] To: ${to}, Message: ${message}`);
        return true;
    }

    async sendWhatsApp(to: string, message: string): Promise<boolean> {
        // TODO: Implement Twilio WhatsApp
        console.log(`[Twilio WhatsApp] To: ${to}, Message: ${message}`);
        return true;
    }
}

// Export a singleton instance
// Change to 'new TwilioNotificationService()' when ready
export const notificationService = new MockNotificationService();
