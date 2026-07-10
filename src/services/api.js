/**
 * AI Studio API 服務層
 * 與外部 API (Replicate, Vertex AI) 進行通訊。
 */

const REPLICATE_API_KEY = import.meta.env.VITE_REPLICATE_API_KEY;
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const VERTEX_KEYS = import.meta.env.VITE_VERTEX_API_KEYS?.split(',') || [];
let vertexKeyIndex = 0;

function getNextVertexKey() {
  if (VERTEX_KEYS.length === 0) return '';
  const key = VERTEX_KEYS[vertexKeyIndex];
  vertexKeyIndex = (vertexKeyIndex + 1) % VERTEX_KEYS.length;
  return key;
}

// 輔助函式：輪詢 Replicate 狀態
async function pollReplicateStatus(predictionUrl) {
  while (true) {
    const response = await fetch(predictionUrl, {
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const prediction = await response.json();
    if (prediction.status === 'succeeded') {
      return prediction;
    } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error('Prediction failed: ' + prediction.error);
    }
    // 等待 2 秒後再查詢
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// --- 1. Replicate API (生圖) ---
// referenceImages : 風格參考圖（URL 陣列，來自本地風格資料夾）
// targetImageBase64: 角色圖（data URL，選填）—— 要被重繪 / 模仿的角色外觀
// poseReferenceBase64: 迷因/動作參考圖（data URL，選填）—— 要模仿的動作或表情
export const generateImage = async (prompt, referenceImages = [], aspectRatio = '1:1', keepPose = false, modelVersion = 'bytedance/seedream-5-lite', targetImageBase64 = null, poseReferenceBase64 = null) => {
  let imagesBase64 = [];
  
  if (referenceImages && referenceImages.length > 0) {
    // 將所有參考圖片轉為 Base64 Data URI
    try {
      const promises = referenceImages.map(async (url) => {
        // 已經是 data URL → 直接用
        if (url.startsWith('data:')) return url;
        
        // Firebase Storage URL → 走 proxy 避免 CORS
        let fetchUrl = url;
        if (url.includes('firebasestorage.googleapis.com')) {
          fetchUrl = url.replace('https://firebasestorage.googleapis.com', '/api/firebase-storage');
        }
        
        // 用 fetch 透過 proxy 取圖片
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      });
      imagesBase64 = await Promise.all(promises);
    } catch (err) {
      console.error('參考圖轉換失敗:', err);
      throw new Error('無法讀取參考圖片：' + err.message);
    }
  }

  // 組裝 image_input：風格參考 → 角色圖 → 迷因動作參考
  let finalPrompt = prompt;
  if (targetImageBase64) imagesBase64.push(targetImageBase64);
  if (poseReferenceBase64) imagesBase64.push(poseReferenceBase64);

  if (poseReferenceBase64 && targetImageBase64) {
    const strictPose = keepPose ? '，動作與表情需盡可能一致' : '';
    finalPrompt = `${prompt}\n\n（迷因動作模仿：前面的圖片為「風格參考圖」，倒數第二張為「角色圖」（保留此外觀、五官與服裝特徵），最後一張為「動作/表情參考圖」（迷因梗圖）。請讓角色圖中的角色，模仿最後一張參考圖的動作、肢體姿勢與面部表情，並以風格參考圖的畫風重新繪製${strictPose}。不要複製迷因圖中的其他人物或背景，只取動作與表情。）`;
  } else if (poseReferenceBase64) {
    const strictPose = keepPose ? '，動作與表情需盡可能一致' : '';
    finalPrompt = `${prompt}\n\n（迷因動作模仿：前面的圖片為「風格/角色參考圖」，最後一張為「動作/表情參考圖」（迷因梗圖）。請以參考圖的畫風與角色外觀，模仿最後一張迷因圖的動作、肢體姿勢與面部表情${strictPose}。不要複製迷因圖中的其他人物或背景，只取動作與表情。）`;
  } else if (targetImageBase64) {
    const poseNote = keepPose ? '，並保留其姿勢、構圖與大小' : '';
    finalPrompt = `${prompt}\n\n（風格轉繪：前面的圖片為「風格參考圖」，最後一張為「目標圖」。請以參考圖的畫風，重新繪製目標圖中的角色，保留該角色的外觀特徵與五官${poseNote}，僅改變繪畫風格。）`;
  }
  
  const input = {
    prompt: finalPrompt,
    aspect_ratio: aspectRatio, // 1:1, 16:9 etc
    size: "2K",
    output_format: "png",
  };

  if (imagesBase64.length > 0) {
    // Seedream 模型要求 image_input 為陣列格式，支援多張圖作為風格參考 + 目標圖
    input.image_input = imagesBase64;
    // 雖然 4.5 的 Schema 沒寫 style_strength，但我們仍可以嘗試傳遞或透過 prompt 強化
    // input.style_strength = 0.85; 
  }

  const response = await fetch(`/api/replicate/models/${modelVersion}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || '生圖 API 呼叫失敗');
  }

  const prediction = await response.json();
  const getUrl = prediction.urls.get.replace('https://api.replicate.com/v1', '/api/replicate');
  
  const finalPrediction = await pollReplicateStatus(getUrl);
  // Flux 通常返回一個圖片 URL 的陣列，Seedream 也類似
  const outputUrl = Array.isArray(finalPrediction.output) ? finalPrediction.output[0] : finalPrediction.output;
  
  // 自動保存到本機（固定 PNG）
  try {
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: outputUrl, filename: `seedream-${Date.now()}.png` })
    });
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return {
    status: 'succeeded',
    output: outputUrl
  };
};

// --- 2. Replicate API (動畫) ---
export const generateAnimation = async (modelId, motionScore, imageUrls) => {
  let endpoint = '';
  let payload = {};

  const images = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);

  if (modelId === 'tooncrafter') {
    if (images.length < 2) {
      throw new Error("ToonCrafter 是「插幀動畫模型」，必須上傳至少 2 張圖片作為首幀與尾幀！");
    }
    endpoint = '/api/replicate/predictions';
    payload = {
      version: "0486ff07368e816ec3d5c69b9581e7a09b55817f567a0d74caad9395c9295c77",
      input: {
        image_1: images[0],
        image_2: images[1],
        prompt: "a cartoon animation",
        max_width: 512,
        max_height: 512,
        interpolate: true,
        loop: false,
        color_correction: true
      }
    };
    // 支援最多 10 張中間幀
    for (let i = 2; i < Math.min(images.length, 10); i++) {
      payload.input[`image_${i + 1}`] = images[i];
    }
  } else if (modelId === 'wan2.7') {
    // Wan 2.7 I2V - 官方模型，使用 models endpoint
    if (images.length < 1) {
      throw new Error("Wan 2.7 需要至少上傳 1 張圖片作為首幀！");
    }
    endpoint = '/api/replicate/models/wan-video/wan-2.7-i2v/predictions';
    payload = {
      input: {
        first_frame: images[0],
        prompt: "animate this illustration with gentle movement",
        duration: 5,
        resolution: "720p",
        enable_prompt_expansion: true
      }
    };
    // 如果有第二張圖，作為尾幀（首尾幀控制）
    if (images[1]) {
      payload.input.last_frame = images[1];
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const detail = errBody.detail || JSON.stringify(errBody);
    throw new Error(`動畫生成呼叫失敗 (${response.status}): ${detail}`);
  }

  const prediction = await response.json();
  const getUrl = prediction.urls.get.replace('https://api.replicate.com/v1', '/api/replicate');
  
  const finalPrediction = await pollReplicateStatus(getUrl);
  // ToonCrafter 回傳的 output 是陣列格式 (array of URIs)
  const rawOutput = finalPrediction.output;
  const outputUrl = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;
  
  // 自動保存到本機
  try {
    const ext = outputUrl.includes('.webm') ? 'webm' : 'mp4';
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: outputUrl, filename: `animation-${Date.now()}.${ext}` })
    });
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return {
    status: 'succeeded',
    output: outputUrl
  };
};

// --- PiAPI 設定 ---
const PIAPI_KEY = 'ec1cdb74564be31d9b715e23c97f2ea8346296ee49b72c0f93c711168a872e99';

// PiAPI 影片模型定義 (Task API endpoint)
// 目前僅保留 Seedance 2.0（圖生影片）。其餘 PiAPI 模型已依需求移除。
export const PIAPI_MODELS = [
  { id: 'seedance-2', name: 'Seedance 2.0', desc: 'ByteDance 圖生影片', apiModel: 'seedance', taskType: 'seedance-2', needImage: true },
];

// PiAPI 輪詢狀態
async function pollPiAPIStatus(taskId) {
  while (true) {
    const response = await fetch(`/api/piapi/api/v1/task/${taskId}`, {
      headers: { 'X-API-Key': PIAPI_KEY }
    });
    const result = await response.json();
    // PiAPI 狀態實際回傳為小寫 (completed/processing/pending/staged/failed)，統一轉小寫比對
    const status = (result?.data?.status || '').toLowerCase();

    if (status === 'completed') {
      return result.data;
    } else if (status === 'failed' || status === 'error') {
      throw new Error('PiAPI 任務失敗: ' + (result?.data?.error?.message || JSON.stringify(result?.data?.error || '未知錯誤')));
    }
    // pending / processing / staged：繼續等待
    // 等待 3 秒（PiAPI 影片生成通常較慢）
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// --- 3. PiAPI API (影片生成) — Seedance 2.0 ---
// 依官方文件 (https://piapi.ai/docs/seedance-api/seedance-2.md)：
//   model = "seedance"、task_type = "seedance-2"
//   input.mode 為必填：有參考圖 → first_last_frames（圖生影片），否則 text_to_video
//   圖片以 image_urls 陣列傳入，duration 需為 4~15 的整數，回傳結果在 output.video
export const generateVideoPiAPI = async (modelId, prompt, imageBase64 = null, duration = 5) => {
  const modelDef = PIAPI_MODELS.find(m => m.id === modelId);
  if (!modelDef) throw new Error(`未知的 PiAPI 影片模型: ${modelId}`);
  const apiModel = modelDef.apiModel;
  const taskType = modelDef.taskType;

  // Seedance duration 限制為 4~15 秒的整數
  const dur = Math.min(15, Math.max(4, parseInt(duration, 10) || 5));

  const input = {
    prompt,
    duration: dur,
    resolution: '720p',
  };

  if (imageBase64) {
    // 圖生影片：使用 1 張參考圖作為首幀
    input.mode = 'first_last_frames';
    input.image_urls = [imageBase64];
    input.aspect_ratio = 'auto'; // 依首張圖比例自動判斷
  } else {
    // 純文字生成影片
    input.mode = 'text_to_video';
    input.aspect_ratio = '16:9';
  }

  const payload = {
    model: apiModel,
    task_type: taskType,
    input,
    config: {
      service_mode: 'public'
    }
  };

  const response = await fetch('/api/piapi/api/v1/task', {
    method: 'POST',
    headers: {
      'X-API-Key': PIAPI_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(`PiAPI 呼叫失敗 (${response.status}): ${JSON.stringify(errBody)}`);
  }

  const result = await response.json();
  const taskId = result?.data?.task_id;
  if (!taskId) {
    throw new Error('PiAPI 未回傳 task_id: ' + JSON.stringify(result));
  }

  // 輪詢等待完成
  const finalResult = await pollPiAPIStatus(taskId);
  
  // 取得影片 URL (PiAPI 回傳格式因模型而異)
  const output = finalResult.output;
  let videoUrl = null;
  if (typeof output === 'string') {
    videoUrl = output;
  } else if (output?.video_url) {
    videoUrl = output.video_url;
  } else if (output?.works?.[0]?.resource?.resource) {
    videoUrl = output.works[0].resource.resource;
  } else if (output?.video) {
    videoUrl = output.video;
  } else if (Array.isArray(output) && output[0]) {
    videoUrl = typeof output[0] === 'string' ? output[0] : output[0]?.url || output[0]?.video_url;
  }

  if (!videoUrl) {
    throw new Error('PiAPI 無法解析影片 URL: ' + JSON.stringify(output));
  }

  // 自動保存
  try {
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, filename: `piapi-${modelId}-${Date.now()}.mp4` })
    });
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return {
    status: 'succeeded',
    output: videoUrl
  };
};

// ============================================================
// kie.ai API (圖生影片) — Seedance 2.0 Mini / Wan 2.7
// 文件：https://docs.kie.ai
//   建立任務：POST /api/v1/jobs/createTask   { model, input }  (Bearer 認證)
//   查詢任務：GET  /api/v1/jobs/recordInfo?taskId=...
//   圖片上傳：POST (kieai.redpandaai.co) /api/file-base64-upload  → downloadUrl
// ============================================================
const KIE_KEY = '4c5087c82196c40296e0f5592fb66e20';

// kie.ai 圖生影片模型定義
export const KIE_VIDEO_MODELS = [
  { id: 'kie-seedance-2-mini', name: 'Seedance 2.0 Mini 720p (kie.ai)', desc: 'ByteDance 圖生影片 720p', model: 'bytedance/seedance-2-mini', resolution: '720p' },
  { id: 'kie-seedance-2-mini-480', name: 'Seedance 2.0 Mini 480p (kie.ai)', desc: 'ByteDance 圖生影片 480p', model: 'bytedance/seedance-2-mini', resolution: '480p' },
  { id: 'kie-wan-2.7', name: 'Wan 2.7 (kie.ai)', desc: '阿里通義萬相 圖生影片 720p', model: 'wan/2-7-image-to-video', resolution: '720p' },
  { id: 'kie-happyhorse-1.1', name: 'HappyHorse 1.1 (kie.ai)', desc: '阿里 HappyHorse 圖生影片 720p', model: 'happyhorse-1-1/image-to-video', resolution: '720p' },
];

// 將 base64/data URL 圖片上傳到 kie.ai，回傳可公開存取的 URL
// label 用於區分檔名（例如 'first' / 'last'），避免同毫秒上傳撞名覆蓋
async function uploadImageToKie(base64DataUrl, label = 'img') {
  const uniqueName = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.png`;
  const response = await fetch('/api/kie-file/api/file-base64-upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      base64Data: base64DataUrl,
      uploadPath: 'images/ai-studio',
      fileName: uniqueName
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`kie.ai 圖片上傳失敗 (${response.status}): ${errBody}`);
  }

  const json = await response.json();
  const url = json?.data?.downloadUrl || json?.data?.fileUrl;
  if (!url) throw new Error('kie.ai 圖片上傳未回傳 URL: ' + JSON.stringify(json));
  return url;
}

// 輪詢 kie.ai 任務狀態
async function pollKieStatus(taskId) {
  while (true) {
    const response = await fetch(`/api/kie-task/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${KIE_KEY}` }
    });
    const json = await response.json();
    const data = json?.data;
    const state = data?.state; // waiting / queuing / generating / success / fail

    if (state === 'success') {
      return data;
    } else if (state === 'fail') {
      throw new Error('kie.ai 任務失敗: ' + (data?.failMsg || data?.failCode || '未知錯誤'));
    }
    // waiting / queuing / generating：繼續等待
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// --- kie.ai 圖生影片 ---
// modelId: KIE_VIDEO_MODELS 的 id
// prompt : 額外提示詞（描述想要的動態效果）
// images : 首幀圖片 (data URL) 或圖片陣列 [首幀, 尾幀]。第 1 張為首幀（必填），第 2 張為尾幀（選填）
// duration: 影片秒數 (4~15)
export const generateVideoKie = async (modelId, prompt, images = null, duration = 5) => {
  const modelDef = KIE_VIDEO_MODELS.find(m => m.id === modelId);
  if (!modelDef) throw new Error(`未知的 kie.ai 模型: ${modelId}`);

  // 兼容「單張字串」或「圖片陣列」兩種輸入
  const imgs = Array.isArray(images) ? images.filter(Boolean) : (images ? [images] : []);
  if (imgs.length === 0) {
    throw new Error('此為「圖生影片」模型，請先上傳一張圖片作為首幀（可再上傳第二張作為尾幀）');
  }

  // Seedance / Wan 要求必填 prompt；HappyHorse 的 prompt 為選填
  const promptRequired = modelDef.model !== 'happyhorse-1-1/image-to-video';
  if (promptRequired && (!prompt || !prompt.trim())) {
    throw new Error('請輸入提示詞 (prompt) 描述想要的影片動態');
  }

  const dur = Math.min(15, Math.max(4, parseInt(duration, 10) || 5));
  const resolution = modelDef.resolution || '720p';

  // 首幀（必要）與尾幀（選填）皆需先上傳成公開 URL（kie.ai 需要 URL 而非 base64）
  // 用不同 label 確保檔名不同，避免覆蓋導致首尾幀指到同一張
  const firstFrameUrl = await uploadImageToKie(imgs[0], 'first');
  const lastFrameUrl = imgs[1] ? await uploadImageToKie(imgs[1], 'last') : null;

  let input;
  if (modelDef.model === 'bytedance/seedance-2-mini') {
    input = {
      prompt,
      first_frame_url: firstFrameUrl,
      resolution,
      aspect_ratio: 'adaptive', // 依首幀圖片比例自動判斷
      duration: dur,
      generate_audio: false,
    };
    if (lastFrameUrl) input.last_frame_url = lastFrameUrl; // 首尾幀模式
  } else if (modelDef.model === 'happyhorse-1-1/image-to-video') {
    // HappyHorse 1.1：首幀圖片放在 image_urls 陣列（僅支援 1 張，不支援尾幀）
    input = {
      image_urls: [firstFrameUrl],
      resolution,
      duration: dur,
    };
    if (prompt && prompt.trim()) input.prompt = prompt;
  } else {
    // wan/2-7-image-to-video
    input = {
      prompt,
      first_frame_url: firstFrameUrl,
      resolution,
      duration: dur,
      prompt_extend: true,
    };
    if (lastFrameUrl) input.last_frame_url = lastFrameUrl; // 首尾幀模式
  }

  const response = await fetch('/api/kie-task/api/v1/jobs/createTask', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: modelDef.model, input })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.code !== 200) {
    throw new Error(`kie.ai 建立任務失敗 (${response.status}): ${json.msg || JSON.stringify(json)}`);
  }

  const taskId = json?.data?.taskId;
  if (!taskId) throw new Error('kie.ai 未回傳 taskId: ' + JSON.stringify(json));

  const finalData = await pollKieStatus(taskId);

  // 解析結果 URL：resultJson 是字串，格式 {"resultUrls":["..."]}
  let videoUrl = null;
  try {
    const result = JSON.parse(finalData.resultJson || '{}');
    videoUrl = Array.isArray(result.resultUrls) ? result.resultUrls[0] : null;
  } catch {
    // 解析失敗時 videoUrl 維持 null
  }

  if (!videoUrl) {
    throw new Error('kie.ai 無法解析影片 URL: ' + (finalData.resultJson || '(空)'));
  }

  // 自動保存到本機
  try {
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, filename: `kie-${modelId}-${Date.now()}.mp4` })
    });
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return {
    status: 'succeeded',
    output: videoUrl
  };
};

