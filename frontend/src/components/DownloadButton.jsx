import ProgressBar from './ProgressBar';
import './DownloadButton.css';

export default function DownloadButton({
  state,
  progress,
  step,
  onDownload,
  onCancel,
  onReset,
  success
}) {
  const isProcessing = state === 'processing';
  const isComplete = state === 'complete';
  const isError = state === 'error';

  if (isComplete) {
    return (
      <div className="download-complete">
        <div className="complete-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <div className="complete-text">
          <p className="complete-title">Download complete!</p>
          {success && <p className="complete-filename" title={success.filename}>{success.filename}</p>}
        </div>
        <button className="reset-btn" onClick={onReset} type="button">
          Cut another video
        </button>
      </div>
    );
  }

  return (
    <div className="download-button-section">
      {isProcessing ? (
        <div className="processing-section">
          <ProgressBar progress={progress} step={step} />
          <button className="cancel-btn" onClick={onCancel} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className={`download-btn ${isError ? 'error' : ''}`}
          onClick={onDownload}
          disabled={isProcessing}
          type="button"
        >
          {isError ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Try Again
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Clip
            </>
          )}
        </button>
      )}
    </div>
  );
}
