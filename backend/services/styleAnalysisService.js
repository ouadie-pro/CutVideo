const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const reelsService = require('./reelsService');

async function analyzeStyle(videoPath) {
  try {
    if (!videoPath || !fs.existsSync(videoPath)) {
      console.warn('styleAnalysisService: video not found');
      return fallbackProfile();
    }

    const durationSec = await reelsService.getDuration(videoPath);
    const dims = await reelsService.getInputDimensions(videoPath);

    const aspectRatio = formatAspectRatio(dims.width, dims.height);

    const sceneTimestamps = await reelsService.detectScenes(videoPath);

    const { avgShotDurationSec, cutsPerMinute } = computePacing(sceneTimestamps, durationSec);

    const motionIntensity = computeMotionIntensity(sceneTimestamps, durationSec);

    const captions = await detectCaptions(videoPath);

    return {
      durationSec,
      avgShotDurationSec,
      cutsPerMinute,
      aspectRatio,
      motionIntensity,
      captions
    };
  } catch (err) {
    console.warn(`styleAnalysisService: analysis error: ${err.message}`);
    return fallbackProfile();
  }
}

function fallbackProfile() {
  return {
    durationSec: null,
    avgShotDurationSec: null,
    cutsPerMinute: null,
    aspectRatio: null,
    motionIntensity: null,
    captions: { present: false, position: null }
  };
}

function formatAspectRatio(width, height) {
  if (!width || !height) return null;
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

function gcd(a, b) {
  a = Math.round(a);
  b = Math.round(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

function computePacing(sceneTimestamps, durationSec) {
  if (!sceneTimestamps || sceneTimestamps.length === 0 || !durationSec || durationSec <= 0) {
    return { avgShotDurationSec: null, cutsPerMinute: null };
  }

  const sorted = [...sceneTimestamps].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0.3) gaps.push(gap);
  }

  if (gaps.length === 0) {
    return { avgShotDurationSec: durationSec, cutsPerMinute: 0 };
  }

  const avgShotDurationSec = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const cutsPerMinute = (sorted.length / durationSec) * 60;

  return { avgShotDurationSec: Math.round(avgShotDurationSec * 100) / 100, cutsPerMinute: Math.round(cutsPerMinute * 100) / 100 };
}

function computeMotionIntensity(sceneTimestamps, durationSec) {
  if (!sceneTimestamps || sceneTimestamps.length === 0 || !durationSec || durationSec <= 0) {
    return 0;
  }

  const cutsPerMin = (sceneTimestamps.length / durationSec) * 60;

  const intensity = Math.min(100, Math.round(cutsPerMin * 8));

  return intensity;
}

async function detectCaptions(videoPath) {
  try {
    const ff = reelsService.getFfmpegPath();
    const durationSec = await reelsService.getDuration(videoPath);

    if (!durationSec || durationSec <= 0) return { present: false, position: null };

    const sampleTimes = [];
    for (let i = 1; i <= 5; i++) {
      sampleTimes.push((durationSec / 6) * i);
    }

    let captionScores = { bottom: 0, center: 0, top: 0 };
    let sampled = 0;

    for (const t of sampleTimes) {
      const result = spawnSync(ff, [
        '-ss', String(t),
        '-i', videoPath,
        '-vframes', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'gray',
        '-s', '160x90',
        '-'
      ], {
        windowsHide: true,
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      if (result.stdout.length < 160 * 90) continue;

      const pixels = new Uint8Array(result.stdout);

      const bottom = edgeDensityInRegion(pixels, 160, 90, 0.7, 0.9);
      const center = edgeDensityInRegion(pixels, 160, 90, 0.4, 0.6);
      const top = edgeDensityInRegion(pixels, 160, 90, 0.1, 0.3);

      if (bottom > 0.15) captionScores.bottom++;
      if (center > 0.15) captionScores.center++;
      if (top > 0.15) captionScores.top++;

      sampled++;
    }

    if (sampled === 0) return { present: false, position: null };

    const threshold = Math.ceil(sampled * 0.6);

    if (captionScores.bottom >= threshold) {
      return { present: true, position: 'bottom' };
    }
    if (captionScores.center >= threshold) {
      return { present: true, position: 'center' };
    }
    if (captionScores.top >= threshold) {
      return { present: true, position: 'top' };
    }

    return { present: false, position: null };
  } catch (err) {
    console.warn(`styleAnalysisService: caption detection error: ${err.message}`);
    return { present: false, position: null };
  }
}

function edgeDensityInRegion(pixels, w, h, yStart, yEnd) {
  const startRow = Math.floor(h * yStart);
  const endRow = Math.ceil(h * yEnd);

  let edgeCount = 0;
  let totalPixels = 0;

  for (let y = startRow; y < endRow && y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const left = pixels[idx - 1];
      const right = pixels[idx + 1];
      if (Math.abs(left - right) > 40) {
        edgeCount++;
      }
      totalPixels++;
    }
  }

  return totalPixels > 0 ? edgeCount / totalPixels : 0;
}

async function getProfileCachePath(videoPath) {
  const dir = path.dirname(videoPath);
  const basename = path.basename(videoPath, path.extname(videoPath));
  return path.join(dir, `${basename}.profile.json`);
}

function isCacheValid(cachePath, videoPath) {
  try {
    if (!fs.existsSync(cachePath)) return false;
    const cacheStat = fs.statSync(cachePath);
    const videoStat = fs.statSync(videoPath);
    return cacheStat.mtimeMs >= videoStat.mtimeMs;
  } catch {
    return false;
  }
}

async function getOrAnalyze(videoPath) {
  try {
    const cachePath = await getProfileCachePath(videoPath);
    if (isCacheValid(cachePath, videoPath)) {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(raw);
    }

    const profile = await analyzeStyle(videoPath);

    try {
      fs.writeFileSync(cachePath, JSON.stringify(profile, null, 2), 'utf-8');
    } catch (writeErr) {
      console.warn(`styleAnalysisService: cache write error: ${writeErr.message}`);
    }

    return profile;
  } catch (err) {
    console.warn(`styleAnalysisService: getOrAnalyze error: ${err.message}`);
    return fallbackProfile();
  }
}

module.exports = { analyzeStyle, getOrAnalyze, getProfileCachePath };
