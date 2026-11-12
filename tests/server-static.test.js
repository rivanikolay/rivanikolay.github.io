'use strict';

// The public side of the server: the page, files, headers and everything that must stay private.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { describe, it, before, after } = require('node:test');
const { startServer, REPO } = require('./helpers/server.js');

describe('serving the page and files', () => {
  let s;
  before(async () => {
    s = await startServer();
    await fs.promises.writeFile(path.join(s.root, 'assets', 'uploads', 'photo-abc123@2400.webp'), 'img');
    await fs.promises.writeFile(path.join(s.root, 'assets', '.secret'), 'hidden');
    await fs.promises.writeFile(path.join(s.root, 'server.js'), 'secret source');
    await fs.promises.writeFile(path.join(s.root, '.env'), 'secret');
    await fs.promises.writeFile(path.join(s.root, 'package.json'), '{}');
    await fs.promises.mkdir(path.join(s.root, 'tools'));
    await fs.promises.writeFile(path.join(s.root, 'tools', 'build-map.py'), 'print(1)');
  });
  after(() => s.close());

  describe('the page', () => {
    it('renders English at / with the content built in', async () => {
      const res = await s.request('/');
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /^text\/html/);
      assert.match(res.text, /<html lang="en">/);
      assert.match(res.text, /<title>Test Person — CV<\/title>/);
      assert.match(res.text, /<script id="cv-data" type="application\/json">/);
    });

    it('renders German at /?lang=de, with English as fallback for empty German texts', async () => {
      const res = await s.request('/?lang=de');
      assert.match(res.text, /<html lang="de">/);
      assert.match(res.text, /<title>Test Person — Lebenslauf<\/title>/);
      // The German description is empty, so the English one is used, escaped.
      assert.ok(res.text.includes('content="A &quot;quoted&quot; &lt;b&gt;CV&lt;/b&gt;."'));
    });

    it('escapes "<" in the built-in content, so a text cannot close the script tag', async () => {
      const res = await s.request('/');
      const data = res.text.split('<script id="cv-data" type="application/json">')[1].split('</script>')[0];
      assert.ok(!data.includes('<'), 'no raw "<" inside the data block');
      assert.match(data, /\\u003c\/script>\\u003cscript>alert\(1\)/);
      assert.equal(JSON.parse(data).hero.tagline.en, 'Nothing to see </script><script>alert(1)</script>');
    });

    it('stamps scripts and styles with a version, so browsers never use an old copy', async () => {
      const res = await s.request('/');
      assert.match(res.text, /href="assets\/css\/style\.css\?v=[0-9a-z]+"/);
      assert.match(res.text, /src="assets\/js\/app\.js\?v=[0-9a-z]+"/);
    });

    it('points search engines to both language versions', async () => {
      const res = await s.request('/');
      assert.ok(res.text.includes(`<link rel="alternate" hreflang="de" href="http://127.0.0.1:${s.port}/?lang=de">`));
    });

    it('still serves the page when content.json is broken (the page then fetches it itself)', async () => {
      const broken = await startServer({ content: '{ not json' });
      try {
        const res = await broken.request('/');
        assert.equal(res.status, 200);
        assert.ok(!res.text.includes('id="cv-data"'));
      } finally {
        await broken.close();
      }
    });
  });

  describe('security headers', () => {
    it('allows only the page\'s own scripts plus the inline theme script (by its hash)', async () => {
      const res = await s.request('/');
      const csp = res.headers['content-security-policy'];
      const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
      const inline = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
      const hash = crypto.createHash('sha256').update(inline).digest('base64');
      assert.ok(csp.includes(`script-src 'self' 'sha256-${hash}'`), csp);
      for (const rule of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'"]) {
        assert.ok(csp.includes(rule), `missing ${rule}`);
      }
      assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'inline scripts must not be allowed in general');
    });

    for (const pathname of ['/', '/content.json', '/assets/css/style.css', '/nope']) {
      it(`sends protective headers on ${pathname}`, async () => {
        const res = await s.request(pathname);
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.equal(res.headers['x-frame-options'], 'DENY');
        assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
        assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
        assert.match(res.headers['permissions-policy'], /camera=\(\)/);
        assert.ok(res.headers['content-security-policy']);
      });
    }
  });

  describe('files', () => {
    it('serves content.json and assets with the right type', async () => {
      const json = await s.request('/content.json');
      assert.equal(json.status, 200);
      assert.match(json.headers['content-type'], /^application\/json/);
      const css = await s.request('/assets/css/style.css');
      assert.match(css.headers['content-type'], /^text\/css/);
    });

    it('lets browsers keep uploads and version-stamped files forever, but re-checks the rest', async () => {
      assert.match((await s.request('/assets/uploads/photo-abc123@2400.webp')).headers['cache-control'], /immutable/);
      assert.match((await s.request('/assets/css/style.css?v=abc')).headers['cache-control'], /immutable/);
      assert.equal((await s.request('/assets/css/style.css')).headers['cache-control'], 'no-cache');
      assert.equal((await s.request('/content.json')).headers['cache-control'], 'no-cache');
    });

    it('compresses text with brotli or gzip when the browser supports it', async () => {
      const br = await s.request('/', { headers: { 'accept-encoding': 'gzip, br' } });
      assert.equal(br.headers['content-encoding'], 'br');
      assert.match(zlib.brotliDecompressSync(br.buffer).toString(), /<html lang="en">/);
      const gz = await s.request('/', { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.match(zlib.gunzipSync(gz.buffer).toString(), /<html lang="en">/);
    });

    it('answers HEAD without a body', async () => {
      const res = await s.request('/', { method: 'HEAD' });
      assert.equal(res.status, 200);
      assert.equal(res.buffer.length, 0);
      assert.ok(Number(res.headers['content-length']) > 0);
    });
  });

  describe('what must stay private', () => {
    for (const pathname of ['/server.js', '/.env', '/package.json', '/tools/build-map.py', '/assets/.secret', '/.git/config', '/tests/helpers/server.js']) {
      it(`refuses ${pathname}`, async () => {
        const res = await s.request(pathname);
        assert.equal(res.status, 404);
        assert.ok(!res.text.includes('secret'));
      });
    }

    for (const pathname of ['/../server.js', '/assets/../server.js', '/%2e%2e/server.js', '/assets/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2fserver.js']) {
      it(`blocks the path trick ${pathname}`, async () => {
        const res = await s.request(pathname);
        assert.ok([400, 404].includes(res.status), `got ${res.status}`);
        assert.ok(!res.text.includes('secret source'));
      });
    }

    it('refuses backslash tricks and broken percent codes', async () => {
      const backslash = await s.request('/assets\\..\\server.js');
      assert.ok([400, 404].includes(backslash.status), `got ${backslash.status}`);
      assert.ok(!backslash.text.includes('secret source'));
      assert.equal((await s.request('/assets/%5c..%5cserver.js')).status, 400);
      assert.equal((await s.request('/assets/%E0%A4%A')).status, 400);
    });

    it('survives a null byte in the path (this used to crash the server)', async () => {
      assert.equal((await s.request('/assets/a%00b')).status, 400);
      assert.equal((await s.request('/')).status, 200, 'server still running');
    });
  });

  describe('requests that are not allowed', () => {
    it('only shows files: anything that sends data gets 405', async () => {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const res = await s.request('/content.json', { method, body: '{"site":{}}', headers: { 'content-type': 'application/json' } });
        assert.equal(res.status, 405, method);
        assert.equal(res.headers.allow, 'GET, HEAD');
      }
      assert.match(fs.readFileSync(path.join(s.root, 'content.json'), 'utf8'), /Test Person/, 'content.json unchanged');
    });

    it('has no editor anymore: the old sign-in and save addresses do not exist', async () => {
      for (const pathname of ['/api/session', '/api/login', '/api/content', '/api/upload', '/assets/js/admin.js']) {
        assert.equal((await s.request(pathname)).status, 404, pathname);
      }
    });

    it('only answers to its own name (blocks DNS rebinding and Host-header tricks)', async () => {
      const evil = await s.request('/', { headers: { host: 'evil.example' } });
      assert.equal(evil.status, 421);
      const injected = await s.request('/', { headers: { host: 'x"><script>alert(1)</script>' } });
      assert.equal(injected.status, 421);
      assert.ok(!injected.text.includes('<script>'));
      assert.equal((await s.request('/', { headers: { host: `localhost:${s.port}` } })).status, 200);
    });
  });
});
