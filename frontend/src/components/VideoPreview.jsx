import { useState } from 'react';
import './VideoPreview.css';

export default function VideoPreview({ info }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = [
      `Title: ${info.title}`,
      `Duration: ${formatDuration(info.durationSeconds)}`,
      `Author: ${info.author}`,
      `URL: https://youtu.be/${info.videoId}`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="video-preview">
      <div className="preview-thumbnail">
        <img
          src={info.thumbnail}
          alt={info.title}
          loading="lazy"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
        <div className="preview-duration-badge">
          {formatDuration(info.durationSeconds)}
        </div>
      </div>

      <div className="preview-body">
        <div className="preview-header">
          <h2 className="preview-title" title={info.title}>
            {info.title}
          </h2>
          <button
            className="copy-btn"
            onClick={handleCopy}
            title="Copy video information"
            type="button"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>

        <p className="preview-author">{info.author}</p>

        {info.videoId && (
          <div className="preview-player">
            <iframe
              src={`https://www.youtube.com/embed/${info.videoId}?autoplay=0&rel=0`}
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}

        <div className="preview-meta">
          <div className="meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{formatDuration(info.durationSeconds)}</span>
          </div>
          {info.availableQualities && (
            <div className="meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <span>{info.availableQualities.length} quality options</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
