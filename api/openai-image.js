// Vercel Serverless Function — OpenAI Image API Proxy
// 從 Vercel 美國伺服器發出請求，繞過 OpenAI 地區限制
// 支援 JSON (generations) 和 FormData (edits)

export const config = {
  api: {
    bodyParser: false, // 手動處理 body，支援 FormData
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  // 從 query 取得目標 endpoint：generations 或 edits
  const endpoint = req.query.endpoint || 'generations';
  const targetUrl = `https://api.openai.com/v1/images/${endpoint}`;

  try {
    // 讀取 raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // 轉發請求，保留原始 content-type
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
    };
    
    // 保留原始 content-type（JSON 或 multipart/form-data）
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: rawBody,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('OpenAI proxy error:', error);
    return res.status(500).json({ error: 'Proxy request failed: ' + error.message });
  }
}
