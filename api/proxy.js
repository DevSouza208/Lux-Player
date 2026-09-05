const { URL } = require('url');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin, User-Agent');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === 'localhost.localdomain') return true;
  if (host === '::1' || host === '[::1]') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (host === '0.0.0.0') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  return false;
}

function proxyUrl(origin, target) {
  return `${origin}/api/proxy?url=${encodeURIComponent(target)}`;
}

function isManifest(url, contentType) {
  const type = String(contentType || '').toLowerCase();
  return /mpegurl|vnd\.apple\.mpegurl/.test(type) || /\.(m3u8?|m3u)(?:$|\?)/i.test(url);
}

function rewriteManifest(text, baseUrl, origin) {
  const lines = text.split(/\r?\n/);

  return lines.map(line => {
    let output = line;

    // Reescreve URI="..." usado por #EXT-X-KEY, #EXT-X-MAP,
    // #EXT-X-MEDIA e outras tags HLS.
    output = output.replace(/URI=("|')([^"']+)\1/gi, (full, quote, value) => {
      try {
        const absolute = new URL(value, baseUrl).href;
        if (/^https?:$/i.test(new URL(absolute).protocol)) {
          return `URI=${quote}${proxyUrl(origin, absolute)}${quote}`;
        }
      } catch (_) {}
      return full;
    });

    const trimmed = output.trim();
    if (!trimmed || trimmed.startsWith('#')) return output;

    // Linhas normais de uma playlist são URLs de segmentos ou playlists-filhas.
    try {
      const absolute = new URL(trimmed, baseUrl).href;
      if (/^https?:$/i.test(new URL(absolute).protocol)) {
        const leading = output.match(/^\s*/)?.[0] || '';
        const trailing = output.match(/\s*$/)?.[0] || '';
        return `${leading}${proxyUrl(origin, absolute)}${trailing}`;
      }
    } catch (_) {}

    return output;
  }).join('\n');
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const rawUrl = req.query && req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    res.status(400).json({ error: 'Parâmetro url ausente.' });
    return;
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch (_) {
    res.status(400).json({ error: 'URL inválida.' });
    return;
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    res.status(400).json({ error: 'Somente URLs HTTP/HTTPS são aceitas.' });
    return;
  }

  if (isBlockedHost(target.hostname)) {
    res.status(403).json({ error: 'Destino não permitido.' });
    return;
  }

  // Evita uma chamada acidental para o próprio proxy.
  if (target.pathname === '/api/proxy' && target.hostname === req.headers.host?.split(':')[0]) {
    res.status(400).json({ error: 'Destino de proxy inválido.' });
    return;
  }

  const headers = {
    'User-Agent': req.headers['user-agent'] || 'LUX-Play-Proxy/1.0',
    'Accept': req.headers.accept || '*/*'
  };

  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
  if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'];

  try {
    const upstream = await fetch(target.href, {
      method: req.method,
      headers,
      redirect: 'follow'
    });

    const finalUrl = upstream.url || target.href;
    const contentType = upstream.headers.get('content-type') || '';

    res.status(upstream.status);

    const passthroughHeaders = [
      'accept-ranges', 'cache-control', 'content-disposition', 'content-length',
      'content-range', 'content-type', 'etag', 'expires', 'last-modified'
    ];

    for (const name of passthroughHeaders) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    // Para playlists, devolvemos uma versão reescrita para que segmentos,
    // chaves e playlists-filhas HTTP também passem pelo HTTPS do LUX Play.
    if (isManifest(finalUrl, contentType)) {
      const body = req.method === 'HEAD' ? '' : await upstream.text();
      const rewritten = rewriteManifest(body, finalUrl, `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`);
      res.removeHeader('content-length');
      res.setHeader('content-type', contentType || 'application/vnd.apple.mpegurl');
      res.setHeader('cache-control', 'no-store');
      res.end(req.method === 'HEAD' ? '' : rewritten);
      return;
    }

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    // Streaming: não carregamos filmes/segmentos inteiros na memória.
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    res.end();
  } catch (error) {
    console.error('LUX proxy error:', error);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Não foi possível acessar o servidor de mídia.', detail: error.message });
    } else {
      res.end();
    }
  }
};
