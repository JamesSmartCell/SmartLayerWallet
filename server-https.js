/**
 * HTTPS reverse proxy for Next.js Wallet
 * Use when traffic arrives as TLS (e.g. Cloudflare passthrough, direct HTTPS)
 *
 * Usage:
 *   SSL_KEY=/path/to/key.pem SSL_CERT=/path/to/cert.pem node server-https.js
 *
 * Or with default paths (create with: certbot certonly --standalone -d wallet.percolate.one)
 *   node server-https.js
 *
 * Proxies HTTPS on PORT (default 8089) -> HTTP localhost:8088 (Next.js)
 * /cam-gate/* -> CAMERA_GATE_UPSTREAM (Pi via SSH reverse tunnel, default 127.0.0.1:8787)
 *
 * Run Next.js on 8088: PORT=8088 npm start
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '8089', 10);
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '8088', 10);
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const CAMERA_GATE_UPSTREAM = process.env.CAMERA_GATE_UPSTREAM || 'http://127.0.0.1:8787';
const CAM_PREFIX = '/cam-gate';
const CAM_ALLOWED = /^\/cam-gate\/(health|challenge|auth|heartbeat|stop|live\/|hls\/|snapshot\/)/;

const certPath = process.env.SSL_CERT || '/etc/letsencrypt/live/wallet.percolate.one/fullchain.pem';
const keyPath = process.env.SSL_KEY || '/etc/letsencrypt/live/wallet.percolate.one/privkey.pem';

function proxyRequest(req, res, hostname, port, destPath) {
  const opts = {
    hostname,
    port,
    path: destPath,
    method: req.method,
    headers: { ...req.headers, host: hostname + ':' + port },
  };
  const isLive = String(destPath).startsWith('/live');
  const proxy = http.request(opts, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    if (isLive) {
      delete headers['content-length'];
      headers['cache-control'] = 'no-store, no-cache, must-revalidate';
      headers['x-accel-buffering'] = 'no';
    }
    res.writeHead(proxyRes.statusCode, headers);
    if (res.socket) res.socket.setNoDelay(true);
    proxyRes.pipe(res);
  });
  proxy.setTimeout(0);
  if (typeof req.setTimeout === 'function') req.setTimeout(0);
  proxy.on('error', (e) => {
    console.error('Proxy error:', e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(
        destPath.startsWith('/live') || destPath.startsWith('/hls') || destPath.startsWith('/auth') || destPath.startsWith('/challenge') || destPath.startsWith('/health')
          ? `camera-gate unreachable at ${CAMERA_GATE_UPSTREAM} (${e.message}). On the Pi 5: curl ${CAMERA_GATE_UPSTREAM}/health — if that fails, the Pi 3 SSH tunnel is down.`
          : 'Bad Gateway'
      );
    } else {
      res.end();
    }
  });
  req.pipe(proxy);
}

function handleRequest(req, res) {
  const url = req.url || '/';
  if (url === CAM_PREFIX || url.startsWith(CAM_PREFIX + '/')) {
    if (req.method === 'OPTIONS' || CAM_ALLOWED.test(url.split('?')[0])) {
      const destPath = url.slice(CAM_PREFIX.length) || '/';
      let upstream;
      try {
        upstream = new URL(CAMERA_GATE_UPSTREAM);
      } catch {
        res.writeHead(500);
        res.end('CAMERA_GATE_UPSTREAM is invalid');
        return;
      }
      proxyRequest(req, res, upstream.hostname, upstream.port || 80, destPath);
      return;
    }
    res.writeHead(404);
    res.end('not found');
    return;
  }

  proxyRequest(req, res, BACKEND_HOST, BACKEND_PORT, url);
}

let server;
try {
  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(keyPath);
  server = https.createServer({ cert, key }, handleRequest);
  server.timeout = 0;
  server.keepAliveTimeout = 0;
  server.listen(PORT, () => {
    console.log(`HTTPS proxy listening on port ${PORT} -> http://${BACKEND_HOST}:${BACKEND_PORT}`);
    console.log(` /cam-gate/* -> ${CAMERA_GATE_UPSTREAM}`);
  });
} catch (e) {
  console.error('Failed to start HTTPS server:', e.message);
  console.error('Set SSL_CERT and SSL_KEY, or place certs at:', certPath, keyPath);
  process.exit(1);
}
