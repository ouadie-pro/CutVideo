import { useState } from 'react';
import ProgressBar from './ProgressBar';
import './ReelsGenerator.css';

function MetricBadge({ label, value, color }) {
  return (
    <div style={{
      background: 'rgba(99, 102, 241, 0.06)',
      borderRadius: '6px',
      padding: '8px 10px',
      border: '1px solid rgba(99, 102, 241, 0.1)'
    }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.85rem',
        fontWeight: 700,
        color: color || 'var(--text-primary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {value}
      </div>
    </div>
  );
}

export default function ReelsGenerator({ url, quality, generator, selectedReference, referenceAnalysis }) {
  const [reelCount, setReelCount] = useState(5);
  const [reelDuration, setReelDuration] = useState(15);
  const [captions, setCaptions] = useState(true);
  const [smartCrop, setSmartCrop] = useState(true);

  const { generate, downloadOne, downloadAll, cancel, reset, state, progress, step, error, errorDetails, reels, hasZip, jobId, referenceInfo } = generator;

  const isGenerating = state === 'generating';
  const isComplete = state === 'complete';
  const isError = state === 'error';
  const isIdle = state === 'idle';

  const handleGenerate = () => {
    generate(url, reelCount, reelDuration, quality, selectedReference, captions, smartCrop, referenceAnalysis);
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
          {selectedReference && referenceAnalysis && (
            <div className="reels-ref-analysis-card" style={{
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: '16px',
              border: '1px solid var(--border)',
              marginBottom: '16px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px'
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="2" />
                    <line x1="7" y1="2" x2="7" y2="22" />
                    <line x1="17" y1="2" x2="17" y2="22" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {selectedReference?.length > 25 ? selectedReference.slice(0, 22) + '...' : selectedReference}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Template Style Profile
                  </div>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px'
              }}>
                <MetricBadge
                  label="Edit Speed"
                  value={referenceAnalysis.editSpeed || 'Unknown'}
                  color={referenceAnalysis.editSpeed?.includes('fast') ? '#22c55e' : '#f59e0b'}
                />
                <MetricBadge
                  label="Motion"
                  value={referenceAnalysis.movementIntensity || 'Unknown'}
                />
                <MetricBadge
                  label="Avg Cut"
                  value={`${(referenceAnalysis.avgShotDuration || 0).toFixed(1)}s`}
                />
                <MetricBadge
                  label="Cuts"
                  value={`${referenceAnalysis.sceneCount || 0} scenes`}
                />
                <MetricBadge
                  label="Duration"
                  value={`${Math.round(referenceAnalysis.totalDuration || 0)}s`}
                />
                <MetricBadge
                  label="Audio"
                  value={`${Math.round((referenceAnalysis.audioEnergy || 0) * 100)}%`}
                />
              </div>

              {referenceAnalysis.shotDurations && referenceAnalysis.shotDurations.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Shot Rhythm
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'flex-end',
                    height: '32px'
                  }}>
                    {referenceAnalysis.shotDurations.slice(0, 8).map((dur, i) => {
                      const maxDur = Math.max(...referenceAnalysis.shotDurations.slice(0, 8));
                      const heightPct = maxDur > 0 ? (dur / maxDur) * 100 : 50;
                      return (
                        <div key={i} style={{
                          flex: 1,
                          height: `${heightPct}%`,
                          background: 'linear-gradient(to top, var(--accent), #7c3aed)',
                          borderRadius: '2px',
                          minHeight: '4px',
                          position: 'relative'
                        }} title={`${dur.toFixed(1)}s`} />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {selectedReference && !referenceAnalysis && (
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
          {(referenceInfo || referenceAnalysis) && (
            <div className="reels-ref-generating-info">
              <span style={{ fontWeight: 600 }}>
                Using template: {(referenceInfo?.filename || selectedReference)}
              </span>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {(referenceInfo?.avgShotDuration || referenceAnalysis?.avgShotDuration) && (
                  <span className="reels-ref-metric">
                    Avg cut: {(referenceInfo?.avgShotDuration || referenceAnalysis?.avgShotDuration).toFixed(1)}s
                  </span>
                )}
                {referenceAnalysis?.editSpeed && (
                  <span className="reels-ref-metric">
                    Pace: {referenceAnalysis.editSpeed}
                  </span>
                )}
                {referenceAnalysis?.movementIntensity && (
                  <span className="reels-ref-metric">
                    Motion: {referenceAnalysis.movementIntensity}
                  </span>
                )}
              </div>
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
          {(referenceAnalysis || referenceInfo) && (
            <div className="reels-ref-result-header">
              <div className="reels-ref-col">
                <span className="reels-ref-label">Reference</span>
                <span className="reels-ref-name">{referenceInfo?.filename || referenceAnalysis?.filename || selectedReference}</span>
                {referenceAnalysis && (
                  <div className="reels-ref-result-metrics">
                    {referenceAnalysis.editSpeed && <span className="reels-ref-metric-tag">{referenceAnalysis.editSpeed}</span>}
                    {referenceAnalysis.movementIntensity && <span className="reels-ref-metric-tag">{referenceAnalysis.movementIntensity}</span>}
                    {referenceAnalysis.avgShotDuration && <span className="reels-ref-metric-tag">{referenceAnalysis.avgShotDuration.toFixed(1)}s avg</span>}
                  </div>
                )}
                {referenceInfo?.avgShotDuration && !referenceAnalysis && (
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
                <span className="reels-ref-label">Generated</span>
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
