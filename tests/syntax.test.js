/**
 * Syntax and structure validation test
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');

function testJsSyntax() {
  const jsFiles = [
    'js/app.js',
    'js/supabase.js',
    'js/supabase-config.js',
    'js/i18n.js',
    'data/store.js'
  ];

  for (const rel of jsFiles) {
    const full = path.join(ROOT_DIR, rel);
    assert(fs.existsSync(full), `File ${rel} must exist`);
    try {
      execFileSync('node', ['--check', full]);
    } catch (e) {
      assert.fail(`Syntax error in ${rel}: ${e.message}`);
    }
  }
}

function testHtmlFiles() {
  const htmlFiles = ['index.html', 'admin.html'];
  for (const rel of htmlFiles) {
    const full = path.join(ROOT_DIR, rel);
    assert(fs.existsSync(full), `File ${rel} must exist`);
    const content = fs.readFileSync(full, 'utf8');
    assert(content.includes('id="app"'), `${rel} must contain #app container`);
    assert(content.includes('js/app.js'), `${rel} must load js/app.js`);
    assert(content.includes('js/supabase.js'), `${rel} must load js/supabase.js`);
    assert(content.includes('data/store.js'), `${rel} must load data/store.js`);
  }
}

function testSqlSchema() {
  const schemaPath = path.join(ROOT_DIR, 'supabase/schema.sql');
  assert(fs.existsSync(schemaPath), 'supabase/schema.sql must exist');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  assert(sql.includes('public.store_data'), 'schema.sql must define store_data table');
  assert(sql.includes('public.reviews'), 'schema.sql must define reviews table');
  assert(sql.includes('public.orders'), 'schema.sql must define orders table');
  assert(sql.includes('public.profiles'), 'schema.sql must define profiles table');
  assert(sql.includes('covers'), 'schema.sql must configure covers bucket');
}

function run() {
  console.log('Running Syntax & Structure Tests...');
  testJsSyntax();
  console.log('  ✓ JavaScript files syntax valid');
  testHtmlFiles();
  console.log('  ✓ HTML entrypoints valid');
  testSqlSchema();
  console.log('  ✓ Supabase SQL schema valid');
  console.log('PASS: Syntax and Structure\n');
}

if (require.main === module) {
  try {
    run();
  } catch (e) {
    console.error('FAIL: Syntax and Structure:', e.message);
    process.exit(1);
  }
}

module.exports = { run };
