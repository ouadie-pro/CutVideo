import { useState, useEffect } from 'react';
import './RecentDownloads.css';

export default function RecentDownloads({ onSelect }) {
  const [history, setHistory] = useState([]);
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const data = JSON.parse(localStorage.getItem('cutvideo_history') || '[]');
      setHistory(data);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const handle = () => {
      try {
        const data = JSON.parse(localStorage.getItem('cutvideo_history') || '[]');
        setHistory(data);
      } catch {}
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, [mounted]);

  if (history.length === 0) return null;

  return (
    <div className="recent-downloads">
      <button
        className="recent-toggle"
        onClick={() => setShow(!show)}
        type="button"
        aria-expanded={show}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>Recent Downloads ({history.length})</span>
        <svg
          className={`chevron ${show ? 'open' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {show && (
        <div className="recent-list">
          {history.map((item, i) => (
            <button
              key={`${item.timestamp}-${i}`}
              className="recent-item"
              onClick={() => onSelect(item)}
              type="button"
              title={`${item.start} - ${item.end} (${item.quality})`}
            >
              <div className="recent-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div className="recent-item-info">
                <p className="recent-item-url" title={item.url}>
                  {item.url.length > 45 ? item.url.slice(0, 45) + '...' : item.url}
                </p>
                <p className="recent-item-meta">
                  {item.start} &rarr; {item.end} &bull; {item.quality}
                </p>
              </div>
              <span className="recent-item-time">
                {formatRelativeTime(item.timestamp)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
