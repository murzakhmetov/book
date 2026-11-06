/**
 * DOM and Browser Smoke Test (Async non-blocking)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 8097;

function startServer() {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.woff': 'font/woff'
  };

  const server = http.createServer((req, res) => {
    let rawPath = req.url.split('?')[0];
    let filePath = path.join(ROOT_DIR, rawPath === '/' ? 'index.html' : rawPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(ROOT_DIR, 'index.html');
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'google-chrome',
    'chromium'
  ];
  for (const bin of candidates) {
    try {
      execFileSync('which', [bin], { stdio: 'pipe' });
      return bin;
    } catch (e) {}
  }
  return null;
}

function dumpDomAsync(chromeBin, url) {
  return new Promise((resolve, reject) => {
    const tmpProfile = path.join('/tmp', 'bl_chrome_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    const proc = spawn(chromeBin, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + tmpProfile,
      '--dump-dom',
      url
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => stdout += chunk);
    proc.stderr.on('data', chunk => stderr += chunk);

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {}
      reject(new Error(`dumpDomAsync timed out after 15s for ${url}`));
    }, 15000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {}
      if (code === 0 || stdout.length > 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Chrome exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) {}
      reject(err);
    });
  });
}

async function run() {
  console.log('Running DOM & Browser Smoke Tests...');
  const chromeBin = findChrome();

  if (!chromeBin) {
    console.log('  ⚠️ Google Chrome / Chromium not installed in environment, skipping browser render.');
    console.log('PASS: DOM Smoke Tests (skipped browser render)\n');
    return;
  }

  const server = await startServer();

  try {
    // 1. Home Page render
    const homeDom = await dumpDomAsync(chromeBin, `http://127.0.0.1:${PORT}/`);
    assert(!homeDom.includes('demo-bar'), 'FAIL: .demo-bar class was found in rendered DOM!');
    assert(!homeDom.includes('Демонстрационный режим'), 'FAIL: Demo banner text was found in rendered DOM!');
    assert(homeDom.includes('book_lovers'), 'FAIL: Brand wordmark missing from DOM');
    assert(homeDom.includes('q-desk'), 'FAIL: Search input missing from DOM');
    console.log('  ✓ Home page rendered cleanly: demo-bar is completely absent');

    // 2. Admin Page render
    const adminDom = await dumpDomAsync(chromeBin, `http://127.0.0.1:${PORT}/admin.html`);
    assert(adminDom.includes('Управление магазином'), 'FAIL: Admin header missing from admin.html');
    console.log('  ✓ Admin page rendered with management gate and controls');

    console.log('PASS: DOM & Browser Smoke Tests\n');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  run().catch(e => {
    console.error('FAIL: DOM & Browser Smoke Tests:', e.message);
    process.exit(1);
  });
}

module.exports = { run };