// PiAPI 圖片生成模型定義
// apiModel + taskType 直接對應 API 的 model + task_type
// api: 'task' = 標準 Qubico Task API
// api: 'seedream' = model="seedream", task_type 為版本
// api: 'gemini' = model="gemini", task_type 為模型名
// api: 'openai' = /v1/images/generations (同步)
// 依需求：暫時移除所有 PiAPI 圖片模型（風格繪圖區僅保留 Replicate Seedream）。
// 之後若要重新加入，直接補回對應的模型定義即可。
export const PIAPI_IMAGE_MODELS = [];

// --- 4. PiAPI API (圖片生成) ---
export const generateImagePiAPI = async (modelId, prompt, referenceImageBase64 = null, aspectRatio = '1:1') => {
  const modelDef = PIAPI_IMAGE_MODELS.find(m => m.id === modelId);
  const apiType = modelDef?.api || 'task';

  let imageUrl = null;

  if (apiType === 'task' || apiType === 'seedream' || apiType === 'gemini') {
    // ===== 統一 Task API =====
    const apiModel = modelDef?.apiModel || modelId;
    let taskType = modelDef?.taskType || 'txt2img';
    const input = { prompt };

    if (apiType === 'task') {
      // Qubico 模型用 width/height
      const widthMap = { '1:1': 1024, '16:9': 1792, '9:16': 1024 };
      const heightMap = { '1:1': 1024, '16:9': 1024, '9:16': 1792 };
      input.width = widthMap[aspectRatio] || 1024;
      input.height = heightMap[aspectRatio] || 1024;
      // 有參考圖時切換為 img2img（kontext 保持原 taskType）
      if (referenceImageBase64) {
        taskType = modelDef?.refTaskType || taskType;
        input.image = referenceImageBase64;
      }
    } else if (apiType === 'seedream') {
      // Seedream 用 aspect_ratio + output_format
      input.aspect_ratio = aspectRatio;
      input.output_format = 'png';
      input.size = '2K';
      if (referenceImageBase64) input.image_urls = [referenceImageBase64];
    } else {
      // gemini 格式
      input.aspect_ratio = aspectRatio;
      input.output_format = 'png';
      if (referenceImageBase64) input.image = referenceImageBase64;
    }

    const payload = { model: apiModel, task_type: taskType, input };

    const response = await fetch('/api/piapi/api/v1/task', {
      method: 'POST',
      headers: { 'X-API-Key': PIAPI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`PiAPI 圖片生成失敗 (${response.status}): ${JSON.stringify(errBody)}`);
    }

    const result = await response.json();
    const taskId = result?.data?.task_id;
    if (!taskId) throw new Error('PiAPI 未回傳 task_id: ' + JSON.stringify(result));

    // Seedream 是同步回傳，但也有 task_id 可輪詢
    if (result?.data?.output) {
      imageUrl = extractImageUrl(result.data.output);
    } else {
      const finalResult = await pollPiAPIStatus(taskId);
      imageUrl = extractImageUrl(finalResult.output);
    }

  } else {
    // ===== OpenAI 兼容 endpoint (同步) =====
    const sizeMap = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792' };

    const payload = {
      model: modelId,
      prompt,
      n: 1,
      size: sizeMap[aspectRatio] || '1024x1024',
    };

    const response = await fetch('/api/piapi/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PIAPI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`PiAPI 圖片生成失敗 (${response.status}): ${JSON.stringify(errBody)}`);
    }

    const result = await response.json();
    if (result?.data?.[0]?.url) {
      imageUrl = result.data[0].url;
    } else if (result?.data?.[0]?.b64_json) {
      imageUrl = `data:image/png;base64,${result.data[0].b64_json}`;
    }
  }

  if (!imageUrl) {
    throw new Error('PiAPI 無法解析圖片 URL');
  }

  // 自動保存
  try {
    if (imageUrl.startsWith('http')) {
      await fetch('/api/save-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, filename: `piapi-${modelId.replace('/', '-')}-${Date.now()}.png` })
      });
    }
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return { status: 'succeeded', output: imageUrl };
};

// 從 PiAPI 回傳解析圖片 URL
function extractImageUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (output.image_url) return output.image_url;
  if (output.image_urls?.[0]) return output.image_urls[0];
  if (Array.isArray(output) && output[0]) {
    return typeof output[0] === 'string' ? output[0] : (output[0]?.url || output[0]?.image_url);
  }
  return null;
}

