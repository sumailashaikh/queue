
import axios from 'axios';

const BASE_URL = 'http://localhost:4000';

async function testEndpoints() {
    console.log('🚀 Testing API Endpoints...');

    try {
        // 1. Health Check
        console.log('\nTesting Health Check...');
        const health = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Health Check Passed:', health.data);

        // 2. Public Queues (should fail with 404 if route wrong, or 200 with empty list)
        console.log('\nTesting Get Queues (Public/Protected?)...');
        try {
            const queues = await axios.get(`${BASE_URL}/api/queues`);
            console.log('✅ Get Queues Response:', queues.data);
        } catch (error: any) {
            console.log('ℹ️ Get Queues Failed (Expected if Auth required):', error.response?.status, error.response?.data);
        }

        // 3. Auth OTP (Dry run)
        console.log('\nTesting Auth Route Existence...');
        try {
            await axios.post(`${BASE_URL}/api/auth/otp`, {}); // Empty body to trigger validation error
        } catch (error: any) {
            if (error.response?.status === 400) {
                console.log('✅ Auth Route Exists (Got 400 Bad Request as expected for empty body)');
            } else {
                console.log('❌ Auth Route Error:', error.message);
            }
        }

    } catch (error: any) {
        console.error('❌ Server seems down or unreachable:', error.message);
    }
}

testEndpoints();
