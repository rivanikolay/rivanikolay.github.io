'use strict';

// Checks the real content.json and the uploads folder (read-only), so a broken image link
// or a missing translation shows up as a red test instead of on the live page.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { UI, isText } = require('../assets/js/app.js');

const ROOT = path.join(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.json'), 'utf8'));

// Walks every value in content.json and reports it with its path, e.g. "hobbies.items[2].title".
function* walk(value, where = 'content') {
  yield [value, where];
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* walk(v, Array.isArray(value) ? `${where}[${k}]` : `${where}.${k}`);
  }
}

const usedImages = new Set();
for (const [value, where] of walk(content)) {
  if (typeof value === 'string' && value.startsWith('assets/') && !where.startsWith('content.media')) usedImages.add(value);
}

describe('content.json', () => {
  it('has the sections the page shows', () => {
    for (const key of ['site', 'hero', 'about', 'education', 'languages', 'hobbies', 'contact', 'footer']) {
      assert.ok(content[key], `missing section "${key}"`);
    }
  });

  it('has an English version of every text (German may be empty: it then shows the English one)', () => {
    const missing = [];
    for (const [value, where] of walk(content)) {
      if (isText(value) && typeof value.en === 'string' && !value.en.trim() && String(value.de ?? '').trim()) missing.push(where);
    }
    assert.deepEqual(missing, [], 'German text without English');
  });

  it('only uses texts, never HTML', () => {
    const html = [];
    for (const [value, where] of walk(content)) {
      if (typeof value === 'string' && /<\s*(script|iframe|img|svg|a)\b|javascript:/i.test(value)) html.push(where);
    }
    assert.deepEqual(html, []);
  });

  it('has a level from 0 to 100 for each language', () => {
    for (const item of content.languages.items) {
      assert.ok(Number.isFinite(item.level) && item.level >= 0 && item.level <= 100, JSON.stringify(item.name));
    }
  });
});

describe('images', () => {
  it('every image in content.json exists in assets/', () => {
    const missing = [...usedImages].filter((src) => !fs.existsSync(path.join(ROOT, src)));
    assert.deepEqual(missing, []);
  });

  it('every big upload has its small 900px copy for phones', () => {
    const missing = [];
    for (const src of usedImages) {
      const m = /@(\d+)\.(webp|jpe?g|png)$/.exec(src);
      if (m && Number(m[1]) > 900) {
        const small = src.replace(/\.(\w+)$/, '-900.$1');
        if (!fs.existsSync(path.join(ROOT, small))) missing.push(small);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every image setting (crop, caption) belongs to an image that is used', () => {
    const orphans = Object.keys(content.media || {}).filter((src) => !usedImages.has(src));
    assert.deepEqual(orphans, []);
  });
});

describe('page words (UI)', () => {
  it('exist in English and German with the same keys', () => {
    assert.deepEqual(Object.keys(UI.de).sort(), Object.keys(UI.en).sort());
  });

  it('have six level words in each language', () => {
    assert.equal(UI.en.levels.length, 6);
    assert.equal(UI.de.levels.length, 6);
  });
});
