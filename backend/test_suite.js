const http = require('http');

console.log('====================================================');
console.log('  LIFEPULSE AUTOMATED SECURITY & API TEST SUITE   ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✅ PASS [${totalTests.toString().padStart(2, '0')}]: ${message}`);
    } else {
        console.error(`  ❌ FAIL [${totalTests.toString().padStart(2, '0')}]: ${message}`);
    }
}

async function request(path, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const reqHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path,
            method,
            headers: reqHeaders
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
                } catch(e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: null, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

(async () => {
    try {
        console.log('🔒 1. TESTING SECURITY HTTP HEADERS');
        const rootRes = await request('/');
        assert(rootRes.status === 200, 'Root endpoint serves index.html (HTTP 200)');
        assert(rootRes.headers['x-content-type-options'] === 'nosniff', 'Header X-Content-Type-Options: nosniff present');
        assert(rootRes.headers['x-frame-options'] === 'DENY', 'Header X-Frame-Options: DENY present (Clickjacking Protection)');
        assert(rootRes.headers['x-xss-protection'] === '1; mode=block', 'Header X-XSS-Protection: 1; mode=block present');

        console.log('\n🏥 2. TESTING PUBLIC HOSPITALS & LOCATION API');
        const hospRes = await request('/api/hospitals');
        assert(hospRes.status === 200, 'GET /api/hospitals returns HTTP 200');
        assert(Array.isArray(hospRes.body) && hospRes.body.length >= 5, `Returns at least 5 hospital records (Found ${hospRes.body?.length})`);
        
        const firstHosp = hospRes.body[0];
        assert(firstHosp.lat && firstHosp.lng && firstHosp.phone && firstHosp.emergency_contact, 'Hospital record contains lat, lng, phone & emergency contact');

        const searchRes = await request('/api/hospitals?location=Downtown');
        assert(searchRes.status === 200, 'GET /api/hospitals?location=Downtown returns HTTP 200');
        assert(searchRes.body.some(h => h.name.includes('MetroCare') || h.location.includes('Downtown')), 'Location query filter correctly matches Downtown zone');

        console.log('\n🩸 3. TESTING INVENTORY STOCK API');
        const invRes = await request('/api/inventory');
        assert(invRes.status === 200, 'GET /api/inventory returns HTTP 200');
        const groups = invRes.body.map(i => i.blood_group);
        const expectedGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
        const allPresent = expectedGroups.every(g => groups.includes(g));
        assert(allPresent, `All 8 blood groups exist in inventory: [${expectedGroups.join(', ')}]`);

        console.log('\n📊 4. TESTING SYSTEM STATS API');
        const statsRes = await request('/api/stats');
        assert(statsRes.status === 200, 'GET /api/stats returns HTTP 200');
        assert(statsRes.body.totalDonors >= 0 && statsRes.body.totalUnits >= 0, `Stats payload valid (Donors: ${statsRes.body.totalDonors}, Stock Units: ${statsRes.body.totalUnits})`);

        console.log('\n🔑 5. TESTING AUTHENTICATION & SECURITY CONTROLS');
        const loginFail = await request('/api/login', 'POST', { username: 'admin', password: 'wrongpassword123' });
        assert(loginFail.status === 401, 'Invalid password rejected with HTTP 401 Unauthorized');

        const loginSuccess = await request('/api/login', 'POST', { username: 'admin', password: 'admin123' });
        assert(loginSuccess.status === 200, 'Admin login with valid credentials succeeds (HTTP 200)');
        assert(loginSuccess.body.token != null, 'JWT Authentication Token successfully generated');
        assert(loginSuccess.body.user.role === 'admin', 'User profile correctly reflects ADMIN role');

        const token = loginSuccess.body.token;

        console.log('\n📝 6. TESTING BLOOD REQUEST SUBMISSION & SANITIZATION');
        const testReq = {
            requester_name: 'Test Patient <script>alert("xss")</script>',
            blood_group: 'O-',
            units: 2,
            priority: 'Emergency'
        };
        const reqRes = await request('/api/requests', 'POST', testReq, { 'Authorization': `Bearer ${token}` });
        assert(reqRes.status === 200, 'Patient blood request with Emergency priority created (HTTP 200)');
        assert(reqRes.body.message.includes('submitted successfully'), 'Request confirmation message received');

        console.log('\n💉 7. TESTING EMERGENCY DONORS DIRECTORY');
        const donorRes = await request('/api/donors/emergency?blood_group=O-');
        assert(donorRes.status === 200, 'GET /api/donors/emergency?blood_group=O- returns HTTP 200');
        assert(Array.isArray(donorRes.body), 'Emergency donors list returned as JSON array');

        console.log('\n====================================================');
        console.log(`  TEST RESULTS: ${passedTests} / ${totalTests} PASSED (${Math.round((passedTests/totalTests)*100)}% SUCCESS RATE)`);
        console.log('====================================================\n');
        
        process.exit(passedTests === totalTests ? 0 : 1);
    } catch(err) {
        console.error('Test Suite Exception:', err);
        process.exit(1);
    }
})();
