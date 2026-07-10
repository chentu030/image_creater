import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const stylePath = 'C:/Users/User/Desktop/replicate/繪圖風格'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-images-api',
      configureServer(server) {
        // API 路由：自動保存生成的結果
        server.middlewares.use('/api/save-result', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
              try {
                const { url, filename } = JSON.parse(body);
                const targetDir = 'C:/Users/User/Desktop/replicate/生成結果';
                if (!fs.existsSync(targetDir)) {
                  fs.mkdirSync(targetDir, { recursive: true });
                }
                const outPath = path.join(targetDir, filename);

                let buffer;
                if (typeof url === 'string' && url.startsWith('data:')) {
                  // data URL (例如 Gemini 回傳的 base64 圖片)，直接解碼
                  const base64 = url.slice(url.indexOf(',') + 1);
                  buffer = Buffer.from(base64, 'base64');
                } else {
                  // 從遠端 URL 下載 (Node 18+ 內建 fetch)
                  const response = await fetch(url);
                  const arrayBuffer = await response.arrayBuffer();
                  buffer = Buffer.from(arrayBuffer);
                }

                fs.writeFileSync(outPath, buffer);
                
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, path: outPath }));
              } catch (e) {
                console.error("Save error:", e);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else {
            next();
          }
        });

        // API 路由：回傳圖片清單
        server.middlewares.use('/api/local-images', (req, res, next) => {
          // 只處理這個精確路徑，避免攔截到其他請求
          if (req.url === '/' || req.url === '') {
            try {
              if (!fs.existsSync(stylePath)) {
                res.end(JSON.stringify([]));
                return;
              }
              const files = fs.readdirSync(stylePath);
              const images = files.filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(images));
            } catch (e) {
              res.statusCode = 500;
              res.end(e.message);
            }
          } else {
            next();
          }
        });
        
        // 靜態檔案路由：提供圖片本身
        server.middlewares.use('/local-images', (req, res, next) => {
          const file = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
          if (file) {
            const fullPath = path.join(stylePath, file);
            if (fs.existsSync(fullPath)) {
              // 取得副檔名
              const ext = path.extname(file).slice(1).toLowerCase();
              const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
              res.setHeader('Content-Type', contentType);
              res.end(fs.readFileSync(fullPath));
              return;
            }
          }
          next();
        });
      }
    }
  ],
  server: {
    proxy: {
      '/api/replicate': {
        target: 'https://api.replicate.com/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/replicate/, '')
      },
      // Vertex v1 通道 (Veo 生影片的 predictLongRunning 需走 v1，否則會 RESOURCE_PROJECT_INVALID)
      // 注意：必須放在 /api/vertex 之前（因為 /api/vertex 是其前綴）
      '/api/vertex-v1': {
        target: 'https://aiplatform.googleapis.com/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/vertex-v1/, '')
      },
      '/api/vertex': {
        target: 'https://aiplatform.googleapis.com/v1beta1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/vertex/, '')
      },
      '/api/piapi': {
        target: 'https://api.piapi.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/piapi/, '')
      },
      // kie.ai 檔案上傳 (base64 → 公開 URL)，主機不同
      // 注意：需放在 /api/kie-task 之前，且兩者前綴不可互為子字串
      '/api/kie-file': {
        target: 'https://kieai.redpandaai.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kie-file/, '')
      },
      // kie.ai 統一任務 API (createTask / recordInfo)
      '/api/kie-task': {
        target: 'https://api.kie.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kie-task/, '')
      },
      // OpenAI API (gpt-image-2 生圖)
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, '')
      },
      // Anthropic Claude API
      '/api/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/claude/, '')
      },
      // xAI Grok API
      '/api/grok': {
        target: 'https://api.x.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/grok/, '')
      },
      // Firebase Storage (proxy for CORS)
      '/api/firebase-storage': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/firebase-storage/, '')
      }
    }
  }
})
