import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { loadGenerationHistory, isFirebaseConfigured } from '../services/firebase';
import { Download, Loader2, Image as ImageIcon, Film, Search, X, Calendar, Wand2 } from 'lucide-react';
import './HistoryGallery.css';

export default function HistoryGallery() {
  const { uid } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'image' | 'video'
  const [searchTerm, setSearchTerm] = useState('');
  const [lightboxItem, setLightboxItem] = useState(null);

  useEffect(() => {
    if (uid && isFirebaseConfigured()) {
      setLoading(true);
      loadGenerationHistory(uid, 200)
        .then(data => setRecords(data))
        .catch(err => console.warn('載入歷史失敗:', err))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [uid]);

  // 篩選 + 搜尋
  const filtered = records.filter(r => {
    if (filter !== 'all' && r.type !== filter) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      return (r.prompt || '').toLowerCase().includes(term) ||
             (r.model || '').toLowerCase().includes(term);
    }
    return true;
  });

  const handleDownload = async (url, type) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `ai-${type}-${Date.now()}.${type === 'video' ? 'mp4' : 'png'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      a.remove();
    } catch {
      window.open(url, '_blank');
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return d.toLocaleDateString('zh-TW', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="workspace animate-fade-in">
      <div className="workspace-header">
        <div>
          <h1 className="title">📂 生成歷史</h1>
          <p className="subtitle">瀏覽你過去生成的所有圖片與影片</p>
        </div>
      </div>

      {/* 篩選列 */}
      <div className="history-toolbar">
        <div className="history-filters">
          <button
            className={`history-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >全部 ({records.length})</button>
          <button
            className={`history-filter-btn ${filter === 'image' ? 'active' : ''}`}
            onClick={() => setFilter('image')}
          ><ImageIcon size={14}/> 圖片</button>
          <button
            className={`history-filter-btn ${filter === 'video' ? 'active' : ''}`}
            onClick={() => setFilter('video')}
          ><Film size={14}/> 影片</button>
        </div>
        <div className="history-search">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="搜尋 prompt 或模型..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="glass-input history-search-input"
          />
          {searchTerm && (
            <button className="search-clear" onClick={() => setSearchTerm('')}>
              <X size={14}/>
            </button>
          )}
        </div>
      </div>

      {/* 內容 */}
      {loading ? (
        <div className="history-loading">
          <Loader2 size={32} className="spin" />
          <p>載入歷史紀錄中...</p>
        </div>
      ) : !uid || !isFirebaseConfigured() ? (
        <div className="history-empty">
          <p>請先登入 Google 帳號以查看生成歷史</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="history-empty">
          <Wand2 size={48} />
          <p>{records.length === 0 ? '尚無生成紀錄' : '沒有符合篩選條件的紀錄'}</p>
          <span>開始在風格繪圖區或動畫生成區創作吧！</span>
        </div>
      ) : (
        <div className="history-grid">
          {filtered.map((record) => (
            <div key={record.id} className="history-card glass-panel" onClick={() => setLightboxItem(record)}>
              <div className="history-card-media">
                {record.type === 'video' ? (
                  <video src={record.outputUrl} muted loop preload="metadata" className="history-thumb" />
                ) : (
                  <img src={record.thumbnailUrl || record.outputUrl} alt={record.prompt} className="history-thumb" loading="lazy" />
                )}
                <div className="history-card-type-badge">
                  {record.type === 'video' ? <Film size={12}/> : <ImageIcon size={12}/>}
                  {record.type === 'video' ? '影片' : '圖片'}
                </div>
              </div>
              <div className="history-card-info">
                <p className="history-card-prompt" title={record.prompt}>{record.prompt || '(無提示詞)'}</p>
                <div className="history-card-meta">
                  <span className="history-card-model">{record.model || '未知模型'}</span>
                  <span className="history-card-date"><Calendar size={10}/> {formatDate(record.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxItem && (
        <div className="history-lightbox" onClick={() => setLightboxItem(null)}>
          <div className="history-lightbox-content" onClick={e => e.stopPropagation()}>
            <button className="history-lightbox-close" onClick={() => setLightboxItem(null)}><X size={20}/></button>
            <div className="history-lightbox-media">
              {lightboxItem.type === 'video' ? (
                <video src={lightboxItem.outputUrl} controls autoPlay loop className="history-lightbox-img" />
              ) : (
                <img src={lightboxItem.outputUrl} alt={lightboxItem.prompt} className="history-lightbox-img" />
              )}
            </div>
            <div className="history-lightbox-info">
              <p className="history-lightbox-prompt">{lightboxItem.prompt || '(無提示詞)'}</p>
              <div className="history-lightbox-meta">
                <span>🤖 {lightboxItem.model || '未知'}</span>
                <span>📐 {lightboxItem.aspectRatio || '-'}</span>
                <span>📅 {formatDate(lightboxItem.timestamp)}</span>
              </div>
              <button
                className="btn-primary history-download-btn"
                onClick={() => handleDownload(lightboxItem.outputUrl, lightboxItem.type)}
              >
                <Download size={16}/> 下載
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
