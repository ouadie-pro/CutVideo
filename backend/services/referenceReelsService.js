const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const ffmpegStatic = require('ffmpeg-static');
const { path: ffprobeStaticPath } = require('ffprobe-static');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStaticPath) ffmpeg.setFfprobePath(ffprobeStaticPath);

const REELS_DIR = path.resolve(__dirname, '..', 'reelsSpeed');
const CACHE_FILE = path.join(REELS_DIR, '.reference_cache.json');
const THUMBS_DIR = path.join(REELS_DIR, '.thumbs');

const SUPPORTED_EXT = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];

console.log(`[referenceReels] REELS_DIR = ${REELS_DIR}`);
try {
  const files = fs.readdirSync(REELS_DIR);
  const videoFiles = files.filter(f => SUPPORTED_EXT.includes(path.extname(f).toLowerCase()));
  console.log(`[referenceReels] Files in dir: ${files.length}, Supported videos: ${videoFiles.length}`);
  if (videoFiles.length > 0) console.log(`[referenceReels] Videos: ${videoFiles.join(', ')}`);
} catch (e) {
  console.warn(`[referenceReels] Cannot read dir: ${e.message}`);
}

function getFfmpegPath() {
  if (ffmpegStatic) return ffmpegStatic;
  try { const p = require('ffmpeg-static'); if (p) return p; } catch {}
  return 'ffmpeg';
}

function ensureDirs() {
  if (!fs.existsSync(REELS_DIR)) fs.mkdirSync(REELS_DIR, { recursive: true });
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });
}

function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      const stream = meta.streams.find(s => s.codec_type === 'video');
      const audioStream = meta.streams.find(s => s.codec_type === 'audio');
      resolve({
        duration: meta.format.duration || 0,
        width: stream ? stream.width : 0,
        height: stream ? stream.height : 0,
        dar: stream ? (stream.display_aspect_ratio || (stream.width / stream.height)) : 0,
        bitRate: parseInt(meta.format.bit_rate) || 0,
        hasAudio: !!audioStream,
        audioBitRate: audioStream ? (parseInt(audioStream.bit_rate) || 0) : 0
      });
    });
  });
}

function loadCache() {
  ensureDirs();
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveCache(cache) {
  ensureDirs();
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save reference cache:', e.message);
  }
}

function scanReelsFolder() {
  ensureDirs();
  const files = fs.readdirSync(REELS_DIR);
  const videos = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (SUPPORTED_EXT.includes(ext)) {
      const filePath = path.join(REELS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        videos.push({ filename: file, path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return videos.sort((a, b) => a.filename.localeCompare(b.filename));
}

function detectScenes(videoPath, threshold) {
  return new Promise((resolve) => {
    const timestamps = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vf', `select='gt(scene,${threshold})',showinfo`,
      '-f', 'null', '-'
    ];
    const proc = spawn(ff, args, { windowsHide: true });
    const timer = setTimeout(() => { proc.kill(); resolve([]); }, 5 * 60 * 1000);
    proc.stderr.on('data', (data) => {
      const regex = /pts_time:([\d.]+)/g;
      let m;
      while ((m = regex.exec(data.toString())) !== null) {
        timestamps.push(parseFloat(m[1]));
      }
    });
    proc.on('close', () => { clearTimeout(timer); resolve(timestamps); });
    proc.on('error', () => { clearTimeout(timer); resolve([]); });
  });
}

function detectSilence(videoPath) {
  return new Promise((resolve) => {
    const intervals = [];
    let current = null;
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-af', 'silencedetect=n=-30dB:d=0.5',
      '-f', 'null', '-'
    ];
    const proc = spawn(ff, args, { windowsHide: true });
    const timer = setTimeout(() => { proc.kill(); resolve([]); }, 5 * 60 * 1000);
    proc.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        let m = line.match(/silence_start:\s+([\d.]+)/);
        if (m) current = { start: parseFloat(m[1]) };
        m = line.match(/silence_end:\s+([\d.]+)/);
        if (m && current) { current.end = parseFloat(m[1]); intervals.push(current); current = null; }
      }
    });
    proc.on('close', () => { clearTimeout(timer); resolve(intervals); });
    proc.on('error', () => { clearTimeout(timer); resolve([]); });
  });
}

