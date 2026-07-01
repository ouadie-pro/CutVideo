const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');

function getFfmpegPath() {
  try {
    const p = require('ffmpeg-static');
    if (p) return p;
  } catch {}
  return 'ffmpeg';
}

function getInputDimensions(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const stream = meta.streams.find(s => s.codec_type === 'video');
      if (!stream) return reject(new Error('No video stream'));
      resolve({ width: stream.width, height: stream.height, dar: stream.display_aspect_ratio || (stream.width / stream.height) });
    });
  });
}

function getDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration);
    });
  });
}

function detectScenes(videoPath) {
  return new Promise((resolve) => {
    const timestamps = [];
    const ff = getFfmpegPath();
    const proc = spawn(ff, [
      '-i', videoPath,
      '-vf', "select='gt(scene,0.3)',showinfo",
      '-f', 'null', '-'
    ], { windowsHide: true });

    proc.stderr.on('data', (data) => {
      const regex = /pts_time:([\d.]+)/g;
      let m;
      while ((m = regex.exec(data.toString())) !== null) {
        timestamps.push(parseFloat(m[1]));
      }
    });

    proc.on('close', () => resolve(timestamps));
    proc.on('error', () => resolve([]));
  });
}

function detectSilence(videoPath) {
  return new Promise((resolve) => {
    const intervals = [];
    let current = null;
    const ff = getFfmpegPath();
    const proc = spawn(ff, [
      '-i', videoPath,
      '-af', 'silencedetect=n=-30dB:d=0.5',
      '-f', 'null', '-'
    ], { windowsHide: true });

    proc.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        let m = line.match(/silence_start:\s+([\d.]+)/);
        if (m) current = { start: parseFloat(m[1]) };
        m = line.match(/silence_end:\s+([\d.]+)/);
        if (m && current) {
          current.end = parseFloat(m[1]);
          intervals.push(current);
          current = null;
        }
      }
    });

    proc.on('close', () => resolve(intervals));
    proc.on('error', () => resolve([]));
  });
}

function scoreHighlights(totalDuration, scenes, silences, count, reelDuration) {
  const candidates = [];
  const step = Math.max(1, Math.floor(totalDuration / 150));

  const introEnd = totalDuration * 0.08;
  const creditsStart = totalDuration * 0.92;

  for (let start = introEnd; start + reelDuration <= creditsStart; start += step) {
    const end = start + reelDuration;

    let score = 0;
    const windowScenes = scenes.filter(s => s >= start && s <= end);
    score += windowScenes.length * 8;

    const silDur = silences
      .filter(s => s.start < end && s.end > start)
      .reduce((a, s) => a + Math.min(s.end, end) - Math.max(s.start, start), 0);
    score -= (silDur / reelDuration) * 35;

    const mid = (start + end / 2) / totalDuration;
    score += (1 - Math.abs(mid - 0.5) * 2) * 15;

    if (windowScenes.length >= 2) score += 5;
    if (windowScenes.length >= 4) score += 5;

    candidates.push({ start: Math.max(0, start), end: Math.min(totalDuration, end), score });
  }

  candidates.sort((a, b) => b.score - a.score);

  const selected = [];
  const minGap = reelDuration * 0.6;
  for (const c of candidates) {
    if (selected.length >= count) break;
    if (!selected.some(s => Math.abs(s.start - c.start) < minGap)) {
      selected.push(c);
    }
  }

  selected.sort((a, b) => a.start - b.start);
  return selected;
}

function createVerticalClip(inputPath, outputPath, startTime, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-vf', "scale='if(gt(dar,9/16),-2:1920,1080:-2)',crop=1080:1920",
        '-preset', 'fast',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart'
      ]);

    if (onProgress) {
      cmd.on('stderr', (line) => {
        const m = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (m) {
          const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
          onProgress(Math.min(100, Math.round((secs / duration) * 100)));
        }
      });
    }

    cmd.on('end', () => resolve(outputPath));
    cmd.on('error', (err) => reject(new Error(`Reel encode error: ${err.message}`)));

    const timeout = setTimeout(() => { cmd.kill(); reject(new Error('Reel encode timeout after 5 minutes')); }, 5 * 60 * 1000);
    cmd.on('end', () => clearTimeout(timeout));
    cmd.on('error', () => clearTimeout(timeout));

    cmd.save(outputPath);
  });
}

function extractThumbnail(videoPath, outputPath) {
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .seekInput('00:00:01')
      .frames(1)
      .outputOptions('-q:v', '5')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', () => resolve(null))
      .save(outputPath);
  });
}

async function generateReels(options) {
  const { videoPath, outputDir, count, reelDuration, onProgress } = options;

  onProgress(0, 'analyzing video');

  const [totalDuration, scenes, silences] = await Promise.all([
    getDuration(videoPath),
    detectScenes(videoPath),
    detectSilence(videoPath)
  ]);

  const highlights = scoreHighlights(totalDuration, scenes, silences, count, reelDuration);

  if (highlights.length === 0) {
    const mid = totalDuration / 2;
    highlights.push({ start: Math.max(0, mid - reelDuration / 2), end: Math.min(totalDuration, mid + reelDuration / 2), score: 0 });
  }

  const reels = [];
  for (let i = 0; i < highlights.length; i++) {
    const idx = i + 1;
    const reelPath = path.join(outputDir, `reel_${idx}.mp4`);
    const thumbPath = path.join(outputDir, `thumb_${idx}.jpg`);

    onProgress(Math.round(((i) / count) * 100), `creating reel ${idx}/${count}`);

    const h = highlights[i];
    await createVerticalClip(videoPath, reelPath, h.start, reelDuration);

    await extractThumbnail(reelPath, thumbPath);

    reels.push({
      index: idx,
      path: reelPath,
      thumbnail: thumbPath,
      filename: `reel_${idx}.mp4`,
      startTime: h.start
    });
  }

  onProgress(100, 'finalizing');
  return reels;
}

function packageAsZip(reels, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outputPath));
    archive.on('error', reject);

    archive.pipe(output);

    for (const reel of reels) {
      archive.file(reel.path, { name: reel.filename });
    }

    archive.finalize();
  });
}

module.exports = { generateReels, packageAsZip };
