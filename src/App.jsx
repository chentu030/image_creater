import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import StyleLab from './components/StyleLab';
import BrainstormHub from './components/BrainstormHub';
import AnimationStudio from './components/AnimationStudio';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('style-lab');
  // 佈景主題：預設深色（黑色）
  const [theme, setTheme] = useLocalStorage('app_theme', 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} theme={theme} setTheme={setTheme} />
      
      <main className="main-content">
        {activeTab === 'style-lab' && <StyleLab />}
        {activeTab === 'brainstorm' && <BrainstormHub />}
        {activeTab === 'animation' && <AnimationStudio />}
      </main>
    </div>
  );
}

export default App;
