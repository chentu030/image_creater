import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Sidebar from './components/Sidebar';
import StyleLab from './components/StyleLab';
import BrainstormHub from './components/BrainstormHub';
import ContentCreator from './components/ContentCreator';
import AnimationStudio from './components/AnimationStudio';
import HistoryGallery from './components/HistoryGallery';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

function AppContent() {
  const [activeTab, setActiveTab] = useState('style-lab');
  const [theme, setTheme] = useLocalStorage('app_theme', 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, loading, login, logout, isConfigured, displayName, photoURL } = useAuth();
  // 跨區導航系統：帶資料跳轉到其他 tab
  const [navPayload, setNavPayload] = useState(null);

  // 切換 tab 後自動收合 sidebar
  const handleSetActiveTab = useCallback((tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    setNavPayload(null); // 手動切 tab 時清除 payload
  }, []);

  // 跨區導航：帶資料跳轉
  const navigateTo = useCallback((tab, payload = null) => {
    setNavPayload(payload);
    setActiveTab(tab);
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Firebase 未設定時，直接顯示 app（不需登入）
  if (!isConfigured) {
    return (
      <div className="app-container">
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <Sidebar activeTab={activeTab} setActiveTab={handleSetActiveTab} theme={theme} setTheme={setTheme} isOpen={sidebarOpen} onToggle={() => setSidebarOpen(v => !v)} />
        <button className="sidebar-hamburger" onClick={() => setSidebarOpen(v => !v)} title="選單">
          <span /><span /><span />
        </button>
        <main className="main-content">
          {activeTab === 'style-lab' && <StyleLab navPayload={navPayload} onPayloadConsumed={() => setNavPayload(null)} />}
          {activeTab === 'brainstorm' && <BrainstormHub navigateTo={navigateTo} />}
          {activeTab === 'content-creator' && <ContentCreator navigateTo={navigateTo} />}
          {activeTab === 'animation' && <AnimationStudio />}
          {activeTab === 'history' && <HistoryGallery />}
        </main>
      </div>
    );
  }

  // 載入中
  if (loading) {
    return (
      <div className="login-screen">
        <div className="login-card glass-panel">
          <div className="login-spinner" />
          <p>載入中...</p>
        </div>
      </div>
    );
  }

  // 未登入
  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card glass-panel">
          <div className="login-logo">🎨</div>
          <h1 className="login-title">AI Studio</h1>
          <p className="login-subtitle">風格繪圖 · 靈感發想 · 動畫生成</p>
          <button className="btn-primary login-btn" onClick={login}>
            <svg width="18" height="18" viewBox="0 0 24 24" style={{marginRight: 8}}>
              <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            使用 Google 帳號登入
          </button>
          <p className="login-hint">登入後可跨裝置同步你的創作紀錄</p>
        </div>
      </div>
    );
  }

  // 已登入
  return (
    <div className="app-container">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        theme={theme}
        setTheme={setTheme}
        user={{ displayName, photoURL }}
        onLogout={logout}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
      />
      <button className="sidebar-hamburger" onClick={() => setSidebarOpen(v => !v)} title="選單">
        <span /><span /><span />
      </button>
      <main className="main-content">
        {activeTab === 'style-lab' && <StyleLab navPayload={navPayload} onPayloadConsumed={() => setNavPayload(null)} />}
        {activeTab === 'brainstorm' && <BrainstormHub navigateTo={navigateTo} />}
        {activeTab === 'content-creator' && <ContentCreator navigateTo={navigateTo} />}
        {activeTab === 'animation' && <AnimationStudio />}
        {activeTab === 'history' && <HistoryGallery />}
      </main>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
