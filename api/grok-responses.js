// Vercel Serverless Function — xAI Grok API Proxy
// 從 Vercel 伺服器端發出請求，避免瀏覽器 CORS 問題

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.VITE_GROK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Grok API key not configured' });
  }

  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Grok proxy error:', error);
    return res.status(500).json({ error: 'Proxy request failed: ' + error.message });
  }
}
