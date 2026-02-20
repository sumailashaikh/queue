const axios = require('axios');

async function testBooking() {
    const data = {
        business_id: "714df895-21c5-4ec8-b697-85e9511fae3c",
        service_ids: ["4c3d0ed9-ffa9-449c-85d3-ba36c2105151"],
        start_time: "2026-02-21T10:00:00Z",
        customer_name: "Test User",
        phone: "919876543210"
    };

    try {
        const response = await axios.post('http://127.0.0.1:4000/api/public/appointment/book', data);
        console.log('Success:', response.status, response.data);
    } catch (error) {
        if (error.response) {
            console.error('Error:', error.response.status, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
    }
}

testBooking();
