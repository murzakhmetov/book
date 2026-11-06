/**
 * Live Supabase Integration Test
 */
const https = require('https');
const assert = require('assert');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://grazmukqoglnedyzlxue.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qSIoQs6qkLhT3z6tDXCPIw_PUPrZOlN';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUPABASE_URL);
    const headers = Object.assign({
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    }, options.headers || {});

    const req = https.request(url, {
      method: options.method || 'GET',
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function testStoreData() {
  const res = await request('/rest/v1/store_data?select=*');
  assert.strictEqual(res.status, 200, `store_data returned HTTP ${res.status}: ${res.body}`);
  const rows = JSON.parse(res.body);
  assert(Array.isArray(rows), 'store_data rows must be an array');
  const map = {};
  rows.forEach(r => map[r.key] = r.value);

  assert(map.settings, 'store_data must contain settings key');
  assert.strictEqual(map.settings.demoMode, false, 'settings.demoMode must be false in Supabase');
  assert(map.settings.phone, 'settings.phone must be set in Supabase');
  assert(map.settings.whatsapp, 'settings.whatsapp must be set in Supabase');

  assert(Array.isArray(map.products), 'store_data must contain products array');
  assert(map.products.length >= 40, `store_data must have at least 40 products, got ${map.products.length}`);
}

async function testReviewsTable() {
  const res = await request('/rest/v1/reviews?select=id,name,rating&limit=5');
  assert.strictEqual(res.status, 200, `reviews returned HTTP ${res.status}: ${res.body}`);
  const reviews = JSON.parse(res.body);
  assert(Array.isArray(reviews), 'reviews must be an array');
}

async function testCoversBucket() {
  const res = await request('/storage/v1/object/public/covers/cover-verify.png');
  assert.strictEqual(res.status, 200, `covers bucket public read returned HTTP ${res.status}`);
}

async function run() {
  console.log('Running Supabase Live Integration Tests...');
  await testStoreData();
  console.log('  ✓ Supabase public.store_data read successfully (settings & 40 products)');
  await testReviewsTable();
  console.log('  ✓ Supabase public.reviews table accessible and responding');
  await testCoversBucket();
  console.log('  ✓ Supabase Storage bucket "covers" public read confirmed');
  console.log('PASS: Supabase Live Integration\n');
}

if (require.main === module) {
  run().catch(e => {
    console.error('FAIL: Supabase Live Integration:', e.message);
    process.exit(1);
  });
}

module.exports = { run };
