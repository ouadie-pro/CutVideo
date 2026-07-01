import { useState } from 'react';
import ProgressBar from './ProgressBar';
import './ReelsGenerator.css';

export default function ReelsGenerator({ url, quality, generator }) {
  const [reelCount, setReelCount] = useState(5);
  const [reelDuration, setReelDuration] = useState(15);

  const { generate, downloadOne, downloadAll, cancel, reset, state, progress, step, error, reels, hasZip, jobId } = generator;

  const isGenerating = state === 'generating';
  const isComplete = state === 'complete';
  const isError = state === 'error';
  const isIdle = state === 'idle';

  const handleGenerate = () => {
    generate(url, reelCount, reelDuration, quality);
  };

  return (
    <div className="reels-generator">
      <div className="reels-header">
        <svg className="reels-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <line x1="7" y1="2" x2="7" y2="22" />
          <line x1="17" y1="2" x2="17" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="2" y1="7" x2="7" y2="7" />
          <line x1="2" y1="17" x2="7" y2="17" />
          <line x1="17" y1="7" x2="22" y2="7" />
          <line x1="17" y1="17" x2="22" y2="17" />
        </svg>
        <h3 className="reels-title">Auto Shorts Generator</h3>
      </div>

      {isIdle && (
        <div className="reels-controls">
          <div className="reels-control-row">
            <div className="reels-control-group">
              <label className="reels-label">Number of reels</label>
              <div className="reels-stepper">
                <button
                  className="reels-stepper-btn"
                  onClick={() => setReelCount(Math.max(1, reelCount - 1))}
                  type="button"
                  disabled={reelCount <= 1}
                >−</button>
                <span className="reels-stepper-value">{reelCount}</span>
                <button
                  className="reels-stepper-btn"
                  onClick={() => setReelCount(Math.min(20, reelCount + 1))}
                  type="button"
                  disabled={reelCount >= 20}
                >+</button>
              </div>
            </div>

            <div className="reels-control-group">
              <label className="reels-label">Duration (seconds)</label>
              <div className="reels-duration-options">
                {[15, 30, 45, 60].map(d => (
                  <button
                    key={d}
                    className={`reels-duration-btn ${reelDuration === d ? 'active' : ''}`}
                    onClick={() => setReelDuration(d)}
                    type="button"
                  >{d}s</button>
                ))}
              </div>
            </div>
          </div>

          <button className="reels-generate-btn" onClick={handleGenerate} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Generate Reels
          </button>
        </div>
      )}

      {isGenerating && (
        <div className="reels-generating">
          <ProgressBar progress={progress} step={step} />
          <button className="cancel-btn" onClick={cancel} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Cancel
          </button>
        </div>
      )}

      {isComplete && reels.length > 0 && (
        <div className="reels-complete">
          <div className="reels-grid">
            {reels.map(reel => (
              <div key={reel.index} className="reel-card">
                <div className="reel-thumbnail">
                  <img
                    src={`/api/reels/thumbnail/${jobId}/${reel.index}`}
                    alt={`Reel ${reel.index}`}
                    loading="lazy"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
                <div className="reel-info">
                  <span className="reel-duration">{reelDuration}s</span>
                  <button
                    className="reel-download-btn"
                    onClick={() => downloadOne(jobId, reel.index)}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasZip && (
            <button className="reels-download-all-btn" onClick={() => downloadAll(jobId)} type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download All (.zip)
            </button>
          )}

          <button className="reset-btn" onClick={reset} type="button">
            Generate new reels
          </button>
        </div>
      )}

      {isError && (
        <div className="reels-controls">
          <p className="reels-error">{error}</p>
          <button className="reels-generate-btn error" onClick={handleGenerate} type="button">
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