function getAudioEnergy(videoPath, duration) {
  return new Promise((resolve) => {
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-af', 'astats=metadata=1:reset=1',
      '-f', 'null', '-'
    ];
    const proc = spawn(ff, args, { windowsHide: true });
    const timer = setTimeout(() => { proc.kill(); resolve(0.5); }, 5 * 60 * 1000);
    let rmsSum = 0;
    let count = 0;
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/RMS_level:\s+([-\d.]+)/);
        if (m) { rmsSum += Math.abs(parseFloat(m[1])); count++; }
      }
    });
    proc.on('close', () => {
      clearTimeout(timer);
      if (count === 0) return resolve(0.5);
      const avgRms = rmsSum / count;
      const normalized = Math.min(1, Math.max(0, avgRms / 60));
      resolve(normalized);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(0.5); });
  });
}

function getBrightnessStats(videoPath, duration) {
  return new Promise((resolve) => {
    const sampleRate = Math.max(1, Math.floor(duration / 20));
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vf', `select='not(mod(n,${sampleRate * 30}))',signalstats`,
      '-f', 'null', '-'
    ];
    const proc = spawn(ff, args, { windowsHide: true });
    const timer = setTimeout(() => { proc.kill(); resolve({ brightness: 128, contrast: 40, saturation: 1.0 }); }, 5 * 60 * 1000);
    let yavgSum = 0;
    let yminSum = 0;
    let ymaxSum = 0;
    let count = 0;
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/YMIN=(\d+)\s+YMAX=(\d+)\s+YAVG=(\d+)/);
        if (m) { yminSum += parseInt(m[1]); ymaxSum += parseInt(m[2]); yavgSum += parseInt(m[3]); count++; }
      }
    });
    proc.on('close', () => {
      clearTimeout(timer);
      if (count === 0) return resolve({ brightness: 128, contrast: 40, saturation: 1.0 });
      resolve({
        brightness: Math.round(yavgSum / count),
        contrast: Math.round((ymaxSum - yminSum) / count),
        saturation: 1.0
      });
    });
    proc.on('error', () => { clearTimeout(timer); resolve({ brightness: 128, contrast: 40, saturation: 1.0 }); });
  });
}

function classifyPacing(avgShotDuration) {
  if (avgShotDuration <= 0) return 'unknown';
  if (avgShotDuration < 1.5) return 'very fast';
  if (avgShotDuration < 3) return 'fast';
  if (avgShotDuration < 5) return 'moderate';
  if (avgShotDuration < 8) return 'slow';
  return 'very slow';
}

function classifyMovement(sceneDensity) {
  if (sceneDensity > 0.8) return 'high';
  if (sceneDensity > 0.4) return 'medium';
  return 'low';
}

function getAspectTag(width, height) {
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.02) return 'vertical 9:16';
  if (Math.abs(ratio - 1) < 0.02) return 'square 1:1';
  if (ratio > 1.5) return 'landscape';
  return `custom ${width}:${height}`;
}

function extractThumbnail(outputPath, thumbPath) {
  return new Promise((resolve) => {
    const cmd = ffmpeg(outputPath)
      .seekInput('00:00:01')
      .frames(1)
      .outputOptions('-q:v', '5')
      .output(thumbPath);
    cmd.on('end', () => resolve(fs.existsSync(thumbPath) ? thumbPath : null));
    cmd.on('error', () => resolve(null));
    const timeout = setTimeout(() => { cmd.kill(); resolve(null); }, 60 * 1000);
    cmd.on('end', () => clearTimeout(timeout));
    cmd.on('error', () => clearTimeout(timeout));
    cmd.save(thumbPath);
  });
}