// ============================================================
// OpenAI GPT Image (gpt-image-2)
// Endpoint: POST /v1/images/generations
// 回傳 b64_json，轉為 data URL 顯示
// ============================================================
export const OPENAI_IMAGE_MODELS = [
  { id: 'gpt-image-2', name: 'GPT Image 2', desc: 'OpenAI 高品質生圖', model: 'gpt-image-2-2026-04-21' },
];

export const generateImageOpenAI = async (prompt, referenceImages = [], aspectRatio = '1:1') => {
  if (!OPENAI_API_KEY) throw new Error('找不到 OpenAI API Key（請在 .env 設定 VITE_OPENAI_API_KEY）');

  // 尺寸對應
  const sizeMap = { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' };
  const size = sizeMap[aspectRatio] || '1024x1024';

  // 如果有參考圖，用 /v1/images/edits（圖片編輯模式）
  if (referenceImages.length > 0) {
    // 取第一張參考圖轉為 Blob
    let imageBlob;
    const refUrl = referenceImages[0];
    // Firebase Storage URL → 走 proxy
    let fetchRefUrl = refUrl;
    if (refUrl.includes('firebasestorage.googleapis.com')) {
      fetchRefUrl = refUrl.replace('https://firebasestorage.googleapis.com', '/api/firebase-storage');
    }
    const refRes = await fetch(fetchRefUrl);
    imageBlob = await refRes.blob();

    const formData = new FormData();
    formData.append('model', 'gpt-image-2-2026-04-21');
    formData.append('prompt', prompt);
    formData.append('image[]', imageBlob, 'reference.png');
    formData.append('size', size);
    formData.append('quality', 'high');

    const response = await fetch('/api/openai-image?endpoint=edits', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI 圖片編輯失敗 (${response.status})`);
    }

    const result = await response.json();
    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI 未回傳圖片');
    const imageUrl = `data:image/png;base64,${b64}`;

    // 自動保存到本機
    try {
      await fetch('/api/save-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, filename: `gpt-image-${Date.now()}.png` })
      });
    } catch (e) { console.error('自動存檔失敗', e); }

    return { status: 'succeeded', output: imageUrl };
  }

  // 純文字生圖
  const payload = {
    model: 'gpt-image-2-2026-04-21',
    prompt,
    n: 1,
    size,
    quality: 'high',
  };

  const response = await fetch('/api/openai-image?endpoint=generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI 生圖失敗 (${response.status})`);
  }

  const result = await response.json();
  let imageUrl;
  if (result?.data?.[0]?.b64_json) {
    imageUrl = `data:image/png;base64,${result.data[0].b64_json}`;
  } else if (result?.data?.[0]?.url) {
    imageUrl = result.data[0].url;
  } else {
    throw new Error('OpenAI 未回傳圖片');
  }

  // 自動保存到本機
  try {
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl, filename: `gpt-image-${Date.now()}.png` })
    });
  } catch (e) { console.error('自動存檔失敗', e); }

  return { status: 'succeeded', output: imageUrl };
};

