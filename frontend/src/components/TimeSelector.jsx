import { useCallback } from 'react';
import './TimeSelector.css';

export default function TimeSelector({ duration, startTime, endTime, onChange }) {
  const maxTime = typeof duration === 'number' && duration > 0 ? duration : 3600;

  const toSeconds = (time) => {
    const parts = time.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  };

  const toTimeString = (totalSecs) => {
    const clamped = Math.max(0, Math.min(Math.round(totalSecs), maxTime));
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const startSec = toSeconds(startTime);
  const endSec = toSeconds(endTime);

  const handleStartSlider = useCallback((e) => {
    const val = Number(e.target.value);
    const newEnd = Math.max(val + 1, endSec);
    onChange(toTimeString(val), toTimeString(newEnd));
  }, [endSec, onChange]);

  const handleEndSlider = useCallback((e) => {
    const val = Number(e.target.value);
    const newStart = Math.min(val - 1, startSec);
    onChange(toTimeString(newStart), toTimeString(val));
  }, [startSec, onChange]);

  const handleInputChange = (type, unit, value) => {
    const source = type === 'start' ? startTime : endTime;
    const parts = source.split(':').map(Number);
    const idx = unit === 'hours' ? 0 : unit === 'minutes' ? 1 : 2;
    const maxVal = unit === 'hours' ? 23 : 59;
    parts[idx] = Math.max(0, Math.min(isNaN(value) ? 0 : Number(value), maxVal));
    const newTime = `${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}:${String(parts[2]).padStart(2, '0')}`;
    const newSec = toSeconds(newTime);

    if (type === 'start') {
      const clamped = Math.min(newSec, endSec - 1);
      onChange(toTimeString(clamped), endTime);
    } else {
      const clamped = Math.max(newSec, startSec + 1);
      onChange(startTime, toTimeString(clamped));
    }
  };

  const startPct = maxTime > 0 ? (startSec / maxTime) * 100 : 0;
  const endPct = maxTime > 0 ? (endSec / maxTime) * 100 : 100;
  const rangePct = endPct - startPct;
  const clipDuration = endSec - startSec;

  return (
    <div className="time-selector">
      <h3 className="time-selector-title">Select Time Range</h3>

      <div className="timeline-container">
        <div className="timeline-track">
          <div
            className="timeline-range"
            style={{ left: `${startPct}%`, width: `${rangePct}%` }}
          />
          <input
            type="range"
            className="timeline-slider timeline-start"
            min={0}
            max={maxTime}
            step={1}
            value={startSec}
            onChange={handleStartSlider}
            style={{ zIndex: startSec >= endSec - 1 ? 3 : 2 }}
            aria-label="Start time"
          />
          <input
            type="range"
            className="timeline-slider timeline-end"
            min={0}
            max={maxTime}
            step={1}
            value={endSec}
            onChange={handleEndSlider}
            aria-label="End time"
          />
        </div>
        <div className="timeline-labels">
          <span>0:00</span>
          <span>{toTimeString(maxTime)}</span>
        </div>
      </div>

      <div className="time-inputs">
        <div className="time-input-group">
          <label className="time-label">Start</label>
          <div className="time-fields">
            {['hours', 'minutes', 'seconds'].map((unit) => {
              const parts = startTime.split(':').map(Number);
              const idx = unit === 'hours' ? 0 : unit === 'minutes' ? 1 : 2;
              return (
                <div key={`s-${unit}`} className="time-field">
                  <input
                    type="number"
                    min={0}
                    max={unit === 'hours' ? 23 : 59}
                    value={parts[idx]}
                    onChange={(e) => handleInputChange('start', unit, e.target.value)}
                    aria-label={`Start ${unit}`}
                  />
                  <span className="time-unit">
                    {unit === 'hours' ? 'h' : unit === 'minutes' ? 'm' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="time-separator">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>

        <div className="time-input-group">
          <label className="time-label">End</label>
          <div className="time-fields">
            {['hours', 'minutes', 'seconds'].map((unit) => {
              const parts = endTime.split(':').map(Number);
              const idx = unit === 'hours' ? 0 : unit === 'minutes' ? 1 : 2;
              return (
                <div key={`e-${unit}`} className="time-field">
                  <input
                    type="number"
                    min={0}
                    max={unit === 'hours' ? 23 : 59}
                    value={parts[idx]}
                    onChange={(e) => handleInputChange('end', unit, e.target.value)}
                    aria-label={`End ${unit}`}
                  />
                  <span className="time-unit">
                    {unit === 'hours' ? 'h' : unit === 'minutes' ? 'm' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="clip-duration-preview">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>Clip duration: {formatDuration(clipDuration)}</span>
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
