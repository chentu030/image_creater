import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../hooks/useAuth';
import {
  Sparkles, Bot, User, Send, Plus, Trash2, Save, ChevronDown, ChevronRight,
  Upload, BarChart3, BookOpen, Clapperboard, Theater, Loader2, X, Check
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatWithModel, CHAT_MODELS } from '../services/api';
import {
  saveCharactersData, loadCharactersData,
  saveStoriesData, loadStoriesData,
  saveContentChatSessions, loadContentChatSessions,
  savePerformanceData, loadPerformanceData,
  isFirebaseConfigured
} from '../services/firebase';
import './ContentCreator.css';

// ─── 預設角色資料（來自原 characters.json）───
const DEFAULT_CHARACTERS = {
  characters: [
    {
      id: 'polar_bear', name: '熊賀', species: '北極熊', role: '主角',
      can_speak: false,
      personality: ['可愛', '小賤賤', '淘氣', '調皮搗蛋'],
      catchphrase: '(透過表情和動作表達，不說話)',
      backstory: '一隻看起來超可愛但其實很淘氣的北極熊，雖然不會說話，但總是用各種小動作逗弄其他角色。',
      likes: ['惡作劇', '搗蛋', '裝無辜'],
      traits: ['用表情包傳達情緒', '常常做壞事被抓包', '裝可愛逃避責任']
    },
    {
      id: 'pig', name: '小豬', species: '豬', role: '配角',
      can_speak: true,
      personality: ['呆萌', '憨厚', '單純', '天真'],
      catchphrase: '欸？真的嗎？',
      backstory: '一隻思想單純的小豬，常常被北極熊捉弄但還是很開心。',
      likes: ['吃東西', '睡覺', '跟朋友在一起'],
      traits: ['容易被騙', '反應慢半拍', '傻傻的很可愛']
    },
    {
      id: 'orca', name: '鯨鯨', species: '虎鯨', role: '配角',
      can_speak: true,
      personality: ['溫柔', '愛操心', '有點嘮叨', '內心溫暖'],
      catchphrase: '真是的～你們這些小傢伙！',
      backstory: '原本是海洋裡的大姐姐，因為太愛照顧其他海洋朋友，被大家推薦來當熊賀和小豬的保姆。',
      likes: ['整理房間', '做點心給大家吃', '看著大家開心的樣子'],
      traits: ['媽媽擔當（溫柔吐槽＋療癒擔當）']
    },
    {
      id: 'duck', name: '唉芽鴨', species: '鴨子', role: '配角',
      can_speak: false,
      personality: ['神經質', '易受驚', '敏感細膩', '內心堅強'],
      catchphrase: '嘎！(驚嚇時)、芽芽～(撒嬌時)',
      backstory: '原本是公園池塘裡最膽小的小鴨，因為太容易被嚇到而總是跟其他鴨子走散。某天被熊賀的惡作劇嚇到後意外跟著他們回家。',
      likes: ['安靜的角落', '溫暖的陽光', '被鯨鯨輕撫頭部'],
      traits: ['反應擔當＋隱藏療癒擔當']
    },
    {
      id: 'rabbit', name: '毛毛', species: '垂耳兔', role: '配角',
      can_speak: false,
      personality: ['超級愛乾淨', '完美主義', '容易抓狂', '其實很關心大家'],
      catchphrase: '用小手手瘋狂整理東西，生氣時耳朵會一抖一抖的',
      backstory: '原本是寵物店裡最愛乾淨的展示兔，每天都把自己的小籠子整理得一塵不染。',
      likes: ['整理收納', '聞到乾淨的味道', '看到東西排列整齊'],
      traits: ['吐槽擔當兼生活管家']
    }
  ],
  meta: { created_at: '2026-01-26', notes: '角色會隨時間增加' }
};

// 動物 emoji 對照表
const ANIMAL_EMOJI = {
  '北極熊': '🐻‍❄️', '豬': '🐷', '虎鯨': '🐋', '鴨子': '🦆', '垂耳兔': '🐰',
  '貓': '🐱', '狗': '🐶', '企鵝': '🐧', '倉鼠': '🐹', '狐狸': '🦊',
  '熊貓': '🐼', '青蛙': '🐸', '烏龜': '🐢', '刺蝟': '🦔', '羊': '🐑'
};
const getAnimalEmoji = (species) => ANIMAL_EMOJI[species] || '🐾';