// ============================================================
// Google Vertex AI (生圖) — Gemini 3.1 Flash Image / Gemini 3 Pro Image
// 走 Vertex 通道（不使用 gemini 通道），沿用既有 X-Goog-Api-Key 金鑰輪詢
// endpoint: /publishers/google/models/{model}:generateContent
// 回傳的圖片在 candidates[].content.parts[].inlineData (base64)
// ============================================================
export const VERTEX_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', desc: 'Google 快速生圖 (Vertex)', model: 'gemini-3.1-flash-image' },
  { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image', desc: 'Google 高品質生圖 (Vertex)', model: 'gemini-3-pro-image' },
];

// data URL → { mimeType, data(base64) }
function dataUrlToInlineData(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

// 一般 URL（含本地 /local-images/...）→ inlineData
async function urlToInlineData(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return dataUrlToInlineData(dataUrl);
}

// --- 4.5 Vertex AI 生圖 ---
// 參數與 generateImage 對齊：風格參考圖(URL陣列) + 角色圖 + 迷因動作圖
export const generateImageVertex = async (modelId, prompt, referenceImages = [], aspectRatio = '1:1', keepPose = false, targetImageBase64 = null, memeImageBase64 = null) => {
  const modelDef = VERTEX_IMAGE_MODELS.find(m => m.id === modelId);
  const modelName = modelDef?.model || modelId;
  const apiKey = getNextVertexKey();
  if (!apiKey) throw new Error('找不到 Vertex AI API Key');

  const parts = [];

  // 風格參考圖（本地 URL）
  if (referenceImages && referenceImages.length > 0) {
    for (const refUrl of referenceImages) {
      try {
        const inline = await urlToInlineData(refUrl);
        if (inline) parts.push({ inlineData: inline });
      } catch (e) {
        console.warn('參考圖轉換失敗', e);
      }
    }
  }
  // 角色圖
  if (targetImageBase64) {
    const t = dataUrlToInlineData(targetImageBase64);
    if (t) parts.push({ inlineData: t });
  }
  // 迷因/動作參考圖
  if (memeImageBase64) {
    const m = dataUrlToInlineData(memeImageBase64);
    if (m) parts.push({ inlineData: m });
  }

  // 依附圖組合提示詞（與 generateImage 邏輯一致）
  let finalPrompt = prompt;
  if (memeImageBase64 && targetImageBase64) {
    const strictPose = keepPose ? '，動作與表情需盡可能一致' : '';
    finalPrompt = `${prompt}\n\n（迷因動作模仿：前面的圖片為「風格參考圖」，倒數第二張為「角色圖」（保留此外觀、五官與服裝特徵），最後一張為「動作/表情參考圖」（迷因梗圖）。請讓角色圖中的角色，模仿最後一張參考圖的動作、肢體姿勢與面部表情，並以風格參考圖的畫風重新繪製${strictPose}。不要複製迷因圖中的其他人物或背景，只取動作與表情。）`;
  } else if (memeImageBase64) {
    const strictPose = keepPose ? '，動作與表情需盡可能一致' : '';
    finalPrompt = `${prompt}\n\n（迷因動作模仿：前面的圖片為「風格/角色參考圖」，最後一張為「動作/表情參考圖」（迷因梗圖）。請以參考圖的畫風與角色外觀，模仿最後一張迷因圖的動作、肢體姿勢與面部表情${strictPose}。不要複製迷因圖中的其他人物或背景，只取動作與表情。）`;
  } else if (targetImageBase64) {
    const poseNote = keepPose ? '，並保留其姿勢、構圖與大小' : '';
    finalPrompt = `${prompt}\n\n（風格轉繪：前面的圖片為「風格參考圖」，最後一張為「目標圖」。請以參考圖的畫風，重新繪製目標圖中的角色，保留該角色的外觀特徵與五官${poseNote}，僅改變繪畫風格。）`;
  }

  parts.push({ text: finalPrompt });

  const url = `/api/vertex/publishers/google/models/${modelName}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio }
      }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Vertex 生圖失敗 (${response.status})`);
  }

  const data = await response.json();
  const outParts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = outParts.find(p => p.inlineData?.data);
  if (!imgPart) {
    throw new Error('Vertex 未回傳圖片，可能被安全審查阻擋: ' + JSON.stringify(data).slice(0, 400));
  }
  const mime = imgPart.inlineData.mimeType || 'image/png';
  const imageUrl = `data:${mime};base64,${imgPart.inlineData.data}`;

  // 自動保存到本機（save-result 已支援 data URL）
  try {
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl, filename: `vertex-${modelId}-${Date.now()}.png` })
    });
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return { status: 'succeeded', output: imageUrl };
};

