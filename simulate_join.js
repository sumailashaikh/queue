const axios = require('axios');

async function simulateJoin() {
    const url = 'http://127.0.0.1:4000/api/public/queue/join';
    const data = {
        queue_id: 'a51114bb-7a97-4ee4-997d-1d59397a8ed8', // Facial queue
        customer_name: 'Test Customer',
        phone: '+910000000000',
        service_ids: ['df2954e6-5203-46d9-b901-763b5df95e31'], // Facial service
        entry_source: 'online'
    };

    try {
        const response = await axios.post(url, data);
        console.log('SUCCESS:', response.data);
    } catch (error) {
        if (error.response) {
            console.log('REJECTED:', error.response.status, error.response.data);
        } else {
            console.log('ERROR:', error.message);
        }
    }
}

simulateJoin();
