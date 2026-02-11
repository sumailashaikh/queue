
async function testGoogle() {
    console.log('Fetching google.com...');
    try {
        const res = await fetch('https://www.google.com');
        console.log('Google Status:', res.status);
    } catch (e) {
        console.error('Google Fetch Failed:', e);
    }
}
testGoogle();
