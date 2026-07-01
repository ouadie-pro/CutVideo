import { useState, useCallback, useRef } from 'react';
import './UrlInput.css';

export default function UrlInput({ onAnalyze, loading, url, setUrl }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) {
      onAnalyze(trimmed);
    }
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      setUrl(text);
    }
  }, [setUrl]);

  return (
    <div className="url-input-section">
      <form
        className={`url-input-container ${dragging ? 'dragging' : ''}`}
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="url-input-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="url-input"
          placeholder="Paste YouTube URL here or drag & drop a link..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          autoComplete="off"
          autoFocus
        />
        <button
          type="submit"
          className="analyze-btn"
          disabled={loading || !url.trim()}
        >
          {loading ? (
            <span className="btn-loading">
              <span className="spinner" />
              Analyzing
            </span>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Analyze
            </>
          )}
        </button>
      </form>
      {dragging && (
        <div className="drop-overlay">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p>Drop YouTube URL here</p>
        </div>
      )}
    </div>
  );
}
