'use strict';

// Tiny zero-dependency server for looking at the site on your own computer ("npm start").
// It only reads files: nothing can be changed through it. It listens on 127.0.0.1 only,
// so nobody else on the network can reach it. Security notes: see SECURITY.md.

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

// Only these are served, so server.js, .git, tests and friends stay private.
// No part of the path may start with a dot (.DS_Store, .env, …).
const isPublic = (rel) => (rel === 'index.html' || rel === 'content.json' || rel.startsWith('assets/'))
  && !rel.split('/').some((part) => part.startsWith('.'));
const isText = (type) => /^(text\/|application\/json|image\/svg)/.test(type);

const escapeAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Texts are stored as { en, de }; an empty German text falls back to the English one.
function pick(value, lang) {
  if (value && typeof value === 'object') return String(value[lang] ?? '').trim() ? value[lang] : (value.en ?? '');
  return value ?? '';
}

// Sent with every answer: no framing by other sites, no guessing of file types, no leaking of the address.
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
};

// The page may only run its own scripts (plus the small inline theme script, allowed by its hash),
// load its own files, and never be put inside a frame.
function pageCsp(html) {
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Builds the server. Tests pass their own folder, so they never touch the real files.
// options: root (folder with index.html), contentFile, port.
function createServer(options = {}) {
  const root = options.root ?? __dirname;
  const contentFile = options.contentFile ?? path.join(root, 'content.json');

  // The real port, also when the server was started on port 0 (a free one), as tests do.
  const port = () => server.address()?.port ?? options.port ?? DEFAULT_PORT;
  const allowedHosts = () => {
    const p = port();
    return p === 80 ? ['localhost', '127.0.0.1', 'localhost:80', '127.0.0.1:80'] : [`localhost:${p}`, `127.0.0.1:${p}`];
  };

  function send(req, res, status, body, type = 'text/plain; charset=utf-8', cache = 'no-cache', extra = {}) {
    if (res.headersSent) return;
    const headers = { ...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': cache, ...extra };
    let data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));

    // Compress text so pages load fast even on slow connections.
    const accepts = String(req.headers['accept-encoding'] || '');
    if (isText(type) && data.length > 1024) {
      headers.Vary = 'Accept-Encoding';
      if (/\bbr\b/.test(accepts)) {
        data = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } });
        headers['Content-Encoding'] = 'br';
      } else if (/\bgzip\b/.test(accepts)) {
        data = zlib.gzipSync(data);
        headers['Content-Encoding'] = 'gzip';
      }
    }

    headers['Content-Length'] = data.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  // Puts the content straight into the page: one request less, and search engines see real text.
  function renderIndex(req, res, searchParams) {
    fs.readFile(path.join(root, 'index.html'), 'utf8', (err, html) => {
      if (err) return send(req, res, 500, 'Could not read index.html');
      fs.readFile(contentFile, 'utf8', (contentErr, raw) => {
        let content = null;
        try {
          content = JSON.parse(raw);
        } catch { /* the page falls back to fetching content.json */ }

        // Stamp scripts and styles with their last change, so browsers never run an outdated copy.
        html = html.replace(/(href|src)="(assets\/[^"?]+\.(?:css|js))"/g, (match, attr, file) => {
          try {
            return `${attr}="${file}?v=${fs.statSync(path.join(root, file)).mtimeMs.toString(36).replace('.', '')}"`;
          } catch {
            return match;
          }
        });

        // English lives at "/", German at "/?lang=de"; each page points search engines to the other.
        // req.headers.host was checked against the allowlist before we got here, and is escaped anyway.
        const lang = searchParams.get('lang') === 'de' ? 'de' : 'en';
        const origin = escapeAttr(`http://${req.headers.host}`);
        html = html
          .replace('<html lang="en">', `<html lang="${lang}">`)
          .replace('<!--CV_DATA-->', [
            `<link rel="alternate" hreflang="en" href="${origin}/">`,
            `<link rel="alternate" hreflang="de" href="${origin}/?lang=de">`,
            `<link rel="alternate" hreflang="x-default" href="${origin}/">`,
            '<!--CV_DATA-->',
          ].join('\n  '));

        if (!contentErr && content) {
          const site = content.site || {};
          // Every "<" is written as <, so no text in content.json can close the script tag early.
          const json = JSON.stringify(content).replace(/</g, '\\u003c');
          html = html
            .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(pick(site.title, lang) || 'CV')}</title>`)
            .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeAttr(pick(site.description, lang))}$2`)
            .replace('<!--CV_DATA-->', `<script id="cv-data" type="application/json">${json}</script>`);
        }
        send(req, res, 200, html, TYPES['.html'], 'no-cache', { 'Content-Security-Policy': pageCsp(html) });
      });
    });
  }

  function serveStatic(req, res, pathname, searchParams) {
    let rel;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return send(req, res, 400, 'Bad request');
    }
    // Control characters (like %00) have no place in a file name, and crash Node's file functions.
    // eslint-disable-next-line no-control-regex -- matching them is the whole point here
    if (/[\u0000-\u001f\u007f\\]/.test(rel)) return send(req, res, 400, 'Bad request');

    const file = path.resolve(root, rel);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative.startsWith('..') || path.isAbsolute(relative) || !isPublic(relative)) return send(req, res, 404, 'Not found');
    if (relative === 'index.html') return renderIndex(req, res, searchParams);

    fs.readFile(file, (err, data) => {
      if (err) return send(req, res, 404, 'Not found');
      // Photos have unique names and stamped files change URL when edited, so browsers may keep both forever.
      const forever = relative.startsWith('assets/uploads/') || searchParams.has('v');
      const cache = forever ? 'public, max-age=31536000, immutable' : 'no-cache';
      send(req, res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', cache);
    });
  }

  // Logs the real problem for you, but tells the visitor nothing about the inside of the server.
  function fail(req, res, err) {
    console.error(err);
    if (!res.headersSent) send(req, res, 500, 'Something went wrong.');
    else res.destroy();
  }

  function handle(req, res) {
    // Only answer under our own name: stops "DNS rebinding", where another site pretends to be localhost.
    if (!allowedHosts().includes(String(req.headers.host).toLowerCase())) return send(req, res, 421, 'Unknown host');

    // The server only shows files; nothing can be sent to it.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, 'Method not allowed', undefined, undefined, { Allow: 'GET, HEAD' });
    }

    let url;
    try {
      url = new URL(req.url, `http://${HOST}`);
    } catch {
      return send(req, res, 400, 'Bad request');
    }
    return serveStatic(req, res, url.pathname, url.searchParams);
  }

  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      fail(req, res, err);
    }
  });

  // Slow or broken requests are cut off instead of tying up the server.
  server.headersTimeout = 10 * 1000;
  server.requestTimeout = 30 * 1000;
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  return server;
}

// Runs only when started with "node server.js" / "npm start", not when a test loads this file.
if (require.main === module) {
  createServer({ port: DEFAULT_PORT }).listen(DEFAULT_PORT, HOST, () => {
    console.log(`\n  CV running at  http://localhost:${DEFAULT_PORT}\n`);
  });
}

module.exports = { createServer, isPublic, pick, escapeAttr, pageCsp };
