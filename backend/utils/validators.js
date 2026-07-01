function validateYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;
  return pattern.test(trimmed);
}

function validateTimeRange(start, end, durationSeconds) {
  const startSec = timeToSeconds(start);
  const endSec = timeToSeconds(end);

  if (isNaN(startSec) || isNaN(endSec)) {
    return { valid: false, error: 'Invalid time format. Use HH:MM:SS' };
  }

  if (startSec < 0) {
    return { valid: false, error: 'Start time cannot be negative' };
  }

  if (startSec >= endSec) {
    return { valid: false, error: 'Start time must be before end time' };
  }

  if (endSec > durationSeconds) {
    return { valid: false, error: 'End time exceeds video duration' };
  }

  return { valid: true };
}

function validateQuality(quality, availableQualities) {
  if (!quality) {
    return { valid: false, error: 'Quality is required' };
  }
  if (!availableQualities.includes(quality)) {
    return { valid: false, error: `Quality ${quality} not available` };
  }
  return { valid: true };
}

function timeToSeconds(time) {
  if (!time || typeof time !== 'string') return NaN;
  const parts = time.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || NaN;
}

module.exports = { validateYouTubeUrl, validateTimeRange, validateQuality, timeToSeconds };
