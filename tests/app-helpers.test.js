'use strict';

// The text helpers of assets/js/app.js: they turn content into HTML, so they are where
// cross-site scripting (XSS) would sneak in. Each test feeds them something nasty.

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const h = require('../assets/js/app.js');

// No tag may open except the few the helpers make themselves, and no attribute may start with "on".
const SAFE_TAGS = /^<\/?(a|strong|wbr|img|span)\b/;
function assertInert(html) {
  for (const tag of html.match(/<[^>]*>/g) || []) {
    assert.match(tag, SAFE_TAGS, `unexpected tag ${tag}`);
    assert.doesNotMatch(tag, /\son\w+=/i, `event handler in ${tag}`);
    assert.doesNotMatch(tag, /javascript:/i, `javascript: link in ${tag}`);
  }
}

const NASTY = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "'><iframe src=javascript:alert(1)>",
  'javascript:alert(1)',
  'https://example.com/"onmouseover="alert(1)',
  'https://example.com/<script>',
  '**<b>bold</b>**',
];

describe('esc()', () => {
  it('turns the five special HTML characters into harmless codes', () => {
    assert.equal(h.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('treats missing values as empty text', () => {
    assert.equal(h.esc(null), '');
    assert.equal(h.esc(undefined), '');
    assert.equal(h.esc(0), '0');
  });
});

describe('rich(): bold and links in longer texts', () => {
  it('makes **words** bold, also across several words', () => {
    assert.equal(h.rich('I **really like** this'), 'I <strong>really like</strong> this');
  });
  it('leaves single or unclosed asterisks alone', () => {
    assert.equal(h.rich('5 * 3 and **open'), '5 * 3 and **open');
    assert.equal(h.rich('** spaced **'), '** spaced **');
  });
  it('turns web addresses into links that open in a new tab without leaking the page', () => {
    assert.equal(
      h.rich('See https://github.com/rivanikolay?tab=repositories.'),
      'See <a href="https://github.com/rivanikolay?tab=repositories" target="_blank" rel="noopener noreferrer">github.com/rivanikolay</a>.',
    );
  });
  it('shows addresses without "www." and trailing slash', () => {
    assert.match(h.rich('https://www.example.com/'), />example\.com<\/a>/);
  });
  it('combines bold and links', () => {
    assert.match(h.rich('**https://example.com**'), /^<strong><a href="https:\/\/example\.com"/);
  });
  for (const input of NASTY) {
    it(`keeps ${JSON.stringify(input)} harmless`, () => assertInert(h.rich(input)));
  }
  it('never makes a link from javascript: or data: addresses', () => {
    assert.doesNotMatch(h.rich('javascript:alert(1) data:text/html,x'), /<a /);
  });
});

describe('telHref(): phone links', () => {
  it('keeps only digits and the leading +', () => {
    assert.equal(h.telHref('+41 (0)44 123-45-67'), 'tel:+410441234567');
    assert.equal(h.telHref('"><script>'), 'tel:');
  });
});

describe('safeSrc(): where images may come from', () => {
  it('allows this site\'s assets and secure web addresses', () => {
    assert.equal(h.safeSrc('assets/uploads/photo-abc123@2400.webp'), 'assets/uploads/photo-abc123@2400.webp');
    assert.equal(h.safeSrc(' https://example.com/a.jpg '), 'https://example.com/a.jpg');
  });
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'http://example.com/a.jpg', '/etc/passwd',
    'assets/../server.js', 'assets/uploads/a.webp" onerror="alert(1)', '//evil.example/a.png', '', null]) {
    it(`refuses ${JSON.stringify(bad)}`, () => assert.equal(h.safeSrc(bad), ''));
  }
});

describe('imgTag(): image HTML', () => {
  it('adds the 900px copy for phones to big uploads', () => {
    const html = h.imgTag('assets/uploads/a-abc123@2400.webp', 'Alt', { sizes: '50vw' });
    assert.match(html, /srcset="assets\/uploads\/a-abc123@2400-900\.webp 900w, assets\/uploads\/a-abc123@2400\.webp 2400w" sizes="50vw"/);
    assert.match(html, /loading="lazy"/);
  });
  it('has no small copy for small images', () => {
    assert.doesNotMatch(h.imgTag('assets/uploads/a-abc123@768.webp', ''), /srcset/);
  });
  it('loads the first image early when asked, and marks zoomable ones', () => {
    const html = h.imgTag('assets/a.png', '', { eager: true, zoom: true });
    assert.match(html, /fetchpriority="high"/);
    assert.match(html, /data-zoom="assets\/a\.png"/);
  });
  it('renders nothing for an unsafe address', () => {
    assert.equal(h.imgTag('javascript:alert(1)', 'x'), '');
  });
  it('escapes the description', () => {
    assertInert(h.imgTag('assets/a.png', '"><script>alert(1)</script>'));
  });
});

describe('frameStyleFor(): crop settings as CSS', () => {
  it('turns position, zoom and fit into CSS', () => {
    assert.equal(h.frameStyleFor({ x: 30, y: 70, zoom: 2 }), ' style="object-position:30% 70%;transform-origin:30% 70%;scale:2"');
    assert.equal(h.frameStyleFor({ x: 30, y: 70, zoom: 2, fit: 'contain' }), ' style="object-position:30% 70%;object-fit:contain"');
  });
  it('keeps every number in its range', () => {
    assert.equal(h.frameStyleFor({ x: -50, y: 900, zoom: 10 }), ' style="object-position:0% 100%;transform-origin:0% 100%;scale:3"');
  });
  it('turns junk into harmless numbers, so no other CSS can sneak in', () => {
    const css = h.frameStyleFor({ x: '1;background:url(//evil)', y: '"><script>', zoom: 'big' });
    assert.equal(css, ' style="object-position:0% 0%"');
  });
  it('is empty without settings', () => {
    assert.equal(h.frameStyleFor(undefined), '');
    assert.equal(h.frameStyleFor('x'), '');
  });
});

describe('fluencyWord(): level number → word', () => {
  const words = ['A little', 'Basic', 'Medium', 'Good', 'Very good', 'Perfect'];
  for (const [level, word] of [[0, 'A little'], [19, 'A little'], [20, 'Basic'], [39, 'Basic'], [40, 'Medium'], [59, 'Medium'],
    [60, 'Good'], [79, 'Good'], [80, 'Very good'], [94, 'Very good'], [95, 'Perfect'], [100, 'Perfect']]) {
    it(`${level} → ${word}`, () => assert.equal(h.fluencyWord(level, words), word));
  }
  it('treats missing or broken levels as 0', () => {
    assert.equal(h.fluencyWord(undefined, words), 'A little');
    assert.equal(h.fluencyWord('abc', words), 'A little');
  });
  it('works with the German words too', () => {
    assert.equal(h.fluencyWord(85, h.UI.de.levels), 'Sehr gut');
  });
});

describe('localizeIn(): picking a language', () => {
  const data = { a: { en: 'Hello', de: 'Hallo' }, b: { en: 'Only English', de: '  ' }, c: [{ en: 'x', de: 'y' }], d: 5, e: 'plain' };
  it('picks the language everywhere, also inside lists', () => {
    assert.deepEqual(h.localizeIn(data, 'de'), { a: 'Hallo', b: 'Only English', c: ['y'], d: 5, e: 'plain' });
    assert.deepEqual(h.localizeIn(data, 'en'), { a: 'Hello', b: 'Only English', c: ['x'], d: 5, e: 'plain' });
  });
  it('isText() only matches {en, de} texts', () => {
    assert.ok(h.isText({ en: '' }));
    assert.ok(!h.isText(['en']));
    assert.ok(!h.isText(null));
    assert.ok(!h.isText({ de: 'x' }));
  });
});

describe('smaller helpers', () => {
  it('paragraphs() splits at empty lines', () => {
    assert.deepEqual(h.paragraphs('One\nline\n\n  \nTwo\n\n\nThree '), ['One\nline', 'Two', 'Three']);
    assert.deepEqual(h.paragraphs(undefined), []);
  });
  it('initials() takes the first letters of two words', () => {
    assert.equal(h.initials('marco  van rossi'), 'MV');
    assert.equal(h.initials(''), '');
  });
  it('images() keeps only safe image addresses', () => {
    assert.deepEqual(h.images({ images: ['assets/a.png', 'javascript:x', '', 5] }), ['assets/a.png']);
    assert.deepEqual(h.images(null), []);
  });
  it('pad(), clamp(), when(), list()', () => {
    assert.equal(h.pad(3), '03');
    assert.equal(h.clamp(5, 0, 3), 3);
    assert.equal(h.when('  ', 'x'), '');
    assert.equal(h.when('a', 'x'), 'x');
    assert.deepEqual(h.list('nope'), []);
  });
  it('splitLetters() wraps each letter, escaped', () => {
    assert.equal(h.splitLetters('A<', 2), '<span class="ch" style="--i:2">A</span><span class="ch" style="--i:3">&lt;</span>');
  });
  it('splitWords() keeps bold across words and escapes everything', () => {
    assert.equal(
      h.splitWords('a **b c** <d>', 'w'),
      '<span class="w" style="--i:0">a</span> <span class="w" style="--i:1"><strong>b</strong></span> '
      + '<span class="w" style="--i:2"><strong>c</strong></span> <span class="w" style="--i:3">&lt;d&gt;</span>',
    );
  });
});
