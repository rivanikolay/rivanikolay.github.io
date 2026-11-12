'use strict';

// Checks for the published (static) site on GitHub Pages, where there is no server.js to help.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { pageCsp } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const metaCsp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];

describe('security rules in index.html (GitHub Pages cannot send headers)', () => {
  it('has a Content-Security-Policy meta tag before any script', () => {
    assert.ok(metaCsp, 'missing CSP meta tag');
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<script'), 'must come before the first script');
  });

  it('allows the inline theme script by its exact fingerprint (change the script → update the sha256)', () => {
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const hash = crypto.createHash('sha256').update(inline).digest('base64');
    assert.ok(metaCsp.includes(`'sha256-${hash}'`), `expected 'sha256-${hash}' in the meta CSP`);
  });

  it('matches the rules the local server sends (except framing, which a meta tag cannot set)', () => {
    const server = pageCsp(html).split('; ').filter((rule) => !rule.startsWith('frame-ancestors'));
    assert.deepEqual(metaCsp.split('; '), server);
  });

  it('never allows inline scripts in general, plugins or foreign sites', () => {
    assert.doesNotMatch(metaCsp, /script-src[^;]*unsafe-inline/);
    assert.match(metaCsp, /object-src 'none'/);
    assert.doesNotMatch(metaCsp, /https?:|\*/);
  });

  it('sets a strict referrer policy', () => {
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  });
});

describe('ready for GitHub Pages', () => {
  it('has a real title and description without the server', () => {
    assert.match(html, /<title>Nikolay Riva — CV<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{10,}">/);
  });

  it('turns off Jekyll (.nojekyll), so every file is served as it is', () => {
    assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')));
  });

  it('uses only relative paths, so the site works in any folder', () => {
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.doesNotMatch(m[1], /^\//, `absolute path ${m[1]}`);
    }
  });

  it('publishes no forgotten photos: every file in assets/uploads is used', () => {
    const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8'));
    const used = new Set();
    const walk = (v) => {
      if (typeof v === 'string' && v.startsWith('assets/uploads/')) {
        used.add(v);
        used.add(v.replace(/\.(\w+)$/, '-900.$1'));
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    Object.entries(content).forEach(([key, v]) => { if (key !== 'media') walk(v); });
    const unused = fs.readdirSync(path.join(ROOT, 'assets', 'uploads'))
      .filter((f) => !f.startsWith('.'))
      .map((f) => `assets/uploads/${f}`)
      .filter((f) => !used.has(f));
    assert.deepEqual(unused, []);
  });
});