exports.listReferences = function () {
  ensureDirs();
  const cache = loadCache();
  const videos = scanReelsFolder();
  return videos.map(v => {
    const cached = cache[v.filename];
    return {
      filename: v.filename,
      size: v.size,
      mtimeMs: v.mtimeMs,
      hasThumbnail: cached && cached.analysis && cached.analysis.thumbnail ? true : false,
      hasAnalysis: cached && cached.mtimeMs === v.mtimeMs && cached.analysis ? true : false
    };
  });
};

exports.analyzeReference = async function (filename) {
  ensureDirs();
  const videos = scanReelsFolder();
  const video = videos.find(v => v.filename === filename);
  if (!video) throw new Error('Reference reel not found: ' + filename);

  const cache = loadCache();
  const cached = cache[filename];
  if (cached && cached.mtimeMs === video.mtimeMs && cached.analysis) {
    return cached.analysis;
  }

  const meta = await getVideoMetadata(video.path);
  const scenes = await detectScenes(video.path, 0.25);
  const silences = await detectSilence(video.path);
  const audioEnergy = await getAudioEnergy(video.path, meta.duration);
  const brightnessStats = await getBrightnessStats(video.path, meta.duration);
  const thumbPath = path.join(THUMBS_DIR, path.basename(filename, path.extname(filename)) + '.jpg');
  await extractThumbnail(video.path, thumbPath);

  const shotDurations = [];
  let prev = 0;
  for (const ts of scenes) {
    shotDurations.push(ts - prev);
    prev = ts;
  }
  if (meta.duration - prev > 0.1) shotDurations.push(meta.duration - prev);

  const avgShotDuration = shotDurations.length > 0
    ? shotDurations.reduce((a, b) => a + b, 0) / shotDurations.length
    : meta.duration;

  const totalSilence = silences.reduce((a, s) => a + (s.end - s.start), 0);
  const silenceRatio = meta.duration > 0 ? totalSilence / meta.duration : 0;
  const sceneDensity = meta.duration > 0 ? scenes.length / meta.duration : 0;

  const result = {
    filename,
    totalDuration: meta.duration,
    width: meta.width,
    height: meta.height,
    aspectRatio: meta.dar,
    aspectTag: getAspectTag(meta.width, meta.height),
    avgShotDuration,
    shotDurations: shotDurations.slice(0, 50),
    cutsFrequency: sceneDensity,
    editSpeed: classifyPacing(avgShotDuration),
    pacing: classifyPacing(avgShotDuration),
    movementIntensity: classifyMovement(sceneDensity),
    sceneCount: scenes.length,
    silenceRatio,
    audioEnergy,
    brightness: brightnessStats.brightness,
    contrast: brightnessStats.contrast,
    saturation: brightnessStats.saturation,
    hasAudio: meta.hasAudio,
    thumbnail: fs.existsSync(thumbPath) ? thumbPath : null,
    analyzedAt: Date.now()
  };

  cache[filename] = { mtimeMs: video.mtimeMs, analysis: result };
  saveCache(cache);

  return result;
};

exports.getThumbnailPath = function (filename) {
  ensureDirs();
  const thumbPath = path.join(THUMBS_DIR, path.basename(filename, path.extname(filename)) + '.jpg');
  if (fs.existsSync(thumbPath)) return thumbPath;
  const videos = scanReelsFolder();
  const video = videos.find(v => v.filename === filename);
  return video ? video.path : null;
};

exports.getVideoPath = function (filename) {
  const videos = scanReelsFolder();
  const video = videos.find(v => v.filename === filename);
  return video ? video.path : null;
};

exports.getReferenceMetrics = function (analysis) {
  return {
    avgShotDuration: analysis.avgShotDuration || 2,
    cutsFrequency: analysis.cutsFrequency || 0.3,
    audioEnergy: analysis.audioEnergy || 0.5,
    silenceRatio: analysis.silenceRatio || 0,
    movementIntensity: analysis.movementIntensity || 'medium',
    editSpeed: analysis.editSpeed || 'moderate',
    brightness: analysis.brightness || 128,
    contrast: analysis.contrast || 40
  };
};
