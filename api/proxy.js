export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL não informada' });

  try {
    const response = await fetch(targetUrl);
    
    // Repassa os headers importantes do servidor original
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    const contentType = response.headers.get('content-type') || 'text/plain';
    res.setHeader('Content-Type', contentType);

    // Se for texto/m3u, lê como texto, senão como buffer
    if (contentType.includes('text') || contentType.includes('application') || targetUrl.includes('.m3u')) {
      const data = await response.text();
      return res.status(200).send(data);
    } else {
      const buffer = await response.arrayBuffer();
      return res.status(200).send(Buffer.from(buffer));
    }
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao conectar via proxy da Vercel' });
  }
}
