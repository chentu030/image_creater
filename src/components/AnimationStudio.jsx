import React, { useState, useRef, useEffect } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';
import { Film, UploadCloud, Play, Settings, Loader2, Download, Type } from 'lucide-react';
import { generateAnimation, generateVideoPiAPI, generateVideoKie, generateVideoVertexVeo, PIAPI_MODELS, KIE_VIDEO_MODELS, VERTEX_VIDEO_MODELS } from '../services/api';
import { uploadGeneratedToStorage, saveGenerationRecord, isFirebaseConfigured } from '../services/firebase';
import './Workspace.css';
import './AnimationStudio.css';

// 判斷是否為 PiAPI 模型
const isPiAPIModel = (modelId) => PIAPI_MODELS.some(m => m.id === modelId);
// 判斷是否為 kie.ai 模型
const isKieModel = (modelId) => KIE_VIDEO_MODELS.some(m => m.id === modelId);
// 判斷是否為 Vertex Veo 模型
const isVeoModel = (modelId) => VERTEX_VIDEO_MODELS.some(m => m.id === modelId);
// 需要提示詞輸入的模型（PiAPI / kie.ai / Veo）
const needsPrompt = (modelId) => isPiAPIModel(modelId) || isKieModel(modelId) || isVeoModel(modelId);

// 目前可用的動畫模型 (kie.ai + Replicate + PiAPI + Vertex Veo)
const VALID_MODEL_IDS = ['tooncrafter', 'wan2.7', ...KIE_VIDEO_MODELS.map(m => m.id), ...PIAPI_MODELS.map(m => m.id), ...VERTEX_VIDEO_MODELS.map(m => m.id)];

