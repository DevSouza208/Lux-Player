export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL não informada' });

  try {
    const response = await fetch(targetUrl);
    const data = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');

    return res.status(200).send(data);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao conectar via proxy da Vercel' });
  }
}
