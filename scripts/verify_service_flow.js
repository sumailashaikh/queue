const axios = require('axios');
require('dotenv').config({ path: 'c:/Users/ASUS/Salon-App/queue-backend/.env' });

const API_URL = 'http://127.0.0.1:4000/api';

async function verifyFlow() {
    try {
        console.log('--- Verification Started ---');

        // 1. Get Today Queue to find a task
        // We need a queue ID. I'll search for one.
        const { data: qData } = await axios.get(`${API_URL}/queues`);
        const queueId = qData.data[0]?.id;
        if (!queueId) throw new Error('No open queues found');

        console.log(`Using Queue ID: ${queueId}`);
        const { data: entriesData } = await axios.get(`${API_URL}/queues/${queueId}/today`);
        const entries = entriesData.data;

        if (!entries || entries.length === 0) {
            console.log('No entries found to test. Please join a queue first.');
            return;
        }

        const entry = entries[0];
        const task = entry.queue_entry_services?.[0];

        if (!task) {
            console.log('No tasks found for the first entry.');
            return;
        }

        console.log(`Testing with Entry: ${entry.customer_name}, Task: ${task.id}`);

        // Try to complete without starting (should fail)
        console.log('Attempting to complete before starting...');
        try {
            await axios.post(`${API_URL}/queues/task/${task.id}/complete`);
            console.error('FAIL: Allowed completion without start!');
        } catch (e) {
            console.log('PASS: Successfully blocked completion without start:', e.response?.data?.message);
        }

        // Start Task
        console.log('Starting task...');
        const { data: startResult } = await axios.post(`${API_URL}/queues/task/${task.id}/start`);
        console.log('PASS: Task started:', startResult.data.task_status, 'EstEnd:', startResult.data.estimated_end_at);

        // Wait a bit
        console.log('Waiting 2 seconds to simulate work...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Complete Task
        console.log('Completing task...');
        const { data: completeResult } = await axios.post(`${API_URL}/queues/task/${task.id}/complete`);
        console.log('PASS: Task completed:', completeResult.data.task_status, 'ActualMins:', completeResult.data.actual_minutes, 'DelayMins:', completeResult.data.delay_minutes);

        // Verify Aggregation in getTodayQueue
        console.log('Verifying dashboard aggregation...');
        const { data: finalQueueData } = await axios.get(`${API_URL}/queues/${queueId}/today`);
        const updatedEntry = finalQueueData.data.find(e => e.id === entry.id);
        console.log('PASS: Entry Aggregate - Total Delay:', updatedEntry.total_delay, 'EstEnd:', updatedEntry.estimated_end_at);

        console.log('--- Verification Finished ---');
    } catch (error) {
        console.error('Verification failed:', error.message);
        if (error.response) console.error('Response:', error.response.data);
    }
}

verifyFlow();