// ============================================================
// Google Vertex AI (生影片) — Veo 3.1 系列
// 走 Vertex 通道（X-Goog-Api-Key 金鑰輪詢），使用長時任務 (LRO)：
//   啟動：POST /projects/{proj}/locations/{loc}/publishers/google/models/{model}:predictLongRunning
//   輪詢：POST /projects/{proj}/locations/{loc}/publishers/google/models/{model}:fetchPredictOperation
//   完成後影片以 base64 (response.videos[].bytesBase64Encoded) 回傳
//
// 注意：
//   - Veo 的 predictLongRunning 必須走 v1 + 含 project/location 的完整資源路徑，
//     用 express 全域路徑 (無 project) 會回 RESOURCE_PROJECT_INVALID。
//   - AQ. 金鑰綁定的專案為 858120002417；GA 模型名稱為 *-generate-001，
//     preview 版 (*-generate-preview) 已下架會回 404。
// ============================================================
const VERTEX_PROJECT_ID = '858120002417';
const VERTEX_LOCATION = 'us-central1';

export const VERTEX_VIDEO_MODELS = [
  { id: 'veo-3.1', name: 'Veo 3.1 (Vertex)', desc: 'Google Veo 3.1 標準', model: 'veo-3.1-generate-001' },
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast (Vertex)', desc: 'Google Veo 3.1 快速', model: 'veo-3.1-fast-generate-001' },
  { id: 'veo-3.1-lite', name: 'Veo 3.1 Lite (Vertex)', desc: 'Google Veo 3.1 輕量', model: 'veo-3.1-lite-generate-001' },
];

