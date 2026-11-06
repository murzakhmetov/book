/**
 * Store Business Logic unit tests
 */
const assert = require('assert');

// 1. WhatsApp / KZ Phone normalization logic
function normKz(v) {
  var d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return "7" + d.slice(1);
  if (d.length === 10) return "7" + d;
  return "";
}

function fmtPhone(p) {
  var d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "7") {
    return "+7 (" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7, 9) + "-" + d.slice(9, 11);
  }
  return p || "";
}

// 2. Stock state logic
function stockState(stock, lowThreshold) {
  var low = lowThreshold || 3;
  return stock <= 0 ? "out" : (stock <= low ? "low" : "in");
}

// 3. Delivery calculation logic
function calcDeliveryFee(subtotal, settings) {
  var freeFrom = (settings && settings.freeFrom) || 25000;
  var feeCourier = (settings && settings.feeCourier) || 1500;
  if (subtotal >= freeFrom) {
    return 0; // Free delivery
  }
  return feeCourier;
}

function testPhoneNormalization() {
  assert.strictEqual(normKz("87473624638"), "77473624638");
  assert.strictEqual(normKz("+7 (747) 362-46-38"), "77473624638");
  assert.strictEqual(normKz("7473624638"), "77473624638");
  assert.strictEqual(normKz("12345"), "");
  assert.strictEqual(fmtPhone("77473624638"), "+7 (747) 362-46-38");
}

function testStockState() {
  assert.strictEqual(stockState(0, 3), "out");
  assert.strictEqual(stockState(-1, 3), "out");
  assert.strictEqual(stockState(2, 3), "low");
  assert.strictEqual(stockState(3, 3), "low");
  assert.strictEqual(stockState(4, 3), "in");
  assert.strictEqual(stockState(10, 3), "in");
}

function testDeliveryCalculation() {
  const settings = { freeFrom: 25000, feeCourier: 1500 };
  assert.strictEqual(calcDeliveryFee(10000, settings), 1500);
  assert.strictEqual(calcDeliveryFee(24999, settings), 1500);
  assert.strictEqual(calcDeliveryFee(25000, settings), 0);
  assert.strictEqual(calcDeliveryFee(50000, settings), 0);
}

function run() {
  console.log('Running Store Business Logic Tests...');
  testPhoneNormalization();
  console.log('  ✓ Phone and WhatsApp normalization functions pass');
  testStockState();
  console.log('  ✓ Stock status logic (out, low, in) passes');
  testDeliveryCalculation();
  console.log('  ✓ Free delivery threshold (>= 25 000 ₸) passes');
  console.log('PASS: Store Business Logic\n');
}

if (require.main === module) {
  try {
    run();
  } catch (e) {
    console.error('FAIL: Store Business Logic:', e.message);
    process.exit(1);
  }
}

module.exports = { run };
