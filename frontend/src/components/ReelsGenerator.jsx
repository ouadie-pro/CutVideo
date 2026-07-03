import { useState } from 'react';
import ProgressBar from './ProgressBar';
import StyleReferencePicker from './StyleReferencePicker';
import './ReelsGenerator.css';

export default function ReelsGenerator({ url, quality, generator, selectedReference, referenceReels }) {
  const [reelCount, setReelCount] = useState(5);
  const [reelDuration, setReelDuration] = useState(15);
  const [captions, setCaptions] = useState(true);
  const [smartCrop, setSmartCrop] = useState(true);
  const [styleReferenceId, setStyleReferenceId] = useState(null);

  const { generate, downloadOne, downloadAll, cancel, reset, state, progress, step, error, errorDetails, reels, hasZip, jobId, referenceInfo } = generator;

  const isGenerating = state === 'generating';
  const isComplete = state === 'complete';
  const isError = state === 'error';
  const isIdle = state === 'idle';

  const handleGenerate = () => {
    generate(url, reelCount, reelDuration, quality, selectedReference, captions, smartCrop, styleReferenceId);
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
        {selectedReference && (
          <span className="reels-ref-badge">
            Template: {selectedReference.length > 20 ? selectedReference.slice(0, 17) + '...' : selectedReference}
          </span>
        )}
      </div>

      {isIdle && (
        <div className="reels-controls">
          <StyleReferencePicker
            selectedId={styleReferenceId}
            onSelect={setStyleReferenceId}
          />
          {selectedReference && (
            <div className="reels-ref-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Generating reels that match the editing style of selected reference
            </div>
          )}
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

          {!selectedReference && (
            <div className="reels-edit-toggles">
              <label className="reels-toggle">
                <input
                  type="checkbox"
                  checked={captions}
                  onChange={(e) => setCaptions(e.target.checked)}
                />
                <span className="reels-toggle-checkmark"></span>
                <span className="reels-toggle-label">Auto captions</span>
              </label>
              <label className="reels-toggle">
                <input
                  type="checkbox"
                  checked={smartCrop}
                  onChange={(e) => setSmartCrop(e.target.checked)}
                />
                <span className="reels-toggle-checkmark"></span>
                <span className="reels-toggle-label">Smart crop (face tracking)</span>
              </label>
            </div>
          )}

          <button className="reels-generate-btn" onClick={handleGenerate} type="button" disabled={reelCount < 1}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            {selectedReference ? 'Generate Reels from Template' : 'Generate Reels'}
          </button>
        </div>
      )}

      {isGenerating && (
        <div className="reels-generating">
          {referenceInfo && (
            <div className="reels-ref-generating-info">
              Using template: {referenceInfo.filename}
              {referenceInfo.avgShotDuration && (
                <span className="reels-ref-metric">Avg cut: {referenceInfo.avgShotDuration.toFixed(1)}s</span>
              )}
            </div>
          )}
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
          {referenceInfo && (
            <div className="reels-ref-result-header">
              <div className="reels-ref-col">
                <span className="reels-ref-label">Reference Reel</span>
                <span className="reels-ref-name">{referenceInfo.filename}</span>
                {referenceInfo.avgShotDuration && (
                  <span className="reels-ref-metric">avg cut {referenceInfo.avgShotDuration.toFixed(1)}s</span>
                )}
              </div>
              <div className="reels-ref-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
              <div className="reels-ref-col">
                <span className="reels-ref-label">Generated Reels</span>
                <span className="reels-ref-value">{reels.length} reel{reels.length !== 1 ? 's' : ''}</span>
                <span className="reels-ref-metric">styled after template</span>
              </div>
            </div>
          )}
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
                  {reel.title && <span className="reel-title">{reel.title}</span>}
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
          {errorDetails && (
            <div className="reels-error-details">
              {errorDetails.stage && <p>Stage: {errorDetails.stage}</p>}
              {errorDetails.message && <p>Details: {errorDetails.message}</p>}
            </div>
          )}
          <button className="reels-generate-btn error" onClick={handleGenerate} type="button">
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
