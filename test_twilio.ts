import { notificationService } from './src/services/notificationService';
import dotenv from 'dotenv';

dotenv.config();

async function testTwilio() {
    console.log('--- Twilio Notification Service Test ---');
    console.log('Account SID:', process.env.TWILIO_ACCOUNT_SID ? '✅ Found' : '❌ Missing');
    console.log('Auth Token:', process.env.TWILIO_AUTH_TOKEN ? '✅ Found' : '❌ Missing');
    console.log('From Number:', process.env.TWILIO_PHONE_NUMBER || '❌ Missing');

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.log('\n[INFO] Skipping real Twilio call because credentials are not set yet.');
        console.log('[INFO] Test will use the Mock/Fallback mode.');
    }

    const testNumber = '+910000000000'; // Placeholder
    const message = 'Hello! This is a test from your Queue App backend.';

    console.log('\nTesting SMS...');
    const smsResult = await notificationService.sendSMS(testNumber, message);
    console.log('SMS Result:', smsResult ? '✅ Success (or Mock Logged)' : '❌ Failed');

    console.log('\nTesting WhatsApp...');
    const waResult = await notificationService.sendWhatsApp(testNumber, message);
    console.log('WhatsApp Result:', waResult ? '✅ Success (or Mock Logged)' : '❌ Failed');

    console.log('\n--- Test Complete ---');
}

testTwilio().catch(console.error);
