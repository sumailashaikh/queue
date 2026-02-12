
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = `http://localhost:${process.env.PORT || 4000}/api`;

async function verify() {
    console.log('--- VERIFYING QUEUE ENTRY STATUS UPDATE ---');

    // Note: This script requires a valid auth token and an existing entry ID.
    // In a real scenario, we'd automate the login, but for a quick check, 
    // we can ask the user or look at the logs if we just ran an action.

    const token = process.argv[2];
    const entryId = process.argv[3];
    const status = process.argv[4] || 'serving';

    if (!token || !entryId) {
        console.log('Usage: npx ts-node scripts/test-queue-update.ts <TOKEN> <ENTRY_ID> [STATUS]');
        return;
    }

    try {
        console.log(`Updating entry ${entryId} to status: ${status}...`);
        const response = await axios.put(`${BASE_URL}/queues/entries/${entryId}/status`,
            { status },
            { headers: { Authorization: `Bearer ${token}` } }
        );

        console.log('Response Status:', response.status);
        console.log('Response Data:', JSON.stringify(response.data, null, 2));

        if (response.data.status === 'success') {
            console.log('\n✅ VERIFICATION SUCCESSFUL!');
        } else {
            console.log('\n❌ VERIFICATION FAILED!');
        }
    } catch (error: any) {
        console.error('\n❌ ERROR DURING VERIFICATION:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

verify();
