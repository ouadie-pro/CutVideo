import { useState, useRef, useEffect } from 'react';
import './ReferenceReels.css';

export default function ReferenceReels({
  reels,
  selected,
  onSelect,
  loading,
  analyzing,
  getMetricsSummary,
  analysis
}) {
  const [previewFile, setPreviewFile] = useState(null);
  const [previewLoaded, setPreviewLoaded] = useState({});
  const previewRef = useRef(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        previewRef.current.pause();
        previewRef.current.src = '';
      }
    };
  }, []);

  const handleMouseEnter = (filename) => {
    setPreviewFile(filename);
  };

  const handleMouseLeave = () => {
    setPreviewFile(null);
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current.currentTime = 0;
    }
  };

  const handlePlayClick = (e, filename) => {
    e.stopPropagation();
    if (previewFile === filename && previewRef.current) {
      if (previewRef.current.paused) {
        previewRef.current.play();
      } else {
        previewRef.current.pause();
      }
    }
  };

  if (loading) {
    return (
      <div className="ref-reels-section">
        <div className="ref-reels-header">
          <h3>Reference Reels</h3>
        </div>
        <div className="ref-reels-loading">Loading reference reels...</div>
      </div>
    );
  }

  if (reels.length === 0) {
    return null;
  }

  return (
    <div className="ref-reels-section">
      <div className="ref-reels-header">
        <svg className="ref-reels-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <line x1="7" y1="2" x2="7" y2="22" />
          <line x1="17" y1="2" x2="17" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
        </svg>
        <h3>Reference Reels</h3>
        <span className="ref-reels-count">{reels.length} reel{reels.length !== 1 ? 's' : ''}</span>
        {selected && (
          <span className="ref-reels-selected-badge">1 selected</span>
        )}
      </div>

      <p className="ref-reels-hint">
        Select a reference reel to use its editing style as template
      </p>

      <div className="ref-reels-gallery">
        {reels.map(reel => {
          const isSelected = selected === reel.filename;
          return (
            <div
              key={reel.filename}
              className={`ref-reel-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(reel.filename)}
              onMouseEnter={() => handleMouseEnter(reel.filename)}
              onMouseLeave={handleMouseLeave}
            >
              <div className="ref-reel-thumb-container">
                {previewFile === reel.filename ? (
                  <video
                    ref={previewRef}
                    className="ref-reel-video-preview"
                    src={`/api/reference-reels/video/${encodeURIComponent(reel.filename)}`}
                    muted
                    autoPlay
                    loop
                    playsInline
                    onLoadedData={() => setPreviewLoaded(prev => ({ ...prev, [reel.filename]: true }))}
                    onError={() => setPreviewLoaded(prev => ({ ...prev, [reel.filename]: false }))}
                  />
                ) : (
                  <img
                    className="ref-reel-thumb"
                    src={`/api/reference-reels/thumbnail/${encodeURIComponent(reel.filename)}`}
                    alt={reel.filename}
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                {previewFile === reel.filename && (
                  <button
                    className="ref-reel-play-btn"
                    onClick={(e) => handlePlayClick(e, reel.filename)}
                    type="button"
                    aria-label="Play"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="8,5 19,12 8,19" />
                    </svg>
                  </button>
                )}
                {isSelected && (
                  <div className="ref-reel-selected-overlay">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="8,12 11,15 16,9" stroke="white" strokeWidth="2" fill="none" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="ref-reel-meta">
                <span className="ref-reel-filename" title={reel.filename}>
                  {reel.filename.length > 18
                    ? reel.filename.slice(0, 15) + '...'
                    : reel.filename}
                </span>
                {reel.hasAnalysis && (
                  <span className="ref-reel-analyzed-badge">analyzed</span>
                )}
              </div>
              {isSelected && analyzing && (
                <div className="ref-reel-analyzing">
                  <div className="ref-reel-analyzing-spinner" />
                  <span>Analyzing...</span>
                </div>
              )}
              {isSelected && analysis && !analyzing && (
                <div className="ref-reel-analysis-summary">
                  {getMetricsSummary(analysis)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && analysis && !analyzing && (
        <div className="ref-reel-details">
          <div className="ref-reel-detail-row">
            <span className="detail-label">Shot rhythm</span>
            <span className="detail-value">
              {analysis.shotDurations && analysis.shotDurations.length > 0
                ? analysis.shotDurations.slice(0, 6).map(d => d.toFixed(1) + 's').join(' · ')
                : 'N/A'}
            </span>
          </div>
          <div className="ref-reel-detail-row">
            <span className="detail-label">Brightness / Contrast</span>
            <span className="detail-value">{analysis.brightness} / {analysis.contrast}</span>
          </div>
          <div className="ref-reel-detail-row">
            <span className="detail-label">Audio energy</span>
            <span className="detail-value">{analysis.audioEnergy ? Math.round(analysis.audioEnergy * 100) + '%' : 'N/A'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
