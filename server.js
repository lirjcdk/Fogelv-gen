const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const ALLOWED_HOSTS = new Set([
  'wikipedia.org',
  'www.wikipedia.org',
  'mozilla.org',
  'www.mozilla.org',
  'developer.mozilla.org',
  'www.w3.org',
  'w3.org',
  'example.com',
  'www.example.com'
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function normalizeTargetUrl(rawUrl) {
  const value = (rawUrl || '').trim();

  if (!value) {
    throw new Error('Ingen URL skickades.');
  }

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(candidate);

  if (!parsed.hostname) {
    throw new Error('URLen är ogiltig.');
  }

  return parsed.toString();
}

function isAllowedHost(hostname) {
  const normalized = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(normalized) || [...ALLOWED_HOSTS].some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

function safeJsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const resolvedPath = path.normalize(path.join(ROOT, urlPath));

  if (!resolvedPath.startsWith(ROOT)) {
    safeJsonResponse(res, 403, { ok: false, message: 'Access denied.' });
    return;
  }

  fs.readFile(resolvedPath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') {
        safeJsonResponse(res, 404, { ok: false, message: 'File not found.' });
      } else {
        safeJsonResponse(res, 500, { ok: false, message: 'Server error.' });
      }
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

async function proxyRequest(targetUrl) {
  const url = new URL(normalizeTargetUrl(targetUrl));

  if (!isAllowedHost(url.hostname)) {
    throw new Error('Detta mål är inte tillåtet i den här proxyn.');
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'NordicProxy/1.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  const text = await response.text();
  return {
    ok: true,
    host: url.hostname,
    status: response.status,
    contentType: response.headers.get('content-type') || 'unknown',
    snippet: text.slice(0, 700)
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/proxy') {
    const target = url.searchParams.get('url');

    try {
      const result = await proxyRequest(target);
      safeJsonResponse(res, 200, result);
    } catch (error) {
      safeJsonResponse(res, 403, { ok: false, message: error.message || 'Målet är inte tillåtet.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    safeJsonResponse(res, 200, { ok: true, status: 'healthy', port: PORT });
    return;
  }

  serveStaticFile(req, res);
});

server.listen(PORT, () => {
  console.log(`Nordic Proxy listening on http://localhost:${PORT}`);
});
