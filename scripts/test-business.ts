import readline from 'readline';

const BASE_URL = 'http://localhost:4000/api';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
}

let authToken = '';

const login = async () => {
    console.log('\n--- STEP 1: LOGIN ---');
    let phone = await askQuestion('Enter Phone Number (e.g., +91...): ');

    // Auto-add + if missing
    if (!phone.startsWith('+')) {
        console.log('Adding "+" prefix automatically...');
        phone = '+' + phone;
    }

    console.log(`Sending OTP to ${phone}...`);
    try {
        const sendRes = await fetch(`${BASE_URL}/auth/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const sendData = await sendRes.json();
        console.log('Send OTP Response:', sendData);

        if (sendRes.status !== 200) {
            console.error('Failed to send OTP. Exiting.');
            process.exit(1);
        }

        const otp = await askQuestion('Enter the OTP you received: ');

        const verifyRes = await fetch(`${BASE_URL}/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, otp })
        });
        const verifyData = await verifyRes.json();

        if (verifyRes.status === 200 && verifyData.data?.session?.access_token) {
            authToken = verifyData.data.session.access_token;
            console.log('Login Successful! Token received.');
        } else {
            console.error('Login Failed:', verifyData);
            process.exit(1);
        }

    } catch (error) {
        console.error('Login Error:', error);
        process.exit(1);
    }
};

const createBusiness = async () => {
    console.log('\n--- STEP 2: CREATE BUSINESS ---');
    const name = await askQuestion('Enter Business Name (e.g., My Cool Salon): ');
    // Simple slugify
    const defaultSlug = name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
    const slugInput = await askQuestion(`Enter Business URL Slug (default: ${defaultSlug}): `);
    const slug = slugInput || defaultSlug;
    const address = await askQuestion('Enter Address (optional): ');

    console.log(`Creating business "${name}" with slug "${slug}"...`);

    try {
        const res = await fetch(`${BASE_URL}/businesses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, slug, address })
        });
        const data = await res.json();
        console.log('Create Business Response:', data);
    } catch (error) {
        console.error('Create Business Error:', error);
    }
};

const listBusinesses = async () => {
    console.log('\n--- STEP 3: LIST MY BUSINESSES ---');
    try {
        const res = await fetch(`${BASE_URL}/businesses/me`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await res.json();
        console.log('My Businesses:', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('List Businesses Error:', error);
    }
};

const run = async () => {
    await login();
    await createBusiness();
    await listBusinesses();
    rl.close();
};

run();
