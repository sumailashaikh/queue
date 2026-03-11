import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

async function debugTwilio() {
    console.log('--- Twilio Deep Debugger ---');

    // Get args or fallback to env
    const sid = process.argv[2] || process.env.TWILIO_ACCOUNT_SID;
    const auth = process.argv[3] || process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.argv[4] || process.env.TWILIO_PHONE_NUMBER;

    console.log('Using Account SID:', sid ? `${sid.substring(0, 5)}...` : '❌ Missing');
    console.log('Using Auth Token:', auth ? '✅ Provided' : '❌ Missing');

    if (!sid || !auth) {
        console.log('\n❌ Error: Please provide credentials.');
        console.log('Usage: npx ts-node test_twilio.ts <AccountSID> <AuthToken> <YourTwilioNumber>');
        return;
    }

    try {
        console.log('\n1. Initializing Twilio Client...');
        const client = twilio(sid, auth);

        console.log('2. Testing Authentication by fetching account details...');
        const account = await client.api.accounts(sid).fetch();

        console.log('\n✅ AUTHENTICATION SUCCESSFUL!');
        console.log('Account Name:', account.friendlyName);
        console.log('Account Status:', account.status);
        console.log('Account Type:', account.type);

        if (account.status !== 'active') {
            console.log('\n⚠️ WARNING: Your account is NOT active. Status is:', account.status);
            console.log('Please check your Twilio billing or verification status.');
        }

        if (fromPhone) {
            console.log('\n3. Testing SMS Sending...');
            // We use a safe test number that Twilio allows or just test the API shape
            console.log('Skipping actual SMS send to avoid charges, but auth is 100% working.');
        }

    } catch (error: any) {
        console.error('\n❌ AUTHENTICATION FAILED!');
        console.error('Error Code:', error.code);
        console.error('Error Message:', error.message);
        console.error('More Info:', error.moreInfo);

        if (error.code === 20003) {
            console.log('\n💡 DIAGNOSIS FOR 20003:');
            console.log('- Make sure you are using the "LIVE" credentials, not "TEST" credentials.');
            console.log('- Make sure you copied the entire string without spaces.');
            console.log('- Check if your Twilio account was suspended for compliance reasons.');
        }
    }
}

debugTwilio().catch(console.error);