export default function AnimationStudio() {
  const { uid } = useAuth();
  const [model, setModel] = useLocalStorage('anim_model', 'kie-seedance-2-mini');
  const [motion, setMotion] = useLocalStorage('anim_motion', 5);
  const [duration, setDuration] = useLocalStorage('anim_duration', 5);
  const [prompt, setPrompt] = useLocalStorage('anim_prompt', 'A gentle animation with smooth camera movement');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [uploadedImages, setUploadedImages] = useState([]);
  const fileInputRef = useRef(null);

  // 若 localStorage 存的是已移除的模型，重設為預設值，避免下拉選單卡在無效選項
  useEffect(() => {
    if (!VALID_MODEL_IDS.includes(model)) {
      setModel('kie-seedance-2-mini');
    }
  }, [model, setModel]);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const promises = files.map(file => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      });
      Promise.all(promises).then(base64s => {
        setUploadedImages(prev => {
          const combined = [...prev, ...base64s];
          if (combined.length > 3) {
            alert('ToonCrafter 最多支援 3 張關鍵幀，已為您自動截斷。');
          }
          return combined.slice(0, 3);
        });
      });
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      let result;
      const imageData = uploadedImages.length > 0 ? uploadedImages[0] : null;
      if (isKieModel(model)) {
        // kie.ai 圖生影片 (Seedance 2.0 Mini / Wan 2.7)
        // 傳整個陣列：第 1 張為首幀，第 2 張（若有）為尾幀
        result = await generateVideoKie(model, prompt, uploadedImages, duration);
      } else if (isVeoModel(model)) {
        // Google Veo (Vertex 通道)：有圖=圖生影片，無圖=文生影片
        result = await generateVideoVertexVeo(model, prompt, imageData, duration);
      } else if (isPiAPIModel(model)) {
        // PiAPI 模型
        result = await generateVideoPiAPI(model, prompt, imageData, duration);
      } else {
        // Replicate 模型 (ToonCrafter / Wan 2.7)
        result = await generateAnimation(model, motion, uploadedImages);
      }
      setGeneratedVideoUrl(result.output);

      // 自動存到 Firebase（背景執行）
      if (uid && isFirebaseConfigured()) {
        (async () => {
          try {
            const { url: storageUrl } = await uploadGeneratedToStorage(uid, result.output, 'video');
            await saveGenerationRecord(uid, {
              type: 'video',
              model,
              prompt: needsPrompt(model) ? prompt : '(動畫生成)',
              outputUrl: storageUrl,
              duration,
              timestamp: new Date().toISOString()
            });
          } catch (e) {
            console.warn('Firebase 生成歷史儲存失敗:', e);
          }
        })();
      }
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="workspace animate-fade-in">
      <header className="workspace-header">
        <div>
          <h1 className="title">動畫生成區</h1>
          <p className="subtitle">kie.ai + Replicate Animation Studio</p>
        </div>
      </header>

      <div className="workspace-content split-view">
        <div className="control-panel glass-panel">
          <div className="panel-section">
            <h3 className="section-title"><Settings size={18}/> 動畫參數設定</h3>
            
            <div className="input-group">
              <label>生成模型 (Model)</label>
              <select className="glass-input" value={model} onChange={e => setModel(e.target.value)}>
                <optgroup label="── kie.ai (圖生影片) ──">
                  {KIE_VIDEO_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
                  ))}
                </optgroup>
                <optgroup label="── Google Veo (Vertex，文/圖生影片) ──">
                  {VERTEX_VIDEO_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
                  ))}
                </optgroup>
                <optgroup label="── Replicate ──">
                  <option value="tooncrafter">ToonCrafter (插幀動畫，需2張圖)</option>
                  <option value="wan2.7">Wan 2.7 I2V (圖轉影片，支援1080p)</option>
                </optgroup>
                {PIAPI_MODELS.length > 0 && (
                  <optgroup label="── PiAPI ──">
                    {PIAPI_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* PiAPI / kie.ai 模型需要 Prompt */}
            {needsPrompt(model) && (
              <div className="input-group">
                <label><Type size={14} style={{marginRight: 4}} />影片描述 / 額外提示詞 (Prompt)</label>
                <textarea
                  className="glass-input"
                  rows={3}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="描述你想要的影片動態效果，例如：鏡頭緩緩推近，角色輕輕眨眼並轉頭..."
                  style={{resize: 'vertical', fontFamily: 'inherit'}}
                />
              </div>
            )}

            <div className="input-group">
              <label>上傳圖片 {model === 'tooncrafter' ? '(需 2~3 張做首尾幀)' : isKieModel(model) ? '(第1張=首幀必填；第2張=尾幀選填)' : isVeoModel(model) ? '(可選；有圖=圖生影片，無圖=文生影片)' : isPiAPIModel(model) ? '(可選，作為參考圖)' : '(1~2 張做首尾幀)'}</label>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{display: 'none'}} 
                accept="image/*"
                multiple
                onChange={handleFileUpload} 
              />

              <div 
                className="upload-box glass-input" 
                onClick={() => fileInputRef.current?.click()}
                style={{cursor: 'pointer', marginBottom: '12px'}}
              >
                <UploadCloud size={24} className="upload-icon" />
                <span>點擊選擇 1~3 張圖片 (可多選)</span>
              </div>

              {uploadedImages.length > 0 && (
                <div className="selected-image-preview">
                  <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center'}}>
                    {uploadedImages.map((img, idx) => (
                      <div key={idx} style={{position: 'relative'}}>
                        <img src={img} alt={`Frame ${idx+1}`} style={{maxWidth: '80px', maxHeight: '80px', borderRadius: '4px', objectFit: 'cover'}} />
                        <div style={{position: 'absolute', top: 0, left: 0, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', padding: '2px 4px', borderTopLeftRadius: '4px'}}>
                          {idx === 0 ? '首幀' : (idx === uploadedImages.length - 1 ? '尾幀' : '中幀')}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="btn-secondary remove-btn" onClick={() => setUploadedImages([])}>
                    清除圖片
                  </button>
                </div>
              )}
            </div>

            {needsPrompt(model) ? (
              <div className="input-group">
                <label>影片長度 (秒): {duration}s</label>
                <input
                  type="range"
                  min="4" max="15"
                  value={duration}
                  onChange={e => setDuration(parseInt(e.target.value))}
                  className="range-slider"
                />
              </div>
            ) : (
              <div className="input-group">
                <label>動態強度 (Motion Score): {motion}</label>
                <input 
                  type="range" 
                  min="1" max="10" 
                  value={motion} 
                  onChange={e => setMotion(parseInt(e.target.value))}
                  className="range-slider"
                />
              </div>
            )}

            <button className="btn-primary generate-btn" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />} 
              {isGenerating ? '生成中...' : '開始生成動畫'}
            </button>
          </div>
        </div>

        <div className="preview-panel glass-panel">
          {generatedVideoUrl ? (
            <div className="preview-result" style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px'}}>
              <video 
                src={generatedVideoUrl} 
                controls 
                autoPlay 
                loop 
                playsInline
                crossOrigin="anonymous"
                style={{maxWidth: '100%', maxHeight: '75%', borderRadius: '12px'}} 
              />
              <button className="btn-primary" style={{marginTop: '16px'}} onClick={async () => {
                try {
                  const res = await fetch(generatedVideoUrl);
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `tooncrafter-${Date.now()}.mp4`;
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  a.remove();
                } catch (err) {
                  window.open(generatedVideoUrl, '_blank');
                }
              }}>
                <Download size={18} /> 下載影片
              </button>
            </div>
          ) : (
            <div className="preview-placeholder">
              <Film size={64} className="placeholder-icon" />
              <p>{errorMsg ? <span style={{color: 'var(--danger-color)'}}>{errorMsg}</span> : '尚未生成動畫'}</p>
              {!errorMsg && <span className="upload-hint">生成的影片將顯示於此</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
