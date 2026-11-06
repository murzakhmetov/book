/**
 * Central Test Suite Runner
 */
const syntaxTest = require('./syntax.test');
const catalogTest = require('./catalog.test');
const logicTest = require('./logic.test');
const supabaseTest = require('./supabase.test');
const domTest = require('./dom.test');

async function main() {
  console.log('====================================================');
  console.log('   book_lovers.kz — Automated CI/CD Test Runner     ');
  console.log('====================================================\n');

  const startTime = Date.now();
  const results = [];

  const suites = [
    { name: '1. Syntax & Files Structure', fn: () => syntaxTest.run() },
    { name: '2. Catalog Data Integrity', fn: () => catalogTest.run() },
    { name: '3. Store Business Logic', fn: () => logicTest.run() },
    { name: '4. Supabase Live Integration', fn: () => supabaseTest.run() },
    { name: '5. DOM & Browser Verification', fn: () => domTest.run() }
  ];

  for (const suite of suites) {
    const t0 = Date.now();
    try {
      await suite.fn();
      results.push({ name: suite.name, status: 'PASS', duration: Date.now() - t0 });
    } catch (err) {
      results.push({ name: suite.name, status: 'FAIL', duration: Date.now() - t0, error: err.message });
      console.error(`\n❌ Error in suite "${suite.name}":\n`, err);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log('====================================================');
  console.log('                 TEST SUMMARY                       ');
  console.log('====================================================');
  results.forEach(r => {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${r.name.padEnd(35)} [${r.status}] (${r.duration}ms)`);
  });
  console.log('----------------------------------------------------');
  console.log(`Total: ${results.length} suites | Passed: ${passed} | Failed: ${failed} | Time: ${totalDuration}s`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
