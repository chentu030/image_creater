import React, { useState, useEffect } from 'react';
import { Palette, Lightbulb, Film, FolderClock, Settings, Moon, Sun, LogOut, Megaphone, BookOpen, X, Save } from 'lucide-react';
import './Sidebar.css';

// 全局記憶編輯 Modal
function GlobalMemoryModal({ isOpen, onClose }) {
  const [memory, setMemory] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMemory(localStorage.getItem('ai_global_memory') || '');
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('ai_global_memory', memory);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="memory-modal-overlay" onClick={onClose}>
      <div className="memory-modal" onClick={e => e.stopPropagation()}>
        <div className="memory-modal-header">
          <h3>📝 全局記憶檔案</h3>
          <button className="memory-close-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="memory-desc">
          這裡寫的內容會在<strong>每次 AI 對話時自動傳送</strong>，讓所有 AI 都知道你的背景資訊。
          例如：你的創作風格、偏好、注意事項等。
        </p>
        <textarea
          className="memory-textarea"
          value={memory}
          onChange={e => setMemory(e.target.value)}
          placeholder={`範例：\n\n我是一個創作可愛動物角色的創作者\n主要角色：熊賀（北極熊）、小豬、鯨鯨、唉芽鴨、毛毛\n風格：類似吉伊卡哇、貓貓蟲咖波\n用途：Threads 社群經營、LINE 貼圖\n\n注意事項：\n- 請用繁體中文回覆\n- 風格要可愛、軟萌\n- 不要太嚴肅`}
          rows={12}
        />
        <div className="memory-footer">
          <span className="memory-hint">{memory.length} 字</span>
          <button className="btn-primary memory-save-btn" onClick={handleSave}>
            <Save size={14} />
            {saved ? '✅ 已儲存！' : '儲存記憶'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ activeTab, setActiveTab, theme, setTheme, user, onLogout, isOpen, onToggle }) {
  const [memoryOpen, setMemoryOpen] = useState(false);

  const navItems = [
    { id: 'style-lab', label: '風格繪圖區', icon: <Palette size={20} /> },
    { id: 'brainstorm', label: '靈感發想區', icon: <Lightbulb size={20} /> },
    { id: 'content-creator', label: '社群創作區', icon: <Megaphone size={20} /> },
    { id: 'animation', label: '動畫生成區', icon: <Film size={20} /> },
    { id: 'history', label: '生成歷史', icon: <FolderClock size={20} /> },
  ];

  const isDark = theme === 'dark';

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
        <div className="sidebar-header">
          <div className="logo-icon">✨</div>
          <h2>AI Studio</h2>
        </div>
        
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}

          {/* 全局記憶按鈕 */}
          <div className="nav-divider" />
          <button
            className="nav-item memory-nav-item"
            onClick={() => setMemoryOpen(true)}
          >
            <BookOpen size={20} />
            <span>全局記憶</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div
            className="theme-toggle"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            role="button"
            tabIndex={0}
          >
            {isDark ? <Moon size={20} /> : <Sun size={20} />}
            <span>{isDark ? '深色模式' : '淺色模式'}</span>
            <div className={`toggle-switch ${isDark ? 'active' : ''}`}></div>
          </div>
          <button className="nav-item">
            <Settings size={20} />
            <span>設定 API Keys</span>
          </button>

          {/* 使用者資訊 */}
          {user && (
            <div className="sidebar-user-info">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="sidebar-user-avatar" referrerPolicy="no-referrer" />
              ) : (
                <div className="sidebar-user-avatar" style={{background: 'var(--secondary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px'}}>
                  {(user.displayName || '?')[0]}
                </div>
              )}
              <span className="sidebar-user-name">{user.displayName || '使用者'}</span>
              {onLogout && (
                <button className="sidebar-logout-btn" onClick={onLogout} title="登出">
                  <LogOut size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* 全局記憶 Modal */}
      <GlobalMemoryModal isOpen={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </>
  );
}