// ID 生成
const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export default function ContentCreator({ navigateTo }) {
  const { uid } = useAuth();
  const [activeTab, setActiveTab] = useLocalStorage('cc_activeTab', 'characters');
  const [chatModel, setChatModel] = useLocalStorage('cc_chatModel', 'gemini');

  // ─── 資料 state ───
  const [characters, setCharacters] = useState(DEFAULT_CHARACTERS);
  const [stories, setStories] = useState({ stories: [], meta: {} });
  const [chatSessions, setChatSessions] = useState({ sessions: [] });
  const [performanceData, setPerformanceData] = useState(null);
  const [firebaseLoaded, setFirebaseLoaded] = useState(false);

  // 從靈感區跳過來時，自動切到劇情討論 tab
  useEffect(() => {
    const pending = localStorage.getItem('cc_pending_chat_msg');
    if (pending) setActiveTab('comic-chat');
  }, []);

  // ─── 從 Firebase 載入 ───
  useEffect(() => {
    if (!uid || !isFirebaseConfigured() || firebaseLoaded) return;
    (async () => {
      try {
        const [charData, storyData, chatData, perfData] = await Promise.all([
          loadCharactersData(uid),
          loadStoriesData(uid),
          loadContentChatSessions(uid),
          loadPerformanceData(uid)
        ]);
        if (charData?.characters) {
          setCharacters(charData);
          localStorage.setItem('cc_characters', JSON.stringify(charData));
        }
        if (storyData?.stories) {
          setStories(storyData);
          localStorage.setItem('cc_stories', JSON.stringify(storyData));
        }
        if (chatData?.sessions) {
          setChatSessions(chatData);
          localStorage.setItem('cc_chatSessions', JSON.stringify(chatData));
        }
        if (perfData) setPerformanceData(perfData);
      } catch (e) {
        console.warn('載入社群創作資料失敗:', e);
      }
      setFirebaseLoaded(true);
    })();
  }, [uid, firebaseLoaded]);

  // 首次渲染：將預設角色寫入 localStorage（確保靈感區 AI 能讀到）
  useEffect(() => {
    if (!localStorage.getItem('cc_characters')) {
      localStorage.setItem('cc_characters', JSON.stringify(DEFAULT_CHARACTERS));
    }
  }, []);

  // ─── 自動保存 helpers（同步 Firebase + localStorage）───
  const saveChars = useCallback((data) => {
    setCharacters(data);
    localStorage.setItem('cc_characters', JSON.stringify(data));
    if (uid && isFirebaseConfigured()) saveCharactersData(uid, data).catch(console.warn);
  }, [uid]);

  const saveStory = useCallback((data) => {
    setStories(data);
    localStorage.setItem('cc_stories', JSON.stringify(data));
    if (uid && isFirebaseConfigured()) saveStoriesData(uid, data).catch(console.warn);
  }, [uid]);

  const saveSessions = useCallback((data) => {
    setChatSessions(data);
    localStorage.setItem('cc_chatSessions', JSON.stringify(data));
    if (uid && isFirebaseConfigured()) saveContentChatSessions(uid, data.sessions).catch(console.warn);
  }, [uid]);

  // ─── Tab 定義 ───
  const tabs = [
    { id: 'characters', label: '角色人設', icon: <Theater size={16} /> },
    { id: 'inspire', label: '動圖靈感', icon: <Sparkles size={16} /> },
    { id: 'comic-chat', label: '劇情討論', icon: <Bot size={16} /> },
    { id: 'story-lib', label: '劇情庫', icon: <BookOpen size={16} /> },
    { id: 'analytics', label: '績效分析', icon: <BarChart3 size={16} /> },
  ];

  return (
    <div className="workspace animate-fade-in" style={{ padding: '20px' }}>
      {/* Tab 切換 */}
      <div className="cc-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`cc-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 子頁面 */}
      {activeTab === 'characters' && (
        <CharactersPanel characters={characters} saveChars={saveChars} chatModel={chatModel} setChatModel={setChatModel} />
      )}
      {activeTab === 'inspire' && (
        <InspirePanel characters={characters} chatModel={chatModel} setChatModel={setChatModel} navigateTo={navigateTo} />
      )}
      {activeTab === 'comic-chat' && (
        <ComicChatPanel characters={characters} stories={stories} saveStory={saveStory} chatSessions={chatSessions} saveSessions={saveSessions} chatModel={chatModel} setChatModel={setChatModel} navigateTo={navigateTo} />
      )}
      {activeTab === 'story-lib' && (
        <StoryLibPanel stories={stories} saveStory={saveStory} />
      )}
      {activeTab === 'analytics' && (
        <AnalyticsPanel characters={characters} performanceData={performanceData} setPerformanceData={setPerformanceData} uid={uid} chatModel={chatModel} setChatModel={setChatModel} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// Tab 1: 角色人設管理
// ═══════════════════════════════════════
function CharactersPanel({ characters, saveChars, chatModel, setChatModel }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editData, setEditData] = useState({});
  const [aiLoading, setAiLoading] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [newChar, setNewChar] = useState({ name: '', species: '', can_speak: true, personality: '' });

  const handleSaveChar = (idx) => {
    const updated = { ...characters };
    const ed = editData;
    updated.characters[idx] = {
      ...updated.characters[idx],
      name: ed.name ?? updated.characters[idx].name,
      species: ed.species ?? updated.characters[idx].species,
      role: ed.role ?? updated.characters[idx].role,
      can_speak: ed.can_speak ?? updated.characters[idx].can_speak,
      personality: ed.personality ? ed.personality.split(',').map(s => s.trim()).filter(Boolean) : updated.characters[idx].personality,
      catchphrase: ed.catchphrase ?? updated.characters[idx].catchphrase,
      likes: ed.likes ? ed.likes.split(',').map(s => s.trim()).filter(Boolean) : updated.characters[idx].likes,
      backstory: ed.backstory ?? updated.characters[idx].backstory,
    };
    updated.meta = { ...updated.meta, last_updated: new Date().toISOString().slice(0, 10) };
    saveChars(updated);
    setEditData({});
    setExpandedId(null);
  };

  const handleDeleteChar = (idx) => {
    const updated = { ...characters, characters: characters.characters.filter((_, i) => i !== idx) };
    saveChars(updated);
    setExpandedId(null);
  };

  const handleAddChar = () => {
    if (!newChar.name || !newChar.species) return;
    const char = {
      id: newChar.name.toLowerCase().replace(/\s/g, '_'),
      name: newChar.name, species: newChar.species, role: '配角',
      can_speak: newChar.can_speak,
      personality: newChar.personality ? newChar.personality.split(',').map(s => s.trim()).filter(Boolean) : ['待設定'],
      catchphrase: '待設定', backstory: '待設定', likes: ['待設定'], traits: ['待設定'], relationships: {}
    };
    const updated = { ...characters, characters: [...characters.characters, char] };
    saveChars(updated);
    setNewChar({ name: '', species: '', can_speak: true, personality: '' });
  };

  const handleAIEnhance = async (idx) => {
    setAiLoading(idx);
    setAiResult(null);
    const char = characters.characters[idx];
    const otherChars = characters.characters.filter((_, i) => i !== idx)
      .map(c => `- ${c.name} (${c.species}): ${c.personality.join(', ')}`).join('\n');

    const prompt = `你是一位擅長創作可愛動物角色的創意總監。

【風格參考】吉伊卡哇、貓貓蟲咖波

【現有角色團隊】
${otherChars || '(這是第一個角色)'}

【需要完善的角色】
名稱: ${char.name}，動物: ${char.species}，性格: ${char.personality.join(', ')}
是否會說話: ${char.can_speak ? '是' : '否'}

請用 JSON 格式回覆：
\`\`\`json
{
  "personality": ["性格1", "性格2", "性格3"],
  "catchphrase": "口頭禪",
  "backstory": "背景故事",
  "likes": ["喜好1", "喜好2"],
  "team_role": "團隊定位"
}
\`\`\`
另外說明與每個現有角色的互動關係。請用繁體中文。`;

    try {
      const reply = await chatWithModel(chatModel, [{ role: 'user', content: prompt }], false);
      setAiResult({ idx, text: reply.content });
    } catch (e) {
      setAiResult({ idx, text: `❌ 錯誤: ${e.message}` });
    }
    setAiLoading(null);
  };

  const applyAIResult = (idx) => {
    if (!aiResult?.text) return;
    try {
      const jsonMatch = aiResult.text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (!jsonMatch) return;
      const ai = JSON.parse(jsonMatch[1]);
      const updated = { ...characters };
      if (ai.personality) updated.characters[idx].personality = ai.personality;
      if (ai.catchphrase) updated.characters[idx].catchphrase = ai.catchphrase;
      if (ai.backstory) updated.characters[idx].backstory = ai.backstory;
      if (ai.likes) updated.characters[idx].likes = ai.likes;
      if (ai.team_role) updated.characters[idx].traits = [ai.team_role];
      saveChars(updated);
      setAiResult(null);
    } catch { /* ignore parse error */ }
  };

  return (
    <div className="cc-panel">
      <div className="cc-section-header">
        <h2>🎭 角色人設管理</h2>
        <ModelSelector model={chatModel} setModel={setChatModel} />
      </div>

      <div className="cc-characters-grid">
        {characters.characters.map((char, idx) => {
          const isExpanded = expandedId === idx;
          const ed = isExpanded ? editData : {};
          return (
            <div className="cc-char-card" key={char.id || idx}>
              <div className="cc-char-header" onClick={() => { setExpandedId(isExpanded ? null : idx); setEditData({}); setAiResult(null); }}>
                <div className="cc-char-info">
                  <div className="cc-char-avatar">{getAnimalEmoji(char.species)}</div>
                  <div>
                    <div className="cc-char-name">{char.name}</div>
                    <div className="cc-char-meta">{char.species} · {char.can_speak ? '會說話' : '不會說話'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`cc-char-role-badge ${char.role === '主角' ? 'main' : ''}`}>{char.role}</span>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
              </div>

              {isExpanded && (
                <div className="cc-char-body">
                  <div className="form-grid">
                    <div className="cc-field">
                      <label>角色名稱</label>
                      <input value={ed.name ?? char.name} onChange={e => setEditData({ ...editData, name: e.target.value })} />
                    </div>
                    <div className="cc-field">
                      <label>動物種類</label>
                      <input value={ed.species ?? char.species} onChange={e => setEditData({ ...editData, species: e.target.value })} />
                    </div>
                    <div className="cc-field">
                      <label>角色定位</label>
                      <select value={ed.role ?? char.role} onChange={e => setEditData({ ...editData, role: e.target.value })}>
                        <option>主角</option><option>配角</option><option>客串</option>
                      </select>
                    </div>
                    <div className="cc-field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={ed.can_speak ?? char.can_speak} onChange={e => setEditData({ ...editData, can_speak: e.target.checked })} />
                        會說話
                      </label>
                    </div>
                    <div className="cc-field">
                      <label>性格（逗號分隔）</label>
                      <input value={ed.personality ?? char.personality.join(', ')} onChange={e => setEditData({ ...editData, personality: e.target.value })} />
                    </div>
                    <div className="cc-field">
                      <label>口頭禪</label>
                      <input value={ed.catchphrase ?? char.catchphrase} onChange={e => setEditData({ ...editData, catchphrase: e.target.value })} />
                    </div>
                    <div className="cc-field">
                      <label>喜好（逗號分隔）</label>
                      <input value={ed.likes ?? char.likes.join(', ')} onChange={e => setEditData({ ...editData, likes: e.target.value })} />
                    </div>
                  </div>
                  <div className="form-grid full" style={{ marginTop: 8 }}>
                    <div className="cc-field">
                      <label>背景故事</label>
                      <textarea rows={3} value={ed.backstory ?? char.backstory} onChange={e => setEditData({ ...editData, backstory: e.target.value })} />
                    </div>
                  </div>

                  <div className="cc-char-actions">
                    <button className="cc-btn cc-btn-primary" onClick={() => handleSaveChar(idx)}><Save size={14} /> 儲存</button>
                    <button className="cc-btn cc-btn-secondary" onClick={() => handleAIEnhance(idx)} disabled={aiLoading === idx}>
                      {aiLoading === idx ? <><Loader2 size={14} className="cc-spinner" /> AI 分析中...</> : <><Sparkles size={14} /> AI 完善人設</>}
                    </button>
                    <button className="cc-btn cc-btn-danger" onClick={() => handleDeleteChar(idx)}><Trash2 size={14} /> 刪除</button>
                  </div>

                  {aiResult?.idx === idx && (
                    <div className="cc-ai-result">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult.text}</ReactMarkdown>
                      {aiResult.text.includes('```json') && (
                        <button className="cc-btn cc-btn-primary cc-btn-full" style={{ marginTop: 12 }} onClick={() => applyAIResult(idx)}>
                          <Check size={14} /> 一鍵套用 AI 建議
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 新增角色 */}
      <div className="cc-add-form">
        <h3><Plus size={16} /> 新增角色</h3>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="cc-field"><label>角色名稱</label><input value={newChar.name} onChange={e => setNewChar({ ...newChar, name: e.target.value })} placeholder="例如：小橘" /></div>
          <div className="cc-field"><label>動物種類</label><input value={newChar.species} onChange={e => setNewChar({ ...newChar, species: e.target.value })} placeholder="例如：橘貓" /></div>
          <div className="cc-field"><label>性格（逗號分隔）</label><input value={newChar.personality} onChange={e => setNewChar({ ...newChar, personality: e.target.value })} placeholder="例如：傲嬌, 貪吃" /></div>
          <div className="cc-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={newChar.can_speak} onChange={e => setNewChar({ ...newChar, can_speak: e.target.checked })} /> 會說話</label>
          </div>
        </div>
        <button className="cc-btn cc-btn-primary cc-btn-full" style={{ marginTop: 12 }} onClick={handleAddChar} disabled={!newChar.name || !newChar.species}>
          <Plus size={14} /> 新增角色
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Tab 2: 每日動圖靈感
// ═══════════════════════════════════════
function InspirePanel({ characters, chatModel, setChatModel, navigateTo }) {
  const [theme, setTheme] = useState('隨機驚喜');
  const [numIdeas, setNumIdeas] = useState(5);
  const [specialNote, setSpecialNote] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const getCharContext = () => {
    return characters.characters
      .filter(c => c.personality[0] !== '待設定')
      .map(c => `${c.name} (${c.species}): ${c.personality.join(', ')}${c.can_speak ? '' : ' [不會說話]'}`)
      .join('\n');
  };

  const handleGenerate = async () => {
    setLoading(true);
    setResult('');
    const prompt = `你是一位專門設計可愛動物動圖的創意總監。

【風格參考】吉伊卡哇、貓貓蟲咖波
【角色設定】
${getCharContext()}

請生成 ${numIdeas} 個「動物 + 內容/情境」的動圖創意組合。
風格: 彈彈 QQ、軟萌可愛
主題方向: ${theme}
${specialNote ? `特別需求: ${specialNote}` : ''}

每個創意用以下格式：
## 創意 N: [標題]
🐾 **動物**: [動物名稱]
🎬 **情境/內容**: [描述]
💡 **亮點**: [為什麼吸引人]
📝 **建議文案**: [Threads 貼文文字]

---

請發揮創意，用繁體中文！`;

    try {
      const reply = await chatWithModel(chatModel, [{ role: 'user', content: prompt }], false);
      setResult(reply.content);
    } catch (e) {
      setResult(`❌ 錯誤: ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="cc-panel">
      <div className="cc-section-header">
        <h2>✨ 每日動圖靈感生成器</h2>
        <ModelSelector model={chatModel} setModel={setChatModel} />
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>生成「動物 + 內容」的創意組合，適合彈彈 QQ 動圖風格</p>

      <div className="cc-inspire-controls">
        <div className="cc-field">
          <label>主題方向</label>
          <select value={theme} onChange={e => setTheme(e.target.value)}>
            {['隨機驚喜', '美食系列', '日常生活', '節日特輯', '搞笑惡作劇', '療癒放鬆'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="cc-field">
          <label>生成數量: {numIdeas}</label>
          <input type="range" min={3} max={10} value={numIdeas} onChange={e => setNumIdeas(+e.target.value)} />
        </div>
        <div className="cc-field" style={{ flex: 2 }}>
          <label>特別需求（可選）</label>
          <input value={specialNote} onChange={e => setSpecialNote(e.target.value)} placeholder="例如：配合情人節、要有北極熊" />
        </div>
      </div>

      <button className="cc-btn cc-btn-primary cc-btn-full" onClick={handleGenerate} disabled={loading}>
        {loading ? <><Loader2 size={16} className="cc-spinner" /> 靈感生成中...</> : <><Sparkles size={16} /> 生成創意</>}
      </button>

      {result && (
        <div className="cc-result-box">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
          {/* 跨區快捷按鈕 */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            <button className="cc-btn cc-btn-primary" onClick={() => navigateTo?.('style-lab', { prompt: result.slice(0, 500) })}>
              🎨 送到繪圖區
            </button>
            <button className="cc-btn cc-btn-secondary" onClick={() => navigateTo?.('brainstorm', { initialMessage: result.slice(0, 500) })}>
              💡 送到靈感區
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// Tab 3: 漫畫劇情討論
// ═══════════════════════════════════════
function ComicChatPanel({ characters, stories, saveStory, chatSessions, saveSessions, chatModel, setChatModel, navigateTo }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [selectedChars, setSelectedChars] = useState(characters.characters.slice(0, 2).map(c => c.name));
  const [storyStyle, setStoryStyle] = useState('輕鬆隨性');
  const [storyTitle, setStoryTitle] = useState('');
  const [storyType, setStoryType] = useState('獨立');
  const messagesEndRef = useRef(null);

  // 接收來自靈感區的跨區訊息
  useEffect(() => {
    const pending = localStorage.getItem('cc_pending_chat_msg');
    if (pending) {
      setInput(`根據這個靈感來討論劇情：\n${pending}`);
      localStorage.removeItem('cc_pending_chat_msg');
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleChar = (name) => {
    setSelectedChars(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const saveCurrentSession = useCallback((msgs) => {
    const title = msgs.find(m => m.role === 'user')?.content.slice(0, 20) + '...' || '新對話';
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const newSessions = { ...chatSessions };

    if (sessionId) {
      const idx = newSessions.sessions.findIndex(s => s.id === sessionId);
      if (idx >= 0) {
        newSessions.sessions[idx] = { ...newSessions.sessions[idx], messages: msgs, last_updated: now, title: newSessions.sessions[idx].title === '新對話' ? title : newSessions.sessions[idx].title };
      }
    } else {
      const newId = genId();
      setSessionId(newId);
      newSessions.sessions = [{ id: newId, title, created_at: now, last_updated: now, messages: msgs }, ...newSessions.sessions];
    }
    saveSessions(newSessions);
  }, [chatSessions, sessionId, saveSessions]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput('');
    setLoading(true);
    saveCurrentSession(newMsgs);

    const charContext = selectedChars.map(name => {
      const c = characters.characters.find(ch => ch.name === name);
      if (!c) return '';
      return `- ${c.name} (${c.species}): ${c.personality.join(', ')}${c.can_speak ? '' : '（不會說話）'}`;
    }).filter(Boolean).join('\n');

    const recentStories = stories.stories.slice(-3).map(s => `- ${s.title}: ${s.content?.slice(0, 80)}...`).join('\n');
    const convHistory = newMsgs.slice(-6).map(m => `${m.role === 'user' ? '我' : 'AI'}: ${m.content}`).join('\n');

    const prompt = `你是一位可愛動物漫畫的創意夥伴。

【風格參考】吉伊卡哇、貓貓蟲咖波
【參與角色】
${charContext || '(還沒選角色)'}
${recentStories ? `【最近劇情】\n${recentStories}` : ''}
【風格】: ${storyStyle}
【之前的討論】
${convHistory}

【互動指南】用輕鬆對話的方式回應，可以問問題、給建議、直接提供點子。
如果我說「就這個了」，幫我整理成完整劇本格式。
請用繁體中文，像朋友聊天一樣！`;

    try {
      const reply = await chatWithModel(chatModel, [{ role: 'user', content: prompt }], false);
      const updatedMsgs = [...newMsgs, { role: 'assistant', content: reply.content }];
      setMessages(updatedMsgs);
      saveCurrentSession(updatedMsgs);
    } catch (e) {
      const errMsgs = [...newMsgs, { role: 'assistant', content: `❌ ${e.message}` }];
      setMessages(errMsgs);
    }
    setLoading(false);
  };

  const loadSession = (sid) => {
    const session = chatSessions.sessions.find(s => s.id === sid);
    if (session) {
      setMessages(session.messages || []);
      setSessionId(sid);
    }
  };

  const deleteSession = (sid) => {
    const updated = { ...chatSessions, sessions: chatSessions.sessions.filter(s => s.id !== sid) };
    saveSessions(updated);
    if (sessionId === sid) { setMessages([]); setSessionId(null); }
  };

  const startNewChat = () => { setMessages([]); setSessionId(null); };

  const handleSaveToStoryLib = () => {
    if (!storyTitle.trim()) return;
    const content = messages.filter(m => m.role === 'assistant').map(m => m.content).join('\n---\n');
    const newStory = {
      id: Date.now(),
      title: storyTitle,
      content: content.slice(-2000),
      characters: selectedChars,
      type: storyType,
      created_at: new Date().toISOString().slice(0, 16).replace('T', ' ')
    };
    const updated = { ...stories, stories: [...stories.stories, newStory] };
    saveStory(updated);
    setStoryTitle('');
  };

  return (
    <div className="cc-panel">
      <div className="cc-section-header">
        <h2>💬 漫畫劇情討論室</h2>
        <ModelSelector model={chatModel} setModel={setChatModel} />
      </div>

      <div className="cc-chat-layout">
        {/* 聊天主區 */}
        <div className="cc-chat-main">
          <div className="cc-chat-settings">
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>角色:</span>
            {characters.characters.map(c => (
              <span key={c.id} className={`char-tag ${selectedChars.includes(c.name) ? 'selected' : ''}`} onClick={() => toggleChar(c.name)}>
                {getAnimalEmoji(c.species)} {c.name}
              </span>
            ))}
            <select value={storyStyle} onChange={e => setStoryStyle(e.target.value)} style={{ marginLeft: 'auto' }}>
              {['輕鬆隨性', '搞笑為主', '溫馨療癒', '無厘頭'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="cc-chat-messages">
            {messages.length === 0 && (
              <div className="cc-empty"><div className="icon">💬</div><p>開始跟 AI 討論任何劇情點子吧！</p></div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`cc-chat-msg ${m.role}`}>
                {m.role === 'assistant' ? (
                  <>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      <button className="cc-btn cc-btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={() => navigateTo?.('style-lab', { prompt: m.content.slice(0, 500) })}>
                        🎨 送到繪圖區
                      </button>
                    </div>
                  </>
                ) : m.content}
              </div>
            ))}
            {loading && <div className="cc-loading"><div className="cc-spinner" /> AI 思考中...</div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="cc-chat-input-row">
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="說說你的想法..."
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
            <button className="cc-btn cc-btn-primary" onClick={handleSend} disabled={loading || !input.trim()}>
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* 側邊 */}
        <div className="cc-chat-sidebar">
          <button className="cc-btn cc-btn-primary cc-btn-full" onClick={startNewChat}><Plus size={14} /> 新對話</button>

          {/* 儲存劇情 */}
          <div className="cc-save-story-form">
            <h4><Save size={14} /> 儲存到劇情庫</h4>
            <div className="cc-field"><input value={storyTitle} onChange={e => setStoryTitle(e.target.value)} placeholder="劇情標題" /></div>
            <div className="cc-field" style={{ marginTop: 6 }}>
              <select value={storyType} onChange={e => setStoryType(e.target.value)}><option>獨立</option><option>連載</option></select>
            </div>
            <button className="cc-btn cc-btn-secondary cc-btn-full" style={{ marginTop: 8 }} onClick={handleSaveToStoryLib} disabled={!storyTitle.trim() || messages.length === 0}>
              <Save size={14} /> 存入
            </button>
          </div>

          {/* 歷史 */}
          <div className="cc-history-list">
            {chatSessions.sessions.map(s => (
              <div key={s.id} className={`cc-history-item ${sessionId === s.id ? 'active' : ''}`} onClick={() => loadSession(s.id)}>
                <span className="title">{s.title}</span>
                <button className="del-btn" onClick={e => { e.stopPropagation(); deleteSession(s.id); }}><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Tab 4: 劇情庫
// ═══════════════════════════════════════
function StoryLibPanel({ stories, saveStory }) {
  const [filterType, setFilterType] = useState('全部');
  const [sortOrder, setSortOrder] = useState('最新優先');
  const [expandedId, setExpandedId] = useState(null);

  let filtered = stories.stories || [];
  if (filterType !== '全部') filtered = filtered.filter(s => s.type === filterType);
  if (sortOrder === '最新優先') filtered = [...filtered].reverse();

  const handleDelete = (id) => {
    const updated = { ...stories, stories: stories.stories.filter(s => s.id !== id) };
    saveStory(updated);
    setExpandedId(null);
  };

  return (
    <div className="cc-panel">
      <div className="cc-section-header"><h2>📖 劇情庫</h2></div>

      {filtered.length === 0 && (
        <div className="cc-empty"><div className="icon">📖</div><p>還沒有劇情，去「劇情討論」創作一個吧！</p></div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="cc-stories-filters">
            <div className="cc-field">
              <label>類型</label>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                <option>全部</option><option>獨立</option><option>連載</option>
              </select>
            </div>
            <div className="cc-field">
              <label>排序</label>
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                <option>最新優先</option><option>最舊優先</option>
              </select>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-secondary)' }}>共 {filtered.length} 篇</div>
          </div>

          {filtered.map(story => (
            <div className="cc-story-card" key={story.id}>
              <div className="cc-story-header" onClick={() => setExpandedId(expandedId === story.id ? null : story.id)}>
                <div>
                  <strong>{story.title}</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>{story.created_at}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`cc-story-type ${story.type === '連載' ? 'series' : ''}`}>{story.type || '獨立'}</span>
                  {expandedId === story.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
              </div>
              {expandedId === story.id && (
                <div className="cc-story-body">
                  {story.characters?.length > 0 && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>角色: {story.characters.join(', ')}</p>}
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{story.content}</ReactMarkdown>
                  <button className="cc-btn cc-btn-danger" style={{ marginTop: 12 }} onClick={() => handleDelete(story.id)}>
                    <Trash2 size={14} /> 刪除
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// Tab 5: 績效分析
// ═══════════════════════════════════════
function AnalyticsPanel({ characters, performanceData, setPerformanceData, uid, chatModel, setChatModel }) {
  const [dragOver, setDragOver] = useState(false);
  const [aiResult, setAiResult] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = line.match(/(".*?"|[^,]+)/g) || [];
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (values[i] || '').replace(/^"|"$/g, '').trim(); });
      return obj;
    });
  };

  const handleFile = async (file) => {
    if (!file || !file.name.endsWith('.csv')) return;
    const text = await file.text();
    const rows = parseCSV(text);
    const data = {
      fileName: file.name,
      rowCount: rows.length,
      rows: rows.slice(0, 200), // 限制保存量
      headers: Object.keys(rows[0] || {}),
    };
    setPerformanceData(data);
    if (uid && isFirebaseConfigured()) {
      savePerformanceData(uid, data).catch(console.warn);
    }
  };

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); };

  const handleAnalyze = async () => {
    if (!performanceData?.rows?.length) return;
    setLoading(true);
    setAiResult('');

    const charNames = characters.characters.map(c => c.name);
    const allTexts = performanceData.rows
      .filter(r => r.text && r.media_type !== 'REPOST_FACADE')
      .map(r => `- ${(r.text || '').slice(0, 200)}`)
      .slice(0, 10).join('\n');

    const prompt = `你是一位社群經營專家，分析可愛動物帳號的內容表現。

【帳號】@vigorousanimals
【角色】${charNames.join(', ')}

【貼文內容】(共 ${performanceData.rowCount} 篇)
${allTexts}

請分析並建議：
1. **內容模式分析**: 貼文有什麼特點？風格一致嗎？
2. **內容優化建議**: 文案怎麼改進？主題建議？
3. **創意點子**: 給 5 個具體的新貼文創意

請用繁體中文回答。`;

    try {
      const reply = await chatWithModel(chatModel, [{ role: 'user', content: prompt }], true);
      setAiResult(reply.content);
    } catch (e) {
      setAiResult(`❌ ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="cc-panel">
      <div className="cc-section-header">
        <h2>📊 績效分析與建議</h2>
        <ModelSelector model={chatModel} setModel={setChatModel} />
      </div>

      {/* CSV 上傳 */}
      {!performanceData ? (
        <div className={`cc-csv-upload ${dragOver ? 'dragover' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}>
          <div className="upload-icon">📂</div>
          <p><strong>拖放 CSV 檔案</strong>或點擊選擇</p>
          <p>支援 threads_posts.csv 或 comments.csv</p>
          <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={e => handleFile(e.target.files[0])} />
        </div>
      ) : (
        <>
          <div className="cc-stats-grid">
            <div className="cc-stat-card"><div className="value">{performanceData.rowCount}</div><div className="label">總資料筆數</div></div>
            <div className="cc-stat-card"><div className="value">{performanceData.headers?.length || 0}</div><div className="label">欄位數</div></div>
            <div className="cc-stat-card"><div className="value">{performanceData.fileName}</div><div className="label">檔案名稱</div></div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="cc-btn cc-btn-primary" onClick={handleAnalyze} disabled={loading}>
              {loading ? <><Loader2 size={16} className="cc-spinner" /> 分析中...</> : <><Sparkles size={16} /> AI 分析並給建議</>}
            </button>
            <button className="cc-btn cc-btn-secondary" onClick={() => { setPerformanceData(null); setAiResult(''); }}>
              <Upload size={14} /> 重新上傳
            </button>
          </div>

          {aiResult && (
            <div className="cc-ai-result">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiResult}</ReactMarkdown>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// 共用：模型選擇器
// ═══════════════════════════════════════
function ModelSelector({ model, setModel }) {
  return (
    <div className="cc-model-selector">
      <Bot size={14} />
      <select value={model} onChange={e => setModel(e.target.value)}>
        {CHAT_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  );
}
