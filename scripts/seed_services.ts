import readline from 'readline';

const BASE_URL = 'http://127.0.0.1:4000/api';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
}

let ownerToken = '';
let businessId = '';
let serviceId = '';
let appointmentId = '';

const login = async () => {
    console.log('\n--- STEP 1: OWNER LOGIN ---');
    let phone = await askQuestion('Enter Owner Phone Number: ');

    if (!phone.startsWith('+')) {
        if (phone.length === 10) phone = '+91' + phone;
        else phone = '+' + phone;
    }

    // Send OTP
    await fetch(`${BASE_URL}/auth/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
    });

    const otp = await askQuestion('Enter OTP: ');

    const verifyRes = await fetch(`${BASE_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp })
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.data?.session) {
        console.error('Login Failed:', verifyData);
        process.exit(1);
    }

    ownerToken = verifyData.data.session.access_token;
    console.log('Owner Logged In.');
};

const setupBusiness = async () => {
    console.log('\n--- STEP 2: SETUP BUSINESS ---');
    const getRes = await fetch(`${BASE_URL}/businesses/me`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    const getData = await getRes.json();

    if (getData.data && getData.data.length > 0) {
        businessId = getData.data[0].id;
        console.log(`Using Business: ${getData.data[0].name}`);
    } else {
        console.log('Creating Business...');
        const createRes = await fetch(`${BASE_URL}/businesses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ownerToken}`
            },
            body: JSON.stringify({
                name: 'Service Test Salon',
                slug: `service-test-${Date.now()}`,
                address: '123 Test St',
                phone: '1234567890'
            })
        });
        const createData = await createRes.json();
        businessId = createData.data.id;
        console.log('Business Created.');
    }
};

const setupService = async () => {
    console.log('\n--- STEP 3: CREATE SERVICE ---');
    const res = await fetch(`${BASE_URL}/services`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
            name: 'Haircut',
            description: 'Standard Haircut',
            duration_minutes: 30,
            price: 500,
            business_id: businessId
        })
    });
    const data = await res.json();
    if (res.status === 201) {
        serviceId = data.data.id;
        console.log(`Service Created: ${data.data.name} (ID: ${serviceId})`);
    } else {
        console.error('Failed to create service:', data);
    }
};

const createAppointment = async () => {
    console.log('\n--- STEP 4: BOOK APPOINTMENT (As Customer) ---');
    // Ideally login as another user, but for speed using same user (self-booking)
    // In real app, anyone can book.

    const startTime = new Date();
    startTime.setHours(startTime.getHours() + 24); // Tomorrow
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 30);

    const res = await fetch(`${BASE_URL}/appointments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ownerToken}`
        },
        body: JSON.stringify({
            business_id: businessId,
            service_id: serviceId,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString()
        })
    });
    const data = await res.json();
    if (res.status === 201) {
        appointmentId = data.data.id;
        console.log(`Appointment Booked! ID: ${appointmentId}`);
    } else {
        console.error('Failed to book appointment:', data);
    }
};

const manageAppointment = async () => {
    console.log('\n--- STEP 5: MANAGE APPPOINTMENT (As Owner) ---');

    // 1. List
    const listRes = await fetch(`${BASE_URL}/appointments/business`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    const listData = await listRes.json();
    console.log(`Found ${listData.data?.length} appointments.`);

    // 2. Update Status
    console.log(`Confirming appointment ${appointmentId}...`);
    const updateRes = await fetch(`${BASE_URL}/appointments/${appointmentId}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
    });
    const updateData = await updateRes.json();
    console.log('Update Response:', updateData.message);
};

const run = async () => {
    await login();
    await setupBusiness();
    await setupService();
    await createAppointment();
    await manageAppointment();
    rl.close();
};

run();
