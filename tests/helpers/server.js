'use strict';

// Starts a real server in a throw-away folder for one test file.
// The real content.json and photos are never touched.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createServer } = require('../../server.js');

const REPO = path.join(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'content.json');

async function startServer({ content } = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cv-test-'));
  await fs.promises.copyFile(path.join(REPO, 'index.html'), path.join(root, 'index.html'));
  const json = content === undefined ? await fs.promises.readFile(FIXTURE, 'utf8') : content;
  await fs.promises.writeFile(path.join(root, 'content.json'), typeof json === 'string' ? json : JSON.stringify(json));
  for (const file of ['assets/css/style.css', 'assets/js/app.js', 'assets/js/hero-map.js']) {
    await fs.promises.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.promises.writeFile(path.join(root, file), `/* ${file} */\n`);
  }
  await fs.promises.mkdir(path.join(root, 'assets', 'uploads'), { recursive: true });

  const server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  // A raw HTTP request with full control over every header (fetch() would hide Host).
  function request(pathname, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const h = { ...headers };
      const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      if (data) h['content-length'] = data.length;
      const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: h }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buffer, text: buffer.toString('utf8') });
        });
      });
      req.on('error', reject);
      req.end(data);
    });
  }

  async function close() {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  }

  return { server, root, port, request, close };
}

module.exports = { startServer, REPO };
