import React, { useState, useEffect, useRef } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';
import { ImagePlus, Sliders, Wand2, Download, Loader2, Check, Target, Smile, Upload, X } from 'lucide-react';
import { generateImage, generateImagePiAPI, generateImageVertex, PIAPI_IMAGE_MODELS, VERTEX_IMAGE_MODELS } from '../services/api';
import {
  uploadImageToStorage,
  uploadGeneratedToStorage,
  saveGenerationRecord,
  loadReferenceImages,
  saveReferenceImageRecord,
  deleteReferenceImage,
  isFirebaseConfigured
} from '../services/firebase';
import './Workspace.css';

// 判斷是否為 PiAPI 圖片模型
const isPiAPIImageModel = (modelId) => PIAPI_IMAGE_MODELS.some(m => m.id === modelId);
// 判斷是否為 Vertex (Google) 圖片模型
const isVertexImageModel = (modelId) => VERTEX_IMAGE_MODELS.some(m => m.id === modelId);

// 目前可用的生圖模型 (Replicate + Vertex + PiAPI)
const VALID_IMAGE_MODEL_IDS = ['bytedance/seedream-5-lite', 'bytedance/seedream-4.5', ...VERTEX_IMAGE_MODELS.map(m => m.id), ...PIAPI_IMAGE_MODELS.map(m => m.id)];

