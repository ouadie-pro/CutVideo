import './ProgressBar.css';

export default function ProgressBar({ progress, step }) {
  const clamped = Math.min(Math.max(progress, 0), 100);

  return (
    <div className="progress-bar-container">
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${clamped}%` }}
        >
          <div className="progress-bar-shine" />
        </div>
      </div>
      <div className="progress-info">
        <span className="progress-step">{step || 'Processing...'}</span>
        <span className="progress-percentage">{Math.round(clamped)}%</span>
      </div>
    </div>
  );
}