const vertexVeoBase = (modelName) =>
  `/api/vertex-v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${modelName}`;

// --- Vertex Veo 生影片 ---
// imageBase64: 首幀圖片 (data URL，選填 → 有則為圖生影片，無則為文生影片)
// duration: 影片秒數（Veo 3.x 支援 4~8 秒）
// aspectRatio: '16:9' | '9:16'
export const generateVideoVertexVeo = async (modelId, prompt, imageBase64 = null, duration = 8, aspectRatio = '16:9') => {
  const modelDef = VERTEX_VIDEO_MODELS.find(m => m.id === modelId);
  const modelName = modelDef?.model || modelId;
  const apiKey = getNextVertexKey();
  if (!apiKey) throw new Error('找不到 Vertex AI API Key');
  if (!prompt || !prompt.trim()) throw new Error('請輸入提示詞 (prompt) 描述想要的影片');

  const instance = { prompt };
  if (imageBase64) {
    const inline = dataUrlToInlineData(imageBase64);
    if (inline) instance.image = { bytesBase64Encoded: inline.data, mimeType: inline.mimeType };
  }

  const parameters = {
    aspectRatio,
    durationSeconds: Math.min(8, Math.max(4, parseInt(duration, 10) || 8)),
    sampleCount: 1,
    generateAudio: true,
    resolution: '720p',
  };

  // 1) 啟動長時任務（Veo 需走 v1 + 含 project/location 的完整資源路徑）
  const startRes = await fetch(`${vertexVeoBase(modelName)}:predictLongRunning`, {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [instance], parameters })
  });
  if (!startRes.ok) {
    const e = await startRes.json().catch(() => ({}));
    throw new Error(e.error?.message || `Veo 啟動失敗 (${startRes.status})`);
  }
  const startJson = await startRes.json();
  const opName = startJson.name;
  if (!opName) throw new Error('Veo 未回傳 operation name: ' + JSON.stringify(startJson));

  // 2) 輪詢直到完成
  let finalOp = null;
  while (true) {
    await new Promise(r => setTimeout(r, 8000));
    const pollRes = await fetch(`${vertexVeoBase(modelName)}:fetchPredictOperation`, {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: opName })
    });
    if (!pollRes.ok) {
      const e = await pollRes.json().catch(() => ({}));
      throw new Error(e.error?.message || `Veo 輪詢失敗 (${pollRes.status})`);
    }
    const pollJson = await pollRes.json();
    if (pollJson.done) {
      if (pollJson.error) throw new Error('Veo 生成失敗: ' + (pollJson.error.message || JSON.stringify(pollJson.error)));
      finalOp = pollJson;
      break;
    }
  }

  // 3) 解析影片（兼容多種回傳結構）
  const resp = finalOp.response || {};
  const samples = resp.videos || resp.generatedSamples || resp.generated_samples || [];
  let videoUrl = null;
  if (Array.isArray(samples) && samples[0]) {
    const s = samples[0];
    if (s.bytesBase64Encoded) videoUrl = `data:${s.mimeType || 'video/mp4'};base64,${s.bytesBase64Encoded}`;
    else if (s.video?.bytesBase64Encoded) videoUrl = `data:${s.video.mimeType || 'video/mp4'};base64,${s.video.bytesBase64Encoded}`;
    else if (s.video?.uri) videoUrl = s.video.uri;
    else if (s.uri) videoUrl = s.uri;
  }
  if (!videoUrl) throw new Error('Veo 無法解析影片，可能被安全審查阻擋: ' + JSON.stringify(resp).slice(0, 400));

  // 自動保存到本機（save-result 已支援 data URL）
  try {
    await fetch('/api/save-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, filename: `veo-${modelId}-${Date.now()}.mp4` })
    });
  } catch (e) {
    console.error("自動存檔失敗", e);
  }

  return { status: 'succeeded', output: videoUrl };
};

