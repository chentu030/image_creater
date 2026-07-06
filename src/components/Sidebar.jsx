import React from 'react';
import { Palette, Lightbulb, Film, Settings, Moon, Sun } from 'lucide-react';
import './Sidebar.css';

export default function Sidebar({ activeTab, setActiveTab, theme, setTheme }) {
  const navItems = [
    { id: 'style-lab', label: '風格繪圖區', icon: <Palette size={20} /> },
    { id: 'brainstorm', label: '靈感發想區', icon: <Lightbulb size={20} /> },
    { id: 'animation', label: '動畫生成區', icon: <Film size={20} /> },
  ];

  const isDark = theme === 'dark';

  return (
    <aside className="sidebar">
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
      </div>
    </aside>
  );
}
