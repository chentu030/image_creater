import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';
import {
  Send, Bot, User, Sparkles, Loader2, ImagePlus, X, Plus,
  BookOpen, Bookmark, Trash2, Edit3, Check, GitBranch, Upload
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { chatWithModel, CHAT_MODELS } from '../services/api';
import {
  saveBrainstormTopics,
  loadBrainstormTopics,
  uploadImageToStorage,
  isFirebaseConfigured
} from '../services/firebase';
import './Workspace.css';
import './Chat.css';
import './BrainstormHub.css';

// 產生唯一 ID
const genId = () => `topic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// 壓縮圖片（避免 localStorage 爆掉）
function compressImage(dataUrl, maxWidth = 600, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback
    img.src = dataUrl;
  });
}

// 讀取檔案為 data URL
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// AI 發想的系統引導提示詞
const INSPIRE_SYSTEM_PROMPT = `你是一位創意靈感助手。使用者會上傳一張或多張圖片（可能來自同一位繪師或作者），你的任務是：

1. **分析圖片的視覺風格與內容特色**：觀察構圖、色彩、氛圍、角色特點、背景元素等
2. **以此為靈感，延伸發想新的創作主題**：不要照抄圖片內容，而是從中汲取元素來提出原創的繪圖主題
3. 提出 3~5 個具體的主題方向，每個主題包含：
   - 主題名稱
   - 畫面描述（構圖、角色動作、場景、氛圍）
   - 適合的色彩搭配建議
   - 可延伸的系列方向

請用繁體中文回覆，語氣輕鬆有趣。`;

export default function BrainstormHub() {
  const { uid } = useAuth();
  // ─── 主題資料（持久化到 localStorage，同時同步到 Firebase）───
  const [topics, setTopics] = useLocalStorage('brainstorm_topics', []);
  const [activeTopicId, setActiveTopicId] = useLocalStorage('brainstorm_active_topic', null);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);

  // ─── 本地狀態 ───
  const [uploadedImages, setUploadedImages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [lightboxImg, setLightboxImg] = useState(null);
  const [chatModel, setChatModel] = useLocalStorage('brainstorm_chatModel', 'gemini');
  const [webSearch, setWebSearch] = useLocalStorage('brainstorm_webSearch', true);
  const [mobilePanel, setMobilePanel] = useState('chat'); // 'chat' | 'images' | 'topics'

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const nameInputRef = useRef(null);

  // 取得當前活躍主題
  const activeTopic = topics.find(t => t.id === activeTopicId) || null;
  const messages = activeTopic?.messages || [];

  // 從 Firebase 載入對話主題（首次）
  useEffect(() => {
    if (uid && isFirebaseConfigured() && !firebaseLoaded) {
      loadBrainstormTopics(uid).then(cloudTopics => {
        if (cloudTopics.length > 0) {
          setTopics(cloudTopics);
        }
        setFirebaseLoaded(true);
      }).catch(err => {
        console.warn('載入雲端對話主題失敗:', err);
        setFirebaseLoaded(true);
      });
    }
  }, [uid, firebaseLoaded]);

  // 自動同步到 Firebase（debounce 2 秒）
  useEffect(() => {
    if (!uid || !isFirebaseConfigured() || !firebaseLoaded) return;
    const timer = setTimeout(() => {
      saveBrainstormTopics(uid, topics).catch(err =>
        console.warn('同步對話主題到 Firebase 失敗:', err)
      );
    }, 2000);
    return () => clearTimeout(timer);
  }, [uid, topics, firebaseLoaded]);

  // 聊天滾到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  // 編輯名稱時自動 focus
  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  // ─── 主題操作 ───
  const createNewTopic = (name = '新主題', images = [], initialMessages = [], parentId = null) => {
    const newTopic = {
      id: genId(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      images,
      messages: initialMessages.length > 0 ? initialMessages : [
        { role: 'system', content: '歡迎！上傳圖片讓我從中找靈感，或直接告訴我你想要什麼主題吧 ✨' }
      ],
      parentTopicId: parentId,
    };
    setTopics(prev => [newTopic, ...prev]);
    setActiveTopicId(newTopic.id);
    setUploadedImages(images);
    return newTopic;
  };

  const updateTopic = (topicId, updates) => {
    setTopics(prev => prev.map(t =>
      t.id === topicId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
    ));
  };

  const deleteTopic = (topicId) => {
    setTopics(prev => prev.filter(t => t.id !== topicId));
    if (activeTopicId === topicId) {
      setActiveTopicId(null);
      setUploadedImages([]);
    }
  };

  const switchTopic = (topicId) => {
    setActiveTopicId(topicId);
    const topic = topics.find(t => t.id === topicId);
    if (topic) {
      setUploadedImages(topic.images || []);
    }
    setEditingName(false);
  };

  const createSequel = () => {
    if (!activeTopic) return;
    const parentName = activeTopic.name;
    // 找這個主題已有幾個續集
    const sequelCount = topics.filter(t => t.parentTopicId === activeTopic.id).length;
    const sequelName = `${parentName} — 續集 ${sequelCount + 1}`;

    const summaryOfPrev = activeTopic.messages
      .filter(m => m.role === 'system' && m.content.length > 20)
      .slice(-2)
      .map(m => m.content.slice(0, 300))
      .join('\n---\n');

    const initialMessages = [
      {
        role: 'system',
        content: `這是「${parentName}」的續集！以下是前一個主題的 AI 分析摘要：\n\n${summaryOfPrev}\n\n讓我們在這個基礎上繼續延伸新的創意方向吧 🚀`
      }
    ];

    createNewTopic(sequelName, [...(activeTopic.images || [])], initialMessages, activeTopic.id);
  };

  // ─── 圖片上傳 ───
  const handleFiles = async (files) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const newImages = [];
    for (const file of imageFiles) {
      const dataUrl = await readFileAsDataUrl(file);
      const compressed = await compressImage(dataUrl);
      newImages.push(compressed);
    }

    const updated = [...uploadedImages, ...newImages];
    setUploadedImages(updated);

    // 同步更新到 activeTopic
    if (activeTopic) {
      updateTopic(activeTopic.id, { images: updated });
    }
  };

  const removeImage = (idx) => {
    const updated = uploadedImages.filter((_, i) => i !== idx);
    setUploadedImages(updated);
    if (activeTopic) {
      updateTopic(activeTopic.id, { images: updated });
    }
  };

  // ─── 拖放處理 ───
  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // ─── AI 發想（用圖片） ───
  const handleInspire = async () => {
    if (uploadedImages.length === 0 || isLoading) return;

    // 如果沒有活躍主題，自動建一個
    let topicId = activeTopicId;
    if (!topicId) {
      const t = createNewTopic('AI 圖片靈感發想', [...uploadedImages]);
      topicId = t.id;
    }

    const userMsg = {
      role: 'user',
      content: `請分析這 ${uploadedImages.length} 張圖片，幫我從中找靈感、延伸發想出新的繪圖主題。不要照抄，要以圖片的風格和內容為參考來做原創發想。`,
      images: [...uploadedImages]
    };

    const newMessages = [...(topics.find(t => t.id === topicId)?.messages || []), userMsg];
    updateTopic(topicId, { messages: newMessages });
    setIsLoading(true);

    try {
      // 組合完整訊息歷史（含系統引導）
      const fullHistory = [
        { role: 'user', content: INSPIRE_SYSTEM_PROMPT },
        { role: 'system', content: '好的，我會從圖片中分析風格並延伸發想原創主題，而非照抄。請上傳圖片吧！' },
        ...newMessages
      ];
      const aiReply = await chatWithModel(chatModel, fullHistory, webSearch, uploadedImages);
      updateTopic(topicId, { messages: [...newMessages, aiReply] });
    } catch (error) {
      console.error(error);
      updateTopic(topicId, {
        messages: [...newMessages, { role: 'system', content: `(錯誤) ${error.message}` }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ─── 一般文字對話 ───
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    // 如果沒有活躍主題，自動建一個
    let topicId = activeTopicId;
    if (!topicId) {
      const t = createNewTopic('新對話');
      topicId = t.id;
    }

    const userMsg = { role: 'user', content: input };
    const currentMessages = topics.find(t => t.id === topicId)?.messages || [];
    const newMessages = [...currentMessages, userMsg];
    updateTopic(topicId, { messages: newMessages });
    setInput('');
    setIsLoading(true);

    try {
      // 如果有圖片，用圖片版 API
      const hasImages = uploadedImages.length > 0;
      const aiReply = await chatWithModel(chatModel, newMessages, webSearch, hasImages ? uploadedImages : []);
      updateTopic(topicId, { messages: [...newMessages, aiReply] });
    } catch (error) {
      console.error(error);
      updateTopic(topicId, {
        messages: [...newMessages, { role: 'system', content: `(錯誤) ${error.message}` }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ─── 儲存主題名稱 ───
  const handleSaveTopic = () => {
    if (!activeTopic) return;
    if (editingName && editNameValue.trim()) {
      updateTopic(activeTopic.id, { name: editNameValue.trim() });
    }
    setEditingName(false);
  };

  // ─── 渲染 ───
  return (
    <div className="workspace animate-fade-in" style={{ padding: 0 }}>
      <div className="brainstorm-layout">

        {/* 手機版 tab 切換列 */}
        <div className="mobile-panel-tabs">
          <button className={`mobile-panel-tab ${mobilePanel === 'images' ? 'active' : ''}`} onClick={() => setMobilePanel('images')}>
            <ImagePlus size={14}/> 參考圖
          </button>
          <button className={`mobile-panel-tab ${mobilePanel === 'chat' ? 'active' : ''}`} onClick={() => setMobilePanel('chat')}>
            <Bot size={14}/> 聊天
          </button>
          <button className={`mobile-panel-tab ${mobilePanel === 'topics' ? 'active' : ''}`} onClick={() => setMobilePanel('topics')}>
            <Bookmark size={14}/> 主題
          </button>
        </div>

        {/* ═══ 左側：圖片上傳區 ═══ */}
        <div className={`brainstorm-images-panel ${mobilePanel !== 'images' ? 'mobile-hidden' : ''}`}>
          <div className="panel-header">
            <h3><ImagePlus size={16} /> 參考圖片</h3>
            <p>上傳圖片讓 AI 從中找靈感</p>
          </div>

          <div className="images-body">
            {/* 拖放上傳區 */}
            <div
              className={`brainstorm-drop-zone ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={28} className="drop-icon" />
              <span className="drop-text">拖放或點擊上傳</span>
              <span className="drop-hint">支援 JPG / PNG / WebP / GIF</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={e => handleFiles(e.target.files)}
              />
            </div>

            {/* 已上傳圖片 */}
            {uploadedImages.length > 0 && (
              <>
                <div className="uploaded-images-grid">
                  {uploadedImages.map((img, idx) => (
                    <div key={idx} className="uploaded-img-item">
                      <img src={img} alt={`ref-${idx}`} onClick={() => setLightboxImg(img)} />
                      <button
                        className="remove-img-btn"
                        onClick={(e) => { e.stopPropagation(); removeImage(idx); }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  className="btn-primary inspire-btn"
                  onClick={handleInspire}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  以這些圖片發想
                </button>
              </>
            )}
          </div>
        </div>

        {/* ═══ 中間：聊天區 ═══ */}
        <div className={`brainstorm-chat-panel ${mobilePanel !== 'chat' ? 'mobile-hidden' : ''}`}>
          {/* 聊天標題列 */}
          <div className="brainstorm-chat-header">
            <div>
              {editingName ? (
                <input
                  ref={nameInputRef}
                  className="topic-name-input"
                  value={editNameValue}
                  onChange={e => setEditNameValue(e.target.value)}
                  onBlur={handleSaveTopic}
                  onKeyDown={e => e.key === 'Enter' && handleSaveTopic()}
                />
              ) : (
                <div className="topic-title">
                  <BookOpen size={18} />
                  {activeTopic?.name || '靈感發想區'}
                </div>
              )}
              {activeTopic && (
                <div className="topic-meta">
                  {new Date(activeTopic.updatedAt || activeTopic.createdAt).toLocaleString('zh-TW')}
                  {activeTopic.parentTopicId && ' · 續集'}
                </div>
              )}
            </div>

            {activeTopic && (
              <div className="topic-actions">
                <button
                  className="topic-action-btn"
                  onClick={() => { setEditNameValue(activeTopic.name); setEditingName(true); }}
                  title="重新命名"
                >
                  <Edit3 size={14} /> 命名
                </button>
                <button
                  className="topic-action-btn"
                  onClick={createSequel}
                  title="建立續集"
                >
                  <GitBranch size={14} /> 續集
                </button>
              </div>
            )}
          </div>

          {/* 聊天記錄 */}
          <div className="chat-container" style={{ flex: 1, border: 'none', borderRadius: 0 }}>
            <div className="chat-history">
              {messages.map((msg, idx) => (
                <div key={idx} className={`chat-message ${msg.role}`}>
                  <div className="message-avatar">
                    {msg.role === 'system' ? <Bot size={20} /> : <User size={20} />}
                  </div>
                  <div className="message-content">
                    {/* 訊息附帶的圖片 */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="message-images">
                        {msg.images.map((img, imgIdx) => (
                          <img
                            key={imgIdx}
                            src={img}
                            alt={`msg-img-${imgIdx}`}
                            onClick={() => setLightboxImg(img)}
                          />
                        ))}
                      </div>
                    )}
                    <div className="markdown-body">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.role === 'system' && idx > 0 && (
                      <button className="btn-secondary transfer-prompt-btn">
                        <Sparkles size={14} /> 傳送至風格繪圖區
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="chat-message system">
                  <div className="message-avatar">
                    <Bot size={20} />
                  </div>
                  <div className="message-content">
                    <Loader2 className="animate-spin" size={20} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* 輸入區 */}
            <div className="chat-input-area">
              {/* 模型選擇 + 聯網開關 */}
              <div className="chat-controls-row">
                <select
                  className="glass-input chat-model-select"
                  value={chatModel}
                  onChange={e => setChatModel(e.target.value)}
                  title="切換 AI 模型"
                >
                  {CHAT_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button
                  className={`btn-web-search ${webSearch ? 'active' : ''}`}
                  onClick={() => setWebSearch(!webSearch)}
                  title={webSearch ? '聯網搜尋：已開啟' : '聯網搜尋：已關閉'}
                >
                  🌐 {webSearch ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="chat-input-row">
                <input
                  type="text"
                  className="glass-input chat-input"
                  placeholder={activeTopic ? '繼續追問或描述你想要的方向…' : '輸入您的想法，開始發想…'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                />
                <button className="btn-primary send-btn" onClick={handleSend} disabled={isLoading}>
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ 右側：主題列表 ═══ */}
        <div className={`brainstorm-topics-panel ${mobilePanel !== 'topics' ? 'mobile-hidden' : ''}`}>
          <div className="panel-header">
            <h3><Bookmark size={16} /> 儲存的主題</h3>
          </div>

          <button
            className="btn-primary new-topic-btn"
            onClick={() => { createNewTopic(); setUploadedImages([]); }}
          >
            <Plus size={16} /> 新主題
          </button>

          <div className="topics-body">
            {topics.length === 0 ? (
              <div className="topics-empty">
                <div className="empty-icon">📚</div>
                <p>還沒有儲存的主題<br />上傳圖片或開始對話後<br />會自動建立主題</p>
              </div>
            ) : (
              topics.map(topic => (
                <div
                  key={topic.id}
                  className={`topic-card ${topic.id === activeTopicId ? 'active' : ''}`}
                  onClick={() => switchTopic(topic.id)}
                >
                  <div className="topic-card-header">
                    <div className="topic-card-name">{topic.name}</div>
                    <button
                      className="topic-card-delete"
                      onClick={(e) => { e.stopPropagation(); deleteTopic(topic.id); }}
                      title="刪除主題"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="topic-card-date">
                    {new Date(topic.updatedAt || topic.createdAt).toLocaleDateString('zh-TW')}
                  </div>
                  {/* 縮圖預覽 */}
                  {topic.images && topic.images.length > 0 && (
                    <div className="topic-card-thumbs">
                      {topic.images.slice(0, 4).map((img, i) => (
                        <img key={i} src={img} alt={`thumb-${i}`} />
                      ))}
                    </div>
                  )}
                  {/* 續集標記 */}
                  {topic.parentTopicId && (
                    <div className="topic-card-sequel-badge">
                      <GitBranch size={10} /> 續集
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 圖片燈箱 */}
      {lightboxImg && (
        <div className="lightbox-overlay" onClick={() => setLightboxImg(null)}>
          <img src={lightboxImg} alt="preview" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