export default function StyleLab() {
  const { uid } = useAuth();
  const [prompt, setPrompt] = useLocalStorage('styleLab_prompt', '用這隻北極熊的風格畫一隻兔子');
  const [aspectRatio, setAspectRatio] = useLocalStorage('styleLab_aspectRatio', '1:1');
  const [keepPose, setKeepPose] = useLocalStorage('styleLab_keepPose', true);
  const [modelVersion, setModelVersion] = useLocalStorage('styleLab_model', 'bytedance/seedream-5-lite');
  const [referenceImages, setReferenceImages] = useLocalStorage('styleLab_refImgs', []);
  const [targetImage, setTargetImage] = useState(null);
  const [memeImage, setMemeImage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  
  const [localImages, setLocalImages] = useState([]);
  const [userUploadedImages, setUserUploadedImages] = useLocalStorage('styleLab_userUploaded', []);
  const [cloudRefImages, setCloudRefImages] = useState([]); // Firebase 雲端參考圖 [{id, url, storagePath}]
  const targetFileRef = useRef(null);
  const memeFileRef = useRef(null);
  const refUploadFileRef = useRef(null);

  const handleTargetUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setTargetImage(reader.result);
    reader.readAsDataURL(file);
    if (targetFileRef.current) targetFileRef.current.value = '';
  };

  const handleMemeUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setMemeImage(reader.result);
    reader.readAsDataURL(file);
    if (memeFileRef.current) memeFileRef.current.value = '';
  };

  // 上傳自訂參考圖（支援多選）— 有 Firebase 時自動上傳到 Storage
  const handleRefUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const promises = files.map(file => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    }));
    const dataUrls = await Promise.all(promises);

    if (uid && isFirebaseConfigured()) {
      // 上傳到 Firebase Storage，並記錄到 Firestore
      for (const dataUrl of dataUrls) {
        try {
          const storageUrl = await uploadImageToStorage(uid, dataUrl, 'reference-images');
          await saveReferenceImageRecord(uid, storageUrl, null);
          setCloudRefImages(prev => [...prev, { id: Date.now().toString(), url: storageUrl }]);
        } catch (err) {
          console.warn('上傳到 Firebase 失敗，fallback 到 localStorage:', err);
          setUserUploadedImages(prev => [...prev, dataUrl]);
        }
      }
    } else {
      // 無 Firebase：存到 localStorage
      setUserUploadedImages(prev => [...prev, ...dataUrls]);
    }
    if (refUploadFileRef.current) refUploadFileRef.current.value = '';
  };

  const removeUserUploadedImage = (index) => {
    const imgUrl = userUploadedImages[index];
    setUserUploadedImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImages(prev => prev.filter(url => url !== imgUrl));
  };

  const removeCloudRefImage = async (index) => {
    const img = cloudRefImages[index];
    setCloudRefImages(prev => prev.filter((_, i) => i !== index));
    setReferenceImages(prev => prev.filter(url => url !== img.url));
    if (uid && img.id) {
      try {
        await deleteReferenceImage(uid, img.id, img.storagePath);
      } catch (e) {
        console.warn('刪除雲端參考圖失敗:', e);
      }
    }
  };

  // 從 Firebase 載入雲端參考圖
  useEffect(() => {
    if (uid && isFirebaseConfigured()) {
      loadReferenceImages(uid).then(images => {
        setCloudRefImages(images);
      }).catch(err => console.warn('載入雲端參考圖失敗:', err));
    }
  }, [uid]);

  useEffect(() => {
    // 若 localStorage 存的是已移除的模型，重設為預設值
    if (!VALID_IMAGE_MODEL_IDS.includes(modelVersion)) {
      setModelVersion('bytedance/seedream-5-lite');
    }
  }, [modelVersion, setModelVersion]);

  useEffect(() => {
    // 取得本地繪圖風格資料夾的圖片
    // 開發環境走 Vite 中間件；Vercel 生產環境走 public/style-images/manifest.json
    fetch('/api/local-images')
      .then(res => {
        if (!res.ok) throw new Error('not available');
        return res.json();
      })
      .then(data => setLocalImages(data))
      .catch(() => {
        // Fallback: 從 public 靜態清單讀取
        fetch('/style-images/manifest.json')
          .then(res => res.json())
          .then(data => setLocalImages(data))
          .catch(err => console.error('無法讀取本地圖片:', err));
      });
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    if (memeImage && !targetImage && referenceImages.length === 0) {
      setErrorMsg('迷因模仿模式需要上傳「角色圖」，或至少選一張「風格參考圖」作為角色外觀');
      return;
    }
    
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      let result;
      if (isPiAPIImageModel(modelVersion)) {
        // PiAPI 模型 - 取第一張參考圖的 base64
        let refBase64 = null;
        if (referenceImages.length > 0) {
          try {
            const res = await fetch(referenceImages[0]);
            const blob = await res.blob();
            refBase64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            console.warn('參考圖轉換失敗', e);
          }
        }
        result = await generateImagePiAPI(modelVersion, prompt, refBase64, aspectRatio);
      } else if (isVertexImageModel(modelVersion)) {
        // Google Vertex 生圖（支援風格參考圖 + 角色圖 + 迷因動作圖）
        result = await generateImageVertex(modelVersion, prompt, referenceImages, aspectRatio, keepPose, targetImage, memeImage);
      } else {
        // Replicate Seedream 模型（可帶入目標圖做風格轉繪）
        result = await generateImage(prompt, referenceImages, aspectRatio, keepPose, modelVersion, targetImage, memeImage);
      }
      setGeneratedImageUrl(result.output);

      // 自動存到 Firebase（背景執行，不阻塞 UI）
      if (uid && isFirebaseConfigured()) {
        (async () => {
          try {
            const storageUrl = await uploadGeneratedToStorage(uid, result.output, 'image');
            await saveGenerationRecord(uid, {
              type: 'image',
              model: modelVersion,
              prompt,
              outputUrl: storageUrl,
              aspectRatio,
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

  const handleDownload = async () => {
    if (!generatedImageUrl) return;
    try {
      // 嘗試透過 fetch 取得圖片，避免跨域問題影響下載 (Replicate delivery 通常有 CORS header)
      const res = await fetch(generatedImageUrl);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `seedream-art-${Date.now()}.png`; // 也可以解析副檔名
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('下載失敗，改用新分頁開啟:', err);
      // 如果 fetch 失敗 (例如 CORS)，退回到開新視窗
      window.open(generatedImageUrl, '_blank');
    }
  };

  return (
    <div className="workspace animate-fade-in">
      <header className="workspace-header">
        <div>
          <h1 className="title">風格繪圖區</h1>
          <p className="subtitle">Style Consistency Lab</p>
        </div>
      </header>

      <div className="workspace-content split-view">
        {/* 左側：控制面板 */}
        <div className="control-panel glass-panel">
          <div className="panel-section">
            <h3 className="section-title"><Sliders size={18}/> 基礎設定</h3>
            <div className="input-group">
              <label>參考圖 (Reference Image) - 可選 1~14 張</label>
              
              {/* 上傳自訂參考圖按鈕 */}
              <input
                type="file"
                ref={refUploadFileRef}
                style={{display: 'none'}}
                accept="image/*"
                multiple
                onChange={handleRefUpload}
              />
              <button
                className="btn-secondary"
                onClick={() => refUploadFileRef.current?.click()}
                style={{marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center'}}
              >
                <Upload size={16} /> 上傳自訂參考圖（可多選）
              </button>

              {/* 使用者上傳的自訂參考圖 */}
              {userUploadedImages.length > 0 && (
                <>
                  <span className="upload-hint" style={{marginBottom: 4, fontSize: '0.75rem'}}>📷 你上傳的參考圖（點擊選取 / 按 × 刪除）</span>
                  <div className="image-picker-scroll">
                    {userUploadedImages.map((dataUrl, idx) => {
                      const isSelected = referenceImages.includes(dataUrl);
                      const toggleSelection = () => {
                        if (isSelected) {
                          setReferenceImages(referenceImages.filter(url => url !== dataUrl));
                        } else {
                          if (referenceImages.length >= 14) {
                            alert('最多只能選擇 14 張參考圖片以達到最佳風格效果！');
                            return;
                          }
                          setReferenceImages([...referenceImages, dataUrl]);
                        }
                      };
                      return (
                        <div
                          key={`user-${idx}`}
                          className={`picker-img-container ${isSelected ? 'selected' : ''}`}
                          onClick={toggleSelection}
                          style={{position: 'relative'}}
                        >
                          <img src={dataUrl} alt={`上傳 ${idx + 1}`} className="picker-img" />
                          {isSelected && <div className="picker-check"><Check size={16}/></div>}
                          <button
                            className="user-img-delete-btn"
                            onClick={(e) => { e.stopPropagation(); removeUserUploadedImage(idx); }}
                            title="刪除這張圖"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* ☁️ Firebase 雲端參考圖 */}
              {cloudRefImages.length > 0 && (
                <>
                  <span className="upload-hint" style={{marginBottom: 4, fontSize: '0.75rem'}}>☁️ 雲端參考圖（點擊選取 / 按 × 刪除）</span>
                  <div className="image-picker-scroll">
                    {cloudRefImages.map((img, idx) => {
                      const isSelected = referenceImages.includes(img.url);
                      const toggleSelection = () => {
                        if (isSelected) {
                          setReferenceImages(referenceImages.filter(url => url !== img.url));
                        } else {
                          if (referenceImages.length >= 14) {
                            alert('最多只能選擇 14 張參考圖片以達到最佳風格效果！');
                            return;
                          }
                          setReferenceImages([...referenceImages, img.url]);
                        }
                      };
                      return (
                        <div
                          key={`cloud-${idx}`}
                          className={`picker-img-container ${isSelected ? 'selected' : ''}`}
                          onClick={toggleSelection}
                          style={{position: 'relative'}}
                        >
                          <img src={img.url} alt={`雲端 ${idx + 1}`} className="picker-img" />
                          {isSelected && <div className="picker-check"><Check size={16}/></div>}
                          <button
                            className="user-img-delete-btn"
                            onClick={(e) => { e.stopPropagation(); removeCloudRefImage(idx); }}
                            title="刪除這張圖"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 本地端預設風格圖選擇器 */}
              {localImages.length > 0 && (
                <>
                  <span className="upload-hint" style={{marginBottom: 4, fontSize: '0.75rem'}}>🎨 預設風格庫</span>
                  <div className="image-picker-scroll">
                    {localImages.map(img => {
                      const isDev = !!import.meta.env.DEV;
                      const prefix = isDev ? '/local-images/' : '/style-images/';
                      const imgUrl = `${prefix}${encodeURIComponent(img)}`;
                      const isSelected = referenceImages.includes(imgUrl);
                      
                      const toggleSelection = () => {
                        if (isSelected) {
                          setReferenceImages(referenceImages.filter(url => url !== imgUrl));
                        } else {
                          if (referenceImages.length >= 14) {
                            alert('最多只能選擇 14 張參考圖片以達到最佳風格效果！');
                            return;
                          }
                          setReferenceImages([...referenceImages, imgUrl]);
                        }
                      };

                      return (
                        <div 
                          key={img} 
                          className={`picker-img-container ${isSelected ? 'selected' : ''}`}
                          onClick={toggleSelection}
                        >
                          <img src={imgUrl} alt={img} className="picker-img" />
                          {isSelected && <div className="picker-check"><Check size={16}/></div>}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {referenceImages.length === 0 ? (
                <div className="upload-box glass-input">
                  <ImagePlus size={24} className="upload-icon" />
                  <span>點擊上方選擇圖片作為風格參考 (支援多圖)</span>
                </div>
              ) : (
                <div className="selected-image-preview">
                  <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center'}}>
                    {referenceImages.map(img => (
                      <img key={img} src={img} alt="Selected Reference" style={{maxWidth: '80px', maxHeight: '80px', borderRadius: '4px', objectFit: 'cover'}} />
                    ))}
                  </div>
                  <button className="btn-secondary remove-btn" onClick={() => setReferenceImages([])}>
                    清除全部 ({referenceImages.length})
                  </button>
                </div>
              )}
            </div>

            <div className="input-group">
              <label><Target size={14} style={{marginRight: 4, verticalAlign: 'middle'}} />角色圖 (Character) - 選填</label>
              <span className="upload-hint" style={{marginBottom: 8}}>上傳你的角色，作為要被重繪或模仿動作的外觀參考</span>

              <input
                type="file"
                ref={targetFileRef}
                style={{display: 'none'}}
                accept="image/*"
                onChange={handleTargetUpload}
              />

              {targetImage ? (
                <div className="selected-image-preview">
                  <img src={targetImage} alt="Target" style={{maxWidth: '140px', maxHeight: '140px', borderRadius: '4px', objectFit: 'contain'}} />
                  <button className="btn-secondary remove-btn" onClick={() => setTargetImage(null)}>
                    清除目標圖
                  </button>
                </div>
              ) : (
                <div
                  className="upload-box glass-input"
                  onClick={() => targetFileRef.current?.click()}
                  style={{cursor: 'pointer'}}
                >
                  <Target size={24} className="upload-icon" />
                  <span>點擊上傳角色圖</span>
                </div>
              )}
            </div>

            <div className="input-group">
              <label><Smile size={14} style={{marginRight: 4, verticalAlign: 'middle'}} />迷因/動作參考圖 (Meme Pose) - 選填</label>
              <span className="upload-hint" style={{marginBottom: 8}}>上傳梗圖，讓角色模仿其中的動作、姿勢或表情</span>

              <input
                type="file"
                ref={memeFileRef}
                style={{display: 'none'}}
                accept="image/*"
                onChange={handleMemeUpload}
              />

              {memeImage ? (
                <div className="selected-image-preview">
                  <img src={memeImage} alt="Meme pose reference" style={{maxWidth: '140px', maxHeight: '140px', borderRadius: '4px', objectFit: 'contain'}} />
                  <button className="btn-secondary remove-btn" onClick={() => setMemeImage(null)}>
                    清除迷因參考圖
                  </button>
                </div>
              ) : (
                <div
                  className="upload-box glass-input"
                  onClick={() => memeFileRef.current?.click()}
                  style={{cursor: 'pointer'}}
                >
                  <Smile size={24} className="upload-icon" />
                  <span>點擊上傳迷因梗圖（動作/表情參考）</span>
                </div>
              )}
            </div>

            <div className="input-group">
              <label>模型版本 (Model Version)</label>
              <select className="glass-input" value={modelVersion} onChange={(e) => setModelVersion(e.target.value)}>
                <optgroup label="── Replicate ──">
                  <option value="bytedance/seedream-5-lite">Seedream 5 Lite (推薦: 扁平化與指令遵循更佳)</option>
                  <option value="bytedance/seedream-4.5">Seedream 4.5 (支援多圖風格與圖生圖更穩定)</option>
                </optgroup>
                <optgroup label="── Google (Vertex) ──">
                  {VERTEX_IMAGE_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
                  ))}
                </optgroup>
                {PIAPI_IMAGE_MODELS.length > 0 && (
                  <optgroup label="── PiAPI ──">
                    {PIAPI_IMAGE_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="input-group">
              <label>生成提示詞 (Prompt)</label>
              <textarea 
                className="glass-input" 
                rows="4" 
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={memeImage
                  ? '例如：讓我的角色做出跟梗圖一樣的驚訝表情...'
                  : '例如：用這隻北極熊的風格畫一隻兔子，泡在奶綠蓋裡面...'}
              />
            </div>

            <div className="input-row">
              <div className="input-group">
                <label>畫面比例</label>
                <select className="glass-input" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                  <option value="1:1">1:1 (正方形)</option>
                  <option value="16:9">16:9 (橫向)</option>
                  <option value="9:16">9:16 (直向)</option>
                </select>
              </div>
              <div className="input-group checkbox-group">
                <label>{memeImage ? '嚴格模仿梗圖動作' : '保持姿勢與大小'}</label>
                <input 
                  type="checkbox" 
                  checked={keepPose} 
                  onChange={e => setKeepPose(e.target.checked)} 
                />
              </div>
            </div>

            <button className="btn-primary generate-btn" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />} 
              {isGenerating ? '生成中...' : '生成圖片'}
            </button>
          </div>
        </div>

        {/* 右側：預覽區 */}
        <div className="preview-panel glass-panel">
          {generatedImageUrl ? (
            <div className="preview-result">
              <img src={generatedImageUrl} alt="Generated" />
              <button className="btn-primary download-btn" onClick={handleDownload}>
                <Download size={18} /> 下載圖片
              </button>
            </div>
          ) : (
            <div className="preview-placeholder">
              <div className="placeholder-icon">🎨</div>
              <p>{errorMsg ? <span style={{color: 'var(--danger-color)'}}>{errorMsg}</span> : '等待生成中...'}</p>
              {!errorMsg && <span className="upload-hint">設定好左側參數後點擊生成</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
