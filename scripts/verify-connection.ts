
const BASE_URL = 'http://127.0.0.1:4000/api/auth';

const verifyConnection = async () => {
    const phone = '+918320582350';
    console.log(`Testing connection to ${BASE_URL}/otp with phone: ${phone}`);
    try {
        const response = await fetch(`${BASE_URL}/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        console.log(`Response Status: ${response.status}`);
        const data = await response.json();
        console.log('Response Data:', data);

        if (response.status === 200) {
            console.log('SUCCESS: Connection established and OTP sent.');
        } else {
            console.log('SUCCESS: Connection established (server responded).');
        }
    } catch (error) {
        console.error('FAILURE: Connection failed.', error);
        process.exit(1);
    }
};

verifyConnection();
