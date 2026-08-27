// Vercel Serverless Function — Vertex AI v1 區域端點代理（Veo predictLongRunning）
// 瀏覽器路徑用 /predictLongRunning，轉成 Google 的 :predictLongRunning
// 目標必須是 us-central1-aiplatform.googleapis.com，全域主機對 Veo 會 404

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
};

const VERTEX_V1_BASE = 'https://us-central1-aiplatform.googleapis.com/v1';
const METHOD_RE = /\/(predictLongRunning|fetchPredictOperation)$/;

function toGoogleUrl(req) {
  const segments = req.query.path;
  let googlePath = Array.isArray(segments) ? segments.join('/') : String(segments || '');
  googlePath = googlePath.replace(/^\/+/, '');
  googlePath = googlePath.replace(METHOD_RE, ':$1');
  return `${VERTEX_V1_BASE}/${googlePath}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Goog-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const apiKey = req.headers['x-goog-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: { message: 'Missing X-Goog-Api-Key' } });
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks);
  const target = toGoogleUrl(req);

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'Content-Type': req.headers['content-type'] || 'application/json',
      },
      body: rawBody,
    });
    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    console.error('Vertex v1 proxy error:', error);
    return res.status(502).json({ error: { message: 'Vertex proxy failed: ' + error.message } });
  }
}
