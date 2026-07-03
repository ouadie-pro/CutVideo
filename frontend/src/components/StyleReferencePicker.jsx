import { useState, useEffect } from 'react';
import { getStyleSamples, getStyleThumbnailUrl } from '../services/api';
import './StyleReferencePicker.css';

export default function StyleReferencePicker({ selectedId, onSelect }) {
  const [samples, setSamples] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetch() {
      try {
        const data = await getStyleSamples();
        if (mounted) setSamples(data.samples || []);
      } catch (err) {
        console.error('Failed to load style samples:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetch();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="style-picker-section">
      <div className="style-picker-header">
        <svg className="style-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="style-picker-label">Style Reference</span>
        {!loading && samples.length > 0 && (
          <span className="style-picker-count">{samples.length} sample{samples.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {loading ? (
        <div className="style-picker-loading">Loading style samples...</div>
      ) : (
        <div className="style-picker-row">
          <div
            className={`style-picker-card ${!selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(null)}
            title="No style reference (default behavior)"
          >
            <div className="style-picker-none-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <span className="style-picker-card-label">None (default)</span>
          </div>

          {samples.map(sample => (
            <div
              key={sample.id}
              className={`style-picker-card ${selectedId === sample.id ? 'selected' : ''}`}
              onClick={() => onSelect(sample.id)}
              title={sample.filename}
            >
              <div className="style-picker-thumb-container">
                <img
                  className="style-picker-thumb"
                  src={getStyleThumbnailUrl(sample.id)}
                  alt={sample.filename}
                  loading="lazy"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                {sample.hasProfile && (
                  <span className="style-picker-analyzed-badge">analyzed</span>
                )}
              </div>
              <span className="style-picker-card-label">
                {sample.filename.length > 14
                  ? sample.filename.slice(0, 11) + '...'
                  : sample.filename.replace(/\.[^/.]+$/, '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