// ============================================================
// LLM Chat API — 多模型支援（Gemini / Claude / Grok）+ 聯網搜尋
// ============================================================
const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY;
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;

// 可用的聊天模型
export const CHAT_MODELS = [
  { id: 'gemini', name: 'Gemini 3 Flash', provider: 'google' },
  { id: 'claude', name: 'Claude Sonnet 5', provider: 'anthropic' },
  { id: 'grok', name: 'Grok 4.5', provider: 'xai' },
];

// --- Gemini (Vertex AI) ---
export const chatWithAI = async (messageHistory, webSearch = true) => {
  const apiKey = getNextVertexKey();
  if (!apiKey) throw new Error('找不到 Vertex AI API Key');

  const url = `/api/vertex/publishers/google/models/gemini-3-flash-preview:generateContent`;
  const contents = messageHistory.map(msg => ({
    role: msg.role === 'system' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  const body = { contents };
  if (webSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Gemini API 呼叫失敗');
  }

  const data = await response.json();
  const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '(無回覆)';
  return { role: 'system', content: replyText };
};

// --- Gemini with Images ---
export const chatWithAIAndImages = async (messageHistory, imageDataUrls = [], webSearch = true) => {
  const apiKey = getNextVertexKey();
  if (!apiKey) throw new Error('找不到 Vertex AI API Key');

  const url = `/api/vertex/publishers/google/models/gemini-3-flash-preview:generateContent`;
  const contents = messageHistory.map(msg => {
    const parts = [];
    if (msg.images && msg.images.length > 0) {
      for (const imgUrl of msg.images) {
        const inline = dataUrlToInlineData(imgUrl);
        if (inline) parts.push({ inlineData: inline });
      }
    }
    parts.push({ text: msg.content });
    return { role: msg.role === 'system' ? 'model' : 'user', parts };
  });

  if (imageDataUrls.length > 0 && contents.length > 0) {
    const lastUserIdx = contents.length - 1;
    const imageParts = [];
    for (const imgUrl of imageDataUrls) {
      const inline = dataUrlToInlineData(imgUrl);
      if (inline) imageParts.push({ inlineData: inline });
    }
    contents[lastUserIdx].parts = [...imageParts, ...contents[lastUserIdx].parts];
  }

  const body = { contents };
  if (webSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Gemini API 呼叫失敗');
  }

  const data = await response.json();
  const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '(無回覆)';
  return { role: 'system', content: replyText };
};

// --- Claude (Anthropic Messages API) ---
export const chatWithClaude = async (messageHistory, webSearch = true) => {
  if (!CLAUDE_API_KEY) throw new Error('找不到 Claude API Key');

  // Anthropic 格式：messages 陣列，role 為 user / assistant
  // 過濾掉空訊息，確保首則為 user
  const messages = messageHistory
    .filter(msg => msg.content && msg.content.trim())
    .map(msg => ({
      role: msg.role === 'system' ? 'assistant' : 'user',
      content: msg.content
    }));

  // Anthropic 要求 messages 第一則必須是 user
  if (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  const body = {
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages
  };

  // 聯網搜尋：使用 Anthropic 的 web_search server tool
  if (webSearch) {
    body.tools = [{
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: 5
    }];
  }

  const response = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API 呼叫失敗 (${response.status})`);
  }

  const data = await response.json();

  // Claude 回傳格式：content 為陣列，取 text type 的內容
  let replyText = '(無回覆)';
  if (data.content && Array.isArray(data.content)) {
    const textParts = data.content.filter(c => c.type === 'text');
    if (textParts.length > 0) {
      replyText = textParts.map(t => t.text).join('\n');
    }
  }

  return { role: 'system', content: replyText };
};

// --- Grok (xAI Responses API) ---
export const chatWithGrok = async (messageHistory, webSearch = true) => {
  if (!GROK_API_KEY) throw new Error('找不到 Grok API Key');

  // xAI Responses API 格式
  const input = messageHistory
    .filter(msg => msg.content && msg.content.trim())
    .map(msg => ({
      role: msg.role === 'system' ? 'assistant' : 'user',
      content: msg.content
    }));

  // 確保第一則為 user
  if (input.length > 0 && input[0].role !== 'user') {
    input.shift();
  }

  const body = {
    model: 'grok-4.5',
    input
  };

  // 聯網搜尋：使用 xAI 的 web_search tool（Responses API）
  if (webSearch) {
    body.tools = [{ type: 'web_search' }];
  }

  const response = await fetch('/api/grok/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Grok API 呼叫失敗 (${response.status})`);
  }

  const data = await response.json();

  // xAI Responses API 回傳格式：output 為陣列
  let replyText = '(無回覆)';
  if (data.output && Array.isArray(data.output)) {
    const messageParts = data.output.filter(o => o.type === 'message');
    if (messageParts.length > 0) {
      const lastMsg = messageParts[messageParts.length - 1];
      if (lastMsg.content && Array.isArray(lastMsg.content)) {
        replyText = lastMsg.content
          .filter(c => c.type === 'output_text')
          .map(c => c.text)
          .join('\n');
      }
    }
  }
  // fallback: 如果有 output_text 直接在頂層
  if (replyText === '(無回覆)' && data.output_text) {
    replyText = data.output_text;
  }

  return { role: 'system', content: replyText };
};

// --- 統一路由：根據 modelId 分派到對應 API ---
export const chatWithModel = async (modelId, messageHistory, webSearch = true, imageDataUrls = []) => {
  switch (modelId) {
    case 'claude':
      return chatWithClaude(messageHistory, webSearch);
    case 'grok':
      return chatWithGrok(messageHistory, webSearch);
    case 'gemini':
    default:
      if (imageDataUrls.length > 0) {
        return chatWithAIAndImages(messageHistory, imageDataUrls, webSearch);
      }
      return chatWithAI(messageHistory, webSearch);
  }
};

