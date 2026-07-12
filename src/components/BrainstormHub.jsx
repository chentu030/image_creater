import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';
import {
  Send, Bot, User, Sparkles, Loader2, ImagePlus, X, Plus,
  BookOpen, Bookmark, Trash2, Edit3, Check, GitBranch, Upload, Copy, Download
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatWithModel, CHAT_MODELS, summarizeToMemory, autoNameTopic } from '../services/api';
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

// AI 發想的系統引導提示詞（動態注入社群創作區上下文）
function getInspireSystemPrompt() {
  // 預設角色資料（保底，即使 localStorage 為空也有）
  const FALLBACK_CHARS = [
    { name: '熊賀', species: '北極熊', personality: ['可愛', '小賤賤', '淘氣', '調皮搗蛋'], can_speak: false, catchphrase: '(透過表情和動作表達，不說話)', backstory: '看起來超可愛但很淘氣的北極熊，用各種小動作逗弄其他角色' },
    { name: '小豬', species: '豬', personality: ['呆萌', '憨厚', '單純'], can_speak: true, catchphrase: '欸？真的嗎？', backstory: '思想單純的小豬，常被北極熊捉弄但還是很開心' },
    { name: '鯨鯨', species: '虎鯨', personality: ['溫柔', '愛操心', '有點嘮叨'], can_speak: true, catchphrase: '真是的～你們這些小傢伙！', backstory: '媽媽擔當，照顧大家' },
    { name: '唉芽鴨', species: '鴨子', personality: ['神經質', '易受驚', '敏感'], can_speak: false, catchphrase: '嘎！', backstory: '膽小但內心堅強的小鴨' },
    { name: '毛毛', species: '垂耳兔', personality: ['超級愛乾淨', '完美主義', '容易抓狂'], can_speak: false, catchphrase: '(生氣時耳朵會一抖一抖的)', backstory: '吐槽擔當兼生活管家' },
  ];

  // 嘗試從 localStorage 讀取自訂角色（有就覆蓋預設）
  let chars = FALLBACK_CHARS;
  try {
    const stored = localStorage.getItem('cc_characters');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.characters?.length > 0) chars = parsed.characters;
    }
  } catch { /* use fallback */ }

  // 組合角色描述
  const charDesc = chars.map(c => {
    let d = `- ${c.name} (${c.species})：${(c.personality || []).join('、')}`;
    if (c.catchphrase) d += ` | 口頭禪：「${c.catchphrase}」`;
    if (!c.can_speak) d += ' [不會說話，只用動作表達]';
    if (c.backstory) d += `\n  背景：${c.backstory}`;
    return d;
  }).join('\n');

  // 劇情庫（可選）
  let storyDesc = '';
  try {
    const stored = localStorage.getItem('cc_stories');
    if (stored) {
      const parsed = JSON.parse(stored);
      const stories = parsed?.stories || [];
      if (stories.length > 0) {
        storyDesc = '\n\n【最近創作的劇情】\n' +
          stories.slice(-5).map(s => `- 「${s.title}」(${s.type || '獨立'}) — 角色：${(s.characters || []).join('、')}`).join('\n');
      }
    }
  } catch { /* ignore */ }

  return `你是一位創意靈感助手，專門協助一位創作可愛動物角色動圖和漫畫的創作者。

【重要：你必須知道的創作者背景資訊】
這位創作者專門畫「可愛動物」風格的作品，包括動圖 (GIF)、LINE 貼圖、Threads 社群內容等。
風格參考：吉伊卡哇、貓貓蟲咖波（彈彈 QQ、軟萌可愛風格）。

【角色宇宙 — 創作者已建立的角色】
${charDesc}
${storyDesc}

【你的任務】
1. 如果使用者上傳圖片：分析圖片風格，延伸發想新的創作主題（不要照抄）
2. 提出 3~5 個具體的主題方向，每個包含：主題名稱、畫面描述、色彩建議、可延伸系列
3. 請優先使用上面列出的角色來發想
4. 如果使用者問你是否知道他畫什麼：回答你知道他畫可愛動物角色，並列出你知道的角色

請用繁體中文回覆，語氣輕鬆有趣。`;
}

