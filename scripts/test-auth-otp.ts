// import fetch from 'node-fetch'; // Native fetch in Node 18+
export { };



import readline from 'readline';

const BASE_URL = 'http://127.0.0.1:4000/api/auth';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

const testAuth = async () => {
    try {
        let phone = '';
        while (true) {
            const phoneInput = await askQuestion('Enter Phone Number (with Country Code, e.g., +91...): ');
            phone = phoneInput.trim();
            if (/^\+\d{10,15}$/.test(phone)) {
                break;
            }
            console.log('Invalid format. Phone number must start with "+" and include country code (e.g., +918320582350).');
        }

        console.log(`\nSending OTP to ${phone}...`);
        const sendRes = await fetch(`${BASE_URL}/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const sendData = await sendRes.json();
        console.log('Send OTP Status:', sendRes.status);
        console.log('Send OTP Response:', sendData);

        if (sendRes.status !== 200) {
            console.error('Failed to send OTP. Exiting.');
            rl.close();
            return;
        }

        const otpInput = await askQuestion('\nEnter the OTP you received: ');
        const otp = otpInput.trim();

        console.log(`\nVerifying OTP ${otp} for ${phone}...`);
        const verifyRes = await fetch(`${BASE_URL}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, otp })
        });
        const verifyData = await verifyRes.json();
        console.log('Verify OTP Status:', verifyRes.status);
        console.log('Verify OTP Response:', verifyData);

    } catch (error) {
        console.error('Test Error:', error);
    } finally {
        rl.close();
    }
};

testAuth();
