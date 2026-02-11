import readline from 'readline';

const BASE_URL = 'http://127.0.0.1:4000/api';
console.log('Script running with BASE_URL:', BASE_URL);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
}

let authToken = '';
let businessId = '';
let queueId = '';

const login = async () => {
    console.log('\n--- STEP 1: LOGIN ---');
    let phone = await askQuestion('Enter Phone Number (e.g., 9999999999): ');

    // Auto-add +91 if missing (assuming India for now, or just +)
    if (!phone.startsWith('+')) {
        if (phone.length === 10) {
            phone = '+91' + phone;
        } else {
            phone = '+' + phone;
        }
        console.log(`Formatted phone to: ${phone}`);
    }

    console.log(`Sending OTP to ${phone}...`);
    try {
        const sendRes = await fetch(`${BASE_URL}/auth/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const sendData = await sendRes.json();

        if (sendRes.status !== 200) {
            console.error('Failed to send OTP:', sendData);
            process.exit(1);
        }
        console.log('OTP Sent!');

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

const setupBusiness = async () => {
    console.log('\n--- STEP 2: SETUP BUSINESS ---');
    try {
        // 1. Check if business exists
        // Using /me endpoint which should return businesses for the authenticated user
        const getRes = await fetch(`${BASE_URL}/businesses/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const getData = await getRes.json();

        console.log('Get Business Response:', getRes.status);

        if (getRes.status === 200 && getData.data) {
            // Handle array or single object
            const businesses = Array.isArray(getData.data) ? getData.data : [getData.data];

            if (businesses.length > 0) {
                console.log(`Found existing business: ${businesses[0].name}`);
                businessId = businesses[0].id;
            }
        }

        if (businessId) return;

        // 2. Create if not exists
        console.log('No business found. Creating one...');
        const name = `Test Business ${Date.now()}`;
        const slug = `test-biz-${Date.now()}`;

        const createRes = await fetch(`${BASE_URL}/businesses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, slug, address: 'Test Address', phone: '1234567890' })
        });
        const createData = await createRes.json();

        if (createRes.status === 201) {
            console.log('Business Created!');
            businessId = createData.data.id;
        } else {
            console.error('Failed to create business:', createData);
            process.exit(1);
        }

    } catch (error) {
        console.error('Business Setup Error:', error);
        process.exit(1);
    }
};

const setupQueue = async () => {
    console.log('\n--- STEP 3: SETUP QUEUE ---');
    try {
        // 1. Check for existing queues
        const getRes = await fetch(`${BASE_URL}/queues/my`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const getData = await getRes.json();

        if (getRes.status === 200 && getData.data && getData.data.length > 0) {
            console.log(`Found existing queue: ${getData.data[0].name}`);
            queueId = getData.data[0].id;
            return;
        }

        // 2. Create if not exists
        console.log('No queue found. Creating one...');
        const name = 'Live Queue Test';

        const createRes = await fetch(`${BASE_URL}/queues`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name, description: 'Testing Live View', status: 'open' })
        });
        const createData = await createRes.json();

        if (createRes.status === 201) {
            console.log('Queue Created!');
            queueId = createData.data.id;
        } else {
            console.error('Failed to create queue:', createData);
            process.exit(1);
        }

    } catch (error) {
        console.error('Queue Setup Error:', error);
        process.exit(1);
    }
};

const addCustomers = async () => {
    console.log('\n--- STEP 4: ADDING CUSTOMERS ---');
    const customers = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];

    for (const name of customers) {
        try {
            const res = await fetch(`${BASE_URL}/queues/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}` // Joining as owner just for simplicity, usually customers join
                },
                body: JSON.stringify({ queue_id: queueId, customer_name: name })
            });
            const data = await res.json();
            if (res.status === 201) {
                console.log(`Added ${name} to queue.`);
            } else {
                console.error(`Failed to add ${name}:`, data);
            }
        } catch (error) {
            console.error(`Error adding ${name}:`, error);
        }
    }
};

const printDetails = () => {
    console.log('\n--- DONE ---');
    console.log('Data seeded successfully!');
    console.log(`Queue ID: ${queueId}`);
    console.log(`Auth Token: ${authToken}`);
    console.log('\nTest the API with:');
    console.log(`GET ${BASE_URL}/queues/${queueId}/today`);
    console.log(`Header: Authorization: Bearer ${authToken}`);
};

const run = async () => {
    await login();
    await setupBusiness();
    await setupQueue();
    await addCustomers();
    printDetails();
    rl.close();
};

run();
