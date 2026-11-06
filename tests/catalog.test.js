/**
 * Catalog data integrity test
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');

function loadStore() {
  const storePath = path.join(ROOT_DIR, 'data/store.js');
  const code = fs.readFileSync(storePath, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  assert(context.window.BL_STORE, 'window.BL_STORE must be defined');
  return context.window.BL_STORE;
}

function testCatalog() {
  const store = loadStore();

  // Settings
  assert(store.settings, 'store.settings must exist');
  assert.strictEqual(store.settings.demoMode, false, 'store.settings.demoMode must be false');
  assert(store.settings.phone, 'phone must be present');
  assert(store.settings.whatsapp, 'whatsapp must be present');
  assert(store.settings.freeFrom >= 10000, 'free delivery threshold must be >= 10000');

  // Categories
  assert(Array.isArray(store.categories) && store.categories.length > 0, 'categories array must exist');
  const validCatSlugs = new Set(store.categories.map(c => c.slug));

  // Products
  assert(Array.isArray(store.products), 'products must be an array');
  assert(store.products.length >= 40, `Expected at least 40 products, found ${store.products.length}`);

  const seenIds = new Set();
  const seenSlugs = new Set();

  for (const p of store.products) {
    assert(p.id, `Product must have an id: ${JSON.stringify(p)}`);
    assert(!seenIds.has(p.id), `Duplicate product ID found: ${p.id}`);
    seenIds.add(p.id);

    assert(p.slug, `Product ${p.id} must have a slug`);
    assert(!seenSlugs.has(p.slug), `Duplicate slug found: ${p.slug}`);
    seenSlugs.add(p.slug);

    assert(p.title && p.title.trim(), `Product ${p.id} must have a title`);
    assert(p.author && p.author.trim(), `Product ${p.id} must have an author`);
    assert(typeof p.price === 'number' && p.price > 0, `Product ${p.id} must have positive price`);

    if (p.sale != null) {
      assert(typeof p.sale === 'number' && p.sale > 0, `Sale price must be positive on ${p.id}`);
      assert(p.sale < p.price, `Sale price ${p.sale} must be less than regular price ${p.price} on ${p.id}`);
    }

    assert(validCatSlugs.has(p.cat), `Product ${p.id} has invalid category: ${p.cat}`);
    assert(p.cover && typeof p.cover === 'string', `Product ${p.id} must have cover image`);
  }
}

function run() {
  console.log('Running Catalog Data Integrity Tests...');
  testCatalog();
  console.log('  ✓ Store settings valid (demoMode = false)');
  console.log('  ✓ All 40+ products have unique IDs and slugs');
  console.log('  ✓ Prices, sales, categories and covers are valid');
  console.log('PASS: Catalog Data Integrity\n');
}

if (require.main === module) {
  try {
    run();
  } catch (e) {
    console.error('FAIL: Catalog Data Integrity:', e.message);
    process.exit(1);
  }
}

module.exports = { run };
