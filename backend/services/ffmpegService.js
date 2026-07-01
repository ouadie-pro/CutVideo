const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

function trimVideo(inputPath, outputPath, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    const duration = timeToSeconds(end) - timeToSeconds(start);

    if (duration <= 0) {
      return reject(new Error('Invalid time range: end must be after start'));
    }

    const ffmpegCommand = ffmpeg(inputPath)
      .seekInput(start)
      .duration(duration)
      .outputOptions('-c', 'copy')
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg error: ${err.message}`));
      });

    if (onProgress) {
      ffmpegCommand.on('stderr', (stderrLine) => {
        const timeMatch = stderrLine.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const centiseconds = parseInt(timeMatch[4], 10);
          const processedTime = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
          const progress = Math.min(100, Math.round((processedTime / duration) * 100));
          onProgress(progress);
        }
      });
    }

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      ffmpegCommand.kill();
      reject(new Error('FFmpeg trim timeout after 5 minutes'));
    }, 5 * 60 * 1000);

    ffmpegCommand.on('end', () => clearTimeout(timeout));
    ffmpegCommand.on('error', () => clearTimeout(timeout));

    ffmpegCommand.run();
  });
}

function timeToSeconds(time) {
  if (!time || typeof time !== 'string') return 0;
  const parts = time.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

function secondsToTime(seconds) {
  if (!seconds || typeof seconds !== 'number') return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

module.exports = { trimVideo, timeToSeconds, secondsToTime };