export default function BrainstormHub({ navigateTo }) {
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
  const [thinkingLevel, setThinkingLevel] = useLocalStorage('brainstorm_thinkingLevel', 'default');
  const [injectCreativeCtx, setInjectCreativeCtx] = useLocalStorage('brainstorm_injectCtx', true);
  const [mobilePanel, setMobilePanel] = useState('chat'); // 'chat' | 'images' | 'topics'
  const [myArtworks, setMyArtworks] = useLocalStorage('brainstorm_myArtworks', []); // 我的作品圖片
  const [showCreativeInfo, setShowCreativeInfo] = useState(false); // 創作資訊展開
  const [summarizing, setSummarizing] = useState(null); // 'topic' | idx | null
  const [copiedIdx, setCopiedIdx] = useState(null); // 複製狀態

  const fileInputRef = useRef(null);
  const artworkFileRef = useRef(null);
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
      
      // 有 Firebase → 上傳到 Storage 取得持久 URL
      if (uid && isFirebaseConfigured()) {
        try {
          const storageUrl = await uploadImageToStorage(uid, compressed, 'brainstorm-images');
          newImages.push(storageUrl);
        } catch (e) {
          console.warn('上傳圖片到 Storage 失敗，使用 data URL:', e);
          newImages.push(compressed);
        }
      } else {
        newImages.push(compressed);
      }
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
    if ((uploadedImages.length === 0 && myArtworks.length === 0) || isLoading) return;

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
      // 如果開啟創作資訊注入，把上下文拼到使用者訊息裡
      let enrichedMessages = newMessages;
      if (injectCreativeCtx) {
        const contextPrefix = getInspireSystemPrompt();
        enrichedMessages = newMessages.map((msg, idx) => {
          if (idx === newMessages.length - 1 && msg.role === 'user') {
            return { ...msg, content: `[系統背景資訊]\n${contextPrefix}\n\n---\n[使用者訊息]\n${msg.content}` };
          }
          return msg;
        });
      }
      const allImages = [...uploadedImages, ...myArtworks];
      const aiReply = await chatWithModel(chatModel, enrichedMessages, webSearch, allImages, thinkingLevel);
      updateTopic(topicId, { messages: [...newMessages, aiReply] });
      // 自動命名：僅當主題名稱是預設值時觸發
      const topic = topics.find(t => t.id === topicId);
      if (topic && (topic.name === 'AI 圖片靈感發想' || topic.name === '新對話' || topic.name.startsWith('續集'))) {
        const userContent = newMessages.filter(m => m.role === 'user').pop()?.content || '';
        autoNameTopic(userContent, aiReply.content || '').then(name => {
          if (name) updateTopic(topicId, { name });
        });
      }
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
      // 如果開啟創作資訊注入，把上下文拼到使用者訊息裡
      let enrichedMessages = newMessages;
      if (injectCreativeCtx) {
        const contextPrefix = getInspireSystemPrompt();
        enrichedMessages = newMessages.map((msg, idx) => {
          if (idx === newMessages.length - 1 && msg.role === 'user') {
            return { ...msg, content: `[系統背景資訊]\n${contextPrefix}\n\n---\n[使用者訊息]\n${msg.content}` };
          }
          return msg;
        });
      }
      // 合併參考圖 + 我的作品圖
      const allImages = [...(uploadedImages.length > 0 ? uploadedImages : []), ...myArtworks];
      const aiReply = await chatWithModel(chatModel, enrichedMessages, webSearch, allImages, thinkingLevel);
      updateTopic(topicId, { messages: [...newMessages, aiReply] });
      // 自動命名
      const topic = topics.find(t => t.id === topicId);
      if (topic && (topic.name === 'AI 圖片靈感發想' || topic.name === '新對話' || topic.name.startsWith('續集'))) {
        const userContent = newMessages.filter(m => m.role === 'user').pop()?.content || '';
        autoNameTopic(userContent, aiReply.content || '').then(name => {
          if (name) updateTopic(topicId, { name });
        });
      }
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
                <button
                  className="topic-action-btn"
                  disabled={summarizing === 'topic'}
                  title="用 Gemini 整理整個主題對話為摘要，存入全局記憶"
                  onClick={async () => {
                    setSummarizing('topic');
                    try {
                      const allText = messages
                        .filter(m => m.content)
                        .map(m => `${m.role === 'user' ? '使用者' : 'AI'}: ${m.content}`)
                        .join('\n');
                      await summarizeToMemory(allText, 'topic');
                      alert('✅ 已整理並存入全局記憶！');
                    } catch (e) {
                      alert('❌ ' + e.message);
                    }
                    setSummarizing(null);
                  }}
                >
                  {summarizing === 'topic' ? <Loader2 size={14} className="animate-spin" /> : '📌'} 整理到記憶
                </button>
                <button
                  className="topic-action-btn"
                  title="匯出整個主題對話為 .txt 檔案"
                  onClick={() => {
                    const text = messages
                      .filter(m => m.content)
                      .map(m => `[${m.role === 'user' ? '使用者' : 'AI'}]\n${m.content}`)
                      .join('\n\n' + '='.repeat(40) + '\n\n');
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${activeTopic?.name || '對話'}_${new Date().toLocaleDateString('zh-TW')}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={14} /> 匯出 txt
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    {/* 複製按鈕 */}
                    <button
                      className="msg-copy-btn"
                      title="複製此訊息"
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        setCopiedIdx(idx);
                        setTimeout(() => setCopiedIdx(null), 1500);
                      }}
                    >
                      {copiedIdx === idx ? <><Check size={12} /> 已複製</> : <><Copy size={12} /> 複製</>}
                    </button>
                    {/* 搜尋關鍵字展示 */}
                    {msg.searchQueries && msg.searchQueries.length > 0 && (
                      <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 11, color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>🔍 AI 搜尋關鍵字：</div>
                        {msg.searchQueries.map((q, qi) => (
                          <span key={qi} style={{ display: 'inline-block', background: 'rgba(99,102,241,0.15)', color: 'var(--accent-color)', padding: '2px 8px', borderRadius: 12, margin: '2px 4px 2px 0', fontSize: 11 }}>
                            {q}
                          </span>
                        ))}
                        {msg.searchSources && msg.searchSources.length > 0 && (
                          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-secondary)', opacity: 0.7 }}>
                            📄 參考：{msg.searchSources.slice(0, 5).join(' · ')}
                          </div>
                        )}
                      </div>
                    )}
                    {msg.role === 'system' && idx > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button className="btn-secondary transfer-prompt-btn"
                          onClick={() => navigateTo?.('style-lab', { prompt: msg.content.slice(0, 500) })}>
                          <Sparkles size={14} /> 送到繪圖區
                        </button>
                        <button className="btn-secondary transfer-prompt-btn"
                          onClick={() => {
                            // 將靈感內容存入 localStorage 讓 ContentCreator 讀取
                            localStorage.setItem('cc_pending_chat_msg', msg.content.slice(0, 500));
                            navigateTo?.('content-creator');
                          }}>
                          📝 送到劇情討論
                        </button>
                        <button className="btn-secondary transfer-prompt-btn"
                          disabled={summarizing === idx}
                          onClick={async () => {
                            setSummarizing(idx);
                            try {
                              await summarizeToMemory(msg.content, 'single');
                              alert('✅ 已存入全局記憶！');
                            } catch (e) {
                              alert('❌ ' + e.message);
                            }
                            setSummarizing(null);
                          }}>
                          {summarizing === idx ? <Loader2 size={14} className="animate-spin" /> : '📌'} 存入記憶
                        </button>
                      </div>
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

            {/* 我的作品 + 創作資訊快捷區 */}
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* 我的作品圖片預覽 */}
              {myArtworks.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>🖼️ 我的作品 ({myArtworks.length}):</span>
                  {myArtworks.map((img, i) => (
                    <div key={i} style={{ position: 'relative', width: 36, height: 36 }}>
                      <img src={img} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }} />
                      <button onClick={() => setMyArtworks(prev => prev.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--accent-red, #f44)', border: 'none', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {/* 創作資訊展開區 */}
              {showCreativeInfo && (
                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--text-secondary)', maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--border-color)' }}>
                  {(() => {
                    const ctx = getInspireSystemPrompt();
                    const contextStart = ctx.indexOf('【');
                    return contextStart > -1 ? ctx.slice(contextStart) : 'ℹ️ 尚未設定角色資訊。請先去「社群創作區」設定角色，或上傳你的作品讓 AI 精準分析。';
                  })()}
                </div>
              )}
              {/* 按鈕列 */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`btn-secondary${showCreativeInfo ? ' active' : ''}`}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => setShowCreativeInfo(v => !v)}
                >
                  📋 {showCreativeInfo ? '隱藏創作資訊' : '查看創作資訊'}
                </button>
                <input type="file" ref={artworkFileRef} hidden multiple accept="image/*" onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  for (const file of files) {
                    const dataUrl = await readFileAsDataUrl(file);
                    const compressed = await compressImage(dataUrl);
                    setMyArtworks(prev => [...prev, compressed]);
                  }
                  e.target.value = '';
                }} />
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => artworkFileRef.current?.click()}
                >
                  🖼️ 上傳我的作品
                </button>
              </div>
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
                <button
                  className={`btn-web-search ${injectCreativeCtx ? 'active' : ''}`}
                  onClick={() => setInjectCreativeCtx(!injectCreativeCtx)}
                  title={injectCreativeCtx ? '創作資訊注入：已開啟（每次對話都帶角色設定）' : '創作資訊注入：已關閉'}
                >
                  📋 {injectCreativeCtx ? 'ON' : 'OFF'}
                </button>
                <select
                  className="glass-input chat-model-select"
                  value={thinkingLevel}
                  onChange={e => setThinkingLevel(e.target.value)}
                  title="AI 思考深度"
                  style={{ maxWidth: 110 }}
                >
                  <option value="default">🧠 預設</option>
                  <option value="low">⚡ 快速</option>
                  <option value="medium">💭 適中</option>
                  <option value="high">🔬 深度</option>
                </select>
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
