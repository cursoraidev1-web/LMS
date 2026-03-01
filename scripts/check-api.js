/**
 * Quick script to test if the API is reachable. Run: node scripts/check-api.js
 * Make sure the backend is running (npm run dev) first.
 */
const base = process.env.API_URL || 'http://localhost:4000';

async function check() {
  console.log('Checking', base, '...\n');
  try {
    const r = await fetch(base + '/health');
    const ok = r.ok;
    const text = await r.text();
    console.log('GET /health:', ok ? 'OK' : 'FAIL', r.status);
    console.log('Response:', text);
    if (!ok) process.exit(1);
  } catch (e) {
    console.log('Error:', e.message);
    console.log('\nIs the backend running? Start it with: npm run dev');
    process.exit(1);
  }
  try {
    const r = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@test.com',
        password: 'wrong',
        organizationId: 'org_test_123',
      }),
    });
    const data = await r.json();
    console.log('\nPOST /api/v1/auth/login (wrong password):', r.status, data.message || data);
    if (r.status === 401 && data.message) {
      console.log('Backend is responding correctly.');
    }
  } catch (e) {
    console.log('Login request failed:', e.message);
  }
  console.log('\nDone. If /health worked, the backend is up.');
}

check();
