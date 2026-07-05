const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');

const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic && ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

// Ensure ffprobe.exe exists alongside ffmpeg-static for yt-dlp compatibility
try {
  if (ffmpegStatic && ffprobeStatic && ffprobeStatic.path) {
    const ffmpegDir = path.dirname(ffmpegStatic);
    const ffprobeDest = path.join(ffmpegDir, 'ffprobe.exe');
    if (!fs.existsSync(ffprobeDest) && fs.existsSync(ffprobeStatic.path)) {
      fs.copyFileSync(ffprobeStatic.path, ffprobeDest);
    }
  }
} catch (e) {
  // non-critical
}

const transcriptionService = require('./transcriptionService');
const highlightAIService = require('./highlightAIService');
const lexicalHighlightService = require('./lexicalHighlightService');
const smartCropService = require('./smartCropService');
const captionService = require('./captionService');
const aiAssistantClient = require('./aiAssistantClient');

function getFfmpegPath() {
  if (ffmpegStatic) return ffmpegStatic;
  try {
    const p = require('ffmpeg-static');
    if (p) return p;
  } catch {}
  return 'ffmpeg';
}

function getFfprobePath() {
  // Derive from ffmpeg-static path (same directory)
  const ff = getFfmpegPath();
  if (ff && ff !== 'ffmpeg') {
    const candidate = ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to ffprobe-static
  try {
    const ffprobe = require('ffprobe-static');
    if (ffprobe && ffprobe.path && fs.existsSync(ffprobe.path)) return ffprobe.path;
  } catch {}
  return 'ffprobe';
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

function getInputDimensionsSync(videoPath) {
  try {
    const { spawnSync } = require('child_process');
    const ff = getFfmpegPath();
    const result = spawnSync(ff, ['-i', videoPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000
    });
    const stderr = result.stderr.toString();
    const m = stderr.match(/Stream.*Video.*(\d+)x(\d+)/);
    if (m) {
      return { width: parseInt(m[1]), height: parseInt(m[2]) };
    }
  } catch {}
  return { width: 1920, height: 1080 };
}

function getDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration);
    });
  });
}

function detectScenes(videoPath, videoDuration) {
  return new Promise((resolve) => {
    const timestamps = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vf', "select='gt(scene,0.3)',showinfo",
      '-f', 'null', '-'
    ];
    const startTs = Date.now();
    const timeoutMs = Math.max(30 * 60 * 1000, (videoDuration || 600) * 3 * 1000);
    console.log(`[detectScenes] Input: ${videoPath}`);
    console.log(`[detectScenes] FFmpeg: ${ff}`);
    console.log(`[detectScenes] Args: ${args.join(' ')}`);
    console.log(`[detectScenes] Timeout: ${timeoutMs}ms (${(timeoutMs/1000/60).toFixed(1)}min)`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';

    const timer = setTimeout(() => {
      console.warn(`[detectScenes] Timed out after ${timeoutMs}ms, killing process`);
      console.error(`[detectScenes] Partial stderr:\n${stderr.slice(-2000)}`);
      proc.kill();
      resolve([]);
    }, timeoutMs);

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const regex = /pts_time:([\d.]+)/g;
      let m;
      while ((m = regex.exec(data.toString())) !== null) {
        timestamps.push(parseFloat(m[1]));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTs;
      console.log(`[detectScenes] Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s), exit code: ${code}, scenes: ${timestamps.length}`);
      if (code !== 0) {
        console.warn(`[detectScenes] Non-zero exit. Stderr:\n${stderr.slice(-1000)}`);
      }
      resolve(timestamps);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[detectScenes] Spawn error: ${err.message}`);
      console.error(`[detectScenes] Stderr:\n${stderr.slice(-1000)}`);
      resolve([]);
    });
  });
}

function detectSilence(videoPath, videoDuration) {
  return new Promise((resolve) => {
    const intervals = [];
    let current = null;
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-af', 'silencedetect=n=-30dB:d=0.5',
      '-f', 'null', '-'
    ];
    const startTs = Date.now();
    const timeoutMs = Math.max(30 * 60 * 1000, (videoDuration || 600) * 3 * 1000);
    console.log(`[detectSilence] Input: ${videoPath}`);
    console.log(`[detectSilence] FFmpeg: ${ff}`);
    console.log(`[detectSilence] Args: ${args.join(' ')}`);
    console.log(`[detectSilence] Timeout: ${timeoutMs}ms (${(timeoutMs/1000/60).toFixed(1)}min)`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';

    const timer = setTimeout(() => {
      console.warn(`[detectSilence] Timed out after ${timeoutMs}ms, killing process`);
      console.error(`[detectSilence] Partial stderr:\n${stderr.slice(-2000)}`);
      proc.kill();
      resolve([]);
    }, timeoutMs);

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
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

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTs;
      console.log(`[detectSilence] Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s), exit code: ${code}, silences: ${intervals.length}`);
      if (code !== 0) {
        console.warn(`[detectSilence] Non-zero exit. Stderr:\n${stderr.slice(-1000)}`);
      }
      resolve(intervals);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[detectSilence] Spawn error: ${err.message}`);
      console.error(`[detectSilence] Stderr:\n${stderr.slice(-1000)}`);
      resolve([]);
    });
  });
}

function detectMotion(videoPath, videoDuration) {
  return new Promise((resolve) => {
    const motionScores = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vf', 'select=\'gt(scene,0.1)\',metadata=print:file=-',
      '-f', 'null', '-'
    ];
    const startTs = Date.now();
    const timeoutMs = Math.max(30 * 60 * 1000, (videoDuration || 600) * 3 * 1000);
    console.log(`[detectMotion] Input: ${videoPath}`);
    console.log(`[detectMotion] FFmpeg: ${ff}`);
    console.log(`[detectMotion] Args: ${args.join(' ')}`);
    console.log(`[detectMotion] Timeout: ${timeoutMs}ms (${(timeoutMs/1000/60).toFixed(1)}min)`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';

    const timer = setTimeout(() => {
      console.warn(`[detectMotion] Timed out after ${timeoutMs}ms, killing process`);
      console.error(`[detectMotion] Partial stderr:\n${stderr.slice(-2000)}`);
      proc.kill();
      resolve([]);
    }, timeoutMs);

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/pts_time:([\d.]+).*scene_score:([\d.]+)/);
        if (m) {
          motionScores.push({
            time: parseFloat(m[1]),
            score: parseFloat(m[2])
          });
        }
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTs;
      console.log(`[detectMotion] Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s), exit code: ${code}, motion pts: ${motionScores.length}`);
      if (code !== 0) {
        console.warn(`[detectMotion] Non-zero exit. Stderr:\n${stderr.slice(-1000)}`);
      }
      resolve(motionScores);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[detectMotion] Spawn error: ${err.message}`);
      console.error(`[detectMotion] Stderr:\n${stderr.slice(-1000)}`);
      resolve([]);
    });
  });
}

function detectAudioBeats(videoPath, videoDuration) {
  return new Promise((resolve) => {
    const beatPoints = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-'
    ];
    const startTs = Date.now();
    const timeoutMs = Math.max(30 * 60 * 1000, (videoDuration || 600) * 3 * 1000);
    console.log(`[detectAudioBeats] Input: ${videoPath}`);
    console.log(`[detectAudioBeats] FFmpeg: ${ff}`);
    console.log(`[detectAudioBeats] Args: ${args.join(' ')}`);
    console.log(`[detectAudioBeats] Timeout: ${timeoutMs}ms (${(timeoutMs/1000/60).toFixed(1)}min)`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';

    const timer = setTimeout(() => {
      console.warn(`[detectAudioBeats] Timed out after ${timeoutMs}ms, killing process`);
      console.error(`[detectAudioBeats] Partial stderr:\n${stderr.slice(-2000)}`);
      proc.kill();
      resolve([]);
    }, timeoutMs);

    let prevRMS = 0;
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const m = line.match(/pts_time:([\d.]+).*lavfi.astats.Overall.RMS_level=([-\d.]+)/);
        if (m) {
          const time = parseFloat(m[1]);
          const rms = Math.abs(parseFloat(m[2]));
          if (rms > prevRMS * 1.5 && rms > 0.01) {
            beatPoints.push({ time, intensity: rms });
          }
          prevRMS = rms;
        }
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTs;
      console.log(`[detectAudioBeats] Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s), exit code: ${code}, beats: ${beatPoints.length}`);
      if (code !== 0) {
        console.warn(`[detectAudioBeats] Non-zero exit. Stderr:\n${stderr.slice(-1000)}`);
      }
      resolve(beatPoints);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[detectAudioBeats] Spawn error: ${err.message}`);
      console.error(`[detectAudioBeats] Stderr:\n${stderr.slice(-1000)}`);
      resolve([]);
    });
  });
}

function detectVideoChanges(videoPath, videoDuration) {
  const ff = getFfmpegPath();
  const isLongVideo = videoDuration > 30 * 60;
  const fpsPrefix = isLongVideo ? 'fps=2,' : '';
  const modeLabel = isLongVideo ? 'fps=2 sampling' : 'full-rate';
  const timeoutMs = Math.min(Math.max((videoDuration || 600) * 3 * 1000, 3 * 60 * 1000), 10 * 60 * 1000);
  console.log(`[detectVideoChanges] mode=${modeLabel}, timeout=${(timeoutMs/1000).toFixed(0)}s`);

  function runPass(threshold) {
    return new Promise((resolve) => {
      const timestamps = [];
      const args = [
        '-i', videoPath,
        '-vf', `${fpsPrefix}select='gt(scene,${threshold})',showinfo`,
        '-f', 'null', '-'
      ];
      console.log(`[detectVideoChanges] pass threshold=${threshold} ${args.join(' ')}`);
      const proc = spawn(ff, args, { windowsHide: true });
      let stderr = '';

      const timer = setTimeout(() => {
        console.warn(`[detectVideoChanges] pass=${threshold} timed out after ${timeoutMs}ms`);
        proc.kill();
        resolve([]);
      }, timeoutMs);

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        let m;
        const re = /pts_time:([\d.]+)/g;
        while ((m = re.exec(text)) !== null) {
          timestamps.push(parseFloat(m[1]));
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.warn(`[detectVideoChanges] pass=${threshold} non-zero exit. Stderr:\n${stderr.slice(-1000)}`);
        }
        resolve(timestamps);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        console.error(`[detectVideoChanges] pass=${threshold} spawn error: ${err.message}`);
        resolve([]);
      });
    });
  }

  const startTs = Date.now();
  return Promise.all([runPass(0.3), runPass(0.1)]).then(([scenePts, motionPts]) => {
    const elapsed = Date.now() - startTs;
    const sceneSet = new Set(scenePts);
    const motionScores = motionPts.filter(t => !sceneSet.has(t)).map(t => ({ time: t, score: 0.5 }));
    console.log(`[detectVideoChanges] Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s), scenes: ${scenePts.length}, motion pts: ${motionScores.length}`);
    return { scenes: scenePts, motionScores };
  });
}

function detectAudioChanges(videoPath, videoDuration) {
  return new Promise((resolve) => {
    const intervals = [];
    const beatPoints = [];
    let current = null;
    let prevRMS = 0;
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-af', 'silencedetect=n=-30dB:d=0.5,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-'
    ];
    const startTs = Date.now();
    const timeoutMs = Math.min(Math.max((videoDuration || 600) * 3 * 1000, 3 * 60 * 1000), 10 * 60 * 1000);
    console.log(`[detectAudioChanges] timeout=${(timeoutMs/1000).toFixed(0)}s`);
    console.log(`[detectAudioChanges] ffmpeg ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';

    const timer = setTimeout(() => {
      console.warn(`[detectAudioChanges] Timed out after ${timeoutMs}ms, killing process`);
      console.error(`[detectAudioChanges] Partial stderr:\n${stderr.slice(-2000)}`);
      proc.kill();
      resolve({ silences: [], audioBeats: [] });
    }, timeoutMs);

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        let m = line.match(/silence_start:\s+([\d.]+)/);
        if (m) current = { start: parseFloat(m[1]) };
        m = line.match(/silence_end:\s+([\d.]+)/);
        if (m && current) {
          current.end = parseFloat(m[1]);
          intervals.push(current);
          current = null;
        }
        m = line.match(/pts_time:([\d.]+).*lavfi.astats.Overall.RMS_level=([-\d.]+)/);
        if (m) {
          const time = parseFloat(m[1]);
          const rms = Math.abs(parseFloat(m[2]));
          if (rms > prevRMS * 1.5 && rms > 0.01) {
            beatPoints.push({ time, intensity: rms });
          }
          prevRMS = rms;
        }
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Date.now() - startTs;
      console.log(`[detectAudioChanges] Completed in ${elapsed}ms (${(elapsed/1000).toFixed(1)}s), exit code: ${code}, silences: ${intervals.length}, beats: ${beatPoints.length}`);
      if (code !== 0) {
        console.warn(`[detectAudioChanges] Non-zero exit. Stderr:\n${stderr.slice(-1000)}`);
      }
      resolve({ silences: intervals, audioBeats: beatPoints });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[detectAudioChanges] Spawn error: ${err.message}`);
      resolve({ silences: [], audioBeats: [] });
    });
  });
}

function computeHighlightFeatures(windowStart, windowEnd, scenes, motionScores, audioBeats, silences, transcriptSegments, totalDuration) {
  const duration = windowEnd - windowStart;
  const windowScenes = scenes.filter(s => s >= windowStart && s <= windowEnd);
  const sceneCount = windowScenes.length;
  const windowMotion = motionScores.filter(m => m.time >= windowStart && m.time <= windowEnd);
  const avgMotion = windowMotion.length > 0
    ? windowMotion.reduce((a, m) => a + m.score, 0) / windowMotion.length
    : 0;
  const beatCount = audioBeats.filter(b => b.time >= windowStart && b.time <= windowEnd).length;
  const silDur = silences
    .filter(s => s.start < windowEnd && s.end > windowStart)
    .reduce((a, s) => a + Math.min(s.end, windowEnd) - Math.max(s.start, windowStart), 0);
  const silenceRatio = duration > 0 ? silDur / duration : 0;
  const center = (windowStart + windowEnd) / 2;
  const normPos = totalDuration > 0 ? center / totalDuration : 0.5;
  let lexicalScore = 0;
  if (transcriptSegments && transcriptSegments.length > 0) {
    for (const seg of transcriptSegments) {
      if (seg.start < windowEnd && seg.end > windowStart) {
        lexicalScore += lexicalHighlightService.scoreSegmentText(seg.text, seg.start, seg.end);
      }
    }
  }
  return {
    sceneCount: Math.round(sceneCount),
    avgMotion: Math.round(avgMotion * 10000) / 10000,
    beatCount: Math.round(beatCount),
    silenceRatio: Math.round(silenceRatio * 10000) / 10000,
    normPos: Math.round(normPos * 10000) / 10000,
    lexicalScore: Math.round(lexicalScore),
    windowDuration: Math.round(duration * 100) / 100
  };
}

function scoreHighlights(totalDuration, scenes, silences, motionScores, audioBeats, count, reelDuration, styleProfile, transcript) {
  const candidates = [];
  const step = Math.max(1, Math.floor(totalDuration / 150));

  const introEnd = totalDuration * 0.08;
  const creditsStart = totalDuration * 0.92;

  for (let start = introEnd; start + reelDuration <= creditsStart; start += step) {
    const end = start + reelDuration;

    let score = 0;
    const windowScenes = scenes.filter(s => s >= start && s <= end);
    score += windowScenes.length * 8;

    const windowMotion = motionScores.filter(m => m.time >= start && m.time <= end);
    const avgMotion = windowMotion.length > 0 
      ? windowMotion.reduce((a, m) => a + m.score, 0) / windowMotion.length 
      : 0;
    score += avgMotion * 50;

    const windowBeats = audioBeats.filter(b => b.time >= start && b.time <= end);
    score += windowBeats.length * 10;

    const silDur = silences
      .filter(s => s.start < end && s.end > start)
      .reduce((a, s) => a + Math.min(s.end, end) - Math.max(s.start, start), 0);
    const silenceRatio = silDur / reelDuration;
    score -= silenceRatio * 40;

    if (silenceRatio > 0.5) score -= 30;
    if (windowMotion.length < 2 && windowScenes.length < 2) score -= 20;

    const mid = (start + end / 2) / totalDuration;
    score += (1 - Math.abs(mid - 0.5) * 2) * 15;

    if (windowScenes.length >= 2) score += 5;
    if (windowScenes.length >= 4) score += 5;
    if (avgMotion > 0.3) score += 10;
    if (windowBeats.length >= 3) score += 8;

    if (styleProfile) {
      let styleScore = 0;
      if (styleProfile.cutsPerMinute != null && windowScenes.length > 0) {
        const localCutsPerMin = (windowScenes.length / reelDuration) * 60;
        const cutDiff = Math.abs(localCutsPerMin - styleProfile.cutsPerMinute);
        const maxCutDiff = Math.max(styleProfile.cutsPerMinute, 1);
        styleScore += 20 * (1 - Math.min(1, cutDiff / maxCutDiff));
      }
      if (styleProfile.motionIntensity != null && avgMotion > 0) {
        const localMotion = avgMotion * 100;
        const motionDiff = Math.abs(localMotion - styleProfile.motionIntensity);
        styleScore += 15 * (1 - Math.min(1, motionDiff / Math.max(styleProfile.motionIntensity, 10)));
      }
      score += styleScore;
    }

    candidates.push({ start: Math.max(0, start), end: Math.min(totalDuration, end), score });
  }

  if (transcript && transcript.segments && transcript.segments.length > 0) {
    const scored = lexicalHighlightService.addTranscriptBonusToCandidates(candidates, transcript.segments, reelDuration);
    candidates.length = 0;
    candidates.push(...scored);
  } else {
    candidates.sort((a, b) => b.score - a.score);
  }

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

function escapeFfmpegFilterArg(str) {
  return String(str).replace(/[\\'",;\[\]:]/g, '\\$&');
}

function sliceCropPath(cropPath, startTime, duration) {
  const endTime = startTime + duration;
  return cropPath
    .filter(p => p.time >= startTime && p.time <= endTime)
    .map(p => ({ ...p, time: Math.max(0, p.time - startTime) }));
}

function buildCropExpression(cropPath, clipDuration, sourceWidth, sourceHeight) {
  if (!cropPath || cropPath.length === 0) {
    return 'crop=1080:1920';
  }

  const dar = sourceWidth / sourceHeight;

  let scaleW, scaleH;
  if (dar > 9 / 16) {
    scaleH = 1920;
    scaleW = Math.round(sourceWidth * (scaleH / sourceHeight));
  } else {
    scaleW = 1080;
    scaleH = Math.round(sourceHeight * (scaleW / sourceWidth));
  }

  const cxMin = 540;
  const cxMax = scaleW - 540;
  const cyMin = 960;
  const cyMax = scaleH - 960;

  const scaleX = scaleW / sourceWidth;
  const scaleY = scaleH / sourceHeight;

  const getXExpr = (cx) => Math.max(cxMin, Math.min(cxMax, Math.round(cx * scaleX - 540)));
  const getYExpr = (cy) => Math.max(cyMin, Math.min(cyMax, Math.round(cy * scaleY - 960)));

  const samples = [];
  for (let i = 0; i < cropPath.length; i++) {
    const cur = cropPath[i];
    const next = cropPath[i + 1];
    const tStart = cur.time;
    const tEnd = next ? Math.min(next.time, clipDuration) : clipDuration;

    if (tEnd <= tStart) continue;

    const cx = getXExpr(cur.x);
    const cy = getYExpr(cur.y);

    let xPart = cx;
    let yPart = cy;

    if (next) {
      const nextCx = getXExpr(next.x);
      const nextCy = getYExpr(next.y);
      const midT = (tStart + tEnd) / 2;
      xPart = `${cx}+(${nextCx}-${cx})*((t-${tStart})/${(tEnd - tStart).toFixed(3)})`;
      yPart = `${cy}+(${nextCy}-${cy})*((t-${tStart})/${(tEnd - tStart).toFixed(3)})`;
    }

    samples.push({ tStart, tEnd, xPart, yPart });
  }

  if (samples.length === 0) {
    return 'crop=1080:1920';
  }

  function nest(exprs, accessor, defaultVal) {
    let result = String(defaultVal);
    for (let i = exprs.length - 1; i >= 0; i--) {
      const s = exprs[i];
      result = `if(between(t,${s.tStart.toFixed(3)},${s.tEnd.toFixed(3)}),${accessor(s)},${result})`;
    }
    return result;
  }

  const xExpr = nest(samples, s => s.xPart, 0);
  const yExpr = nest(samples, s => s.yPart, 0);

  const escapedX = escapeFfmpegFilterArg(xExpr);
  const escapedY = escapeFfmpegFilterArg(yExpr);

  return `crop=1080:1920:${escapedX}:${escapedY}`;
}

async function processQueue(tasks, concurrency = 2) {
  const executing = [];
  
  for (const task of tasks) {
    const promise = task().then(result => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });
    
    executing.push(promise);
    
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(executing);
}

function runFfmpegEncode(inputPath, outputPath, startTime, duration, onProgress, editOptions) {
  return new Promise((resolve, reject) => {
    const resolvedInput = path.resolve(inputPath);
    const resolvedOutput = path.resolve(outputPath);
    const outputDir = path.dirname(resolvedOutput);
    const opts = editOptions || {};

    // --- Pre-validation ---
    if (!fs.existsSync(resolvedInput)) {
      return reject(new Error(`Source video not found: ${resolvedInput}`));
    }

    if (!fs.existsSync(outputDir)) {
      try {
        fs.mkdirSync(outputDir, { recursive: true });
      } catch (e) {
        return reject(new Error(`Failed to create output directory ${outputDir}: ${e.message}`));
      }
    }

    try {
      fs.accessSync(outputDir, fs.constants.W_OK);
    } catch (e) {
      return reject(new Error(`Output directory not writable: ${outputDir} - ${e.message}`));
    }

    const outName = path.basename(resolvedOutput);
    if (/[<>:"|?*]/.test(outName.replace(/\.mp4$/i, ''))) {
      return reject(new Error(`Output filename contains illegal characters: ${outName}`));
    }

    const ffmpegExe = getFfmpegPath();

    // --- Build filter chain ---
    const cropPath = opts.cropPath || null;
    const assPath = opts.assPath || null;
    const useKenBurns = opts.kenBurns === true || typeof opts.kenBurns === 'number';
    const useLoudnorm = opts.loudnorm !== false;

    const videoFilters = [];
    videoFilters.push("scale='if(gt(dar,9/16),-2,1080)':'if(gt(dar,9/16),1920,-2)'");

    if (cropPath && cropPath.length > 0) {
      const dims = getInputDimensionsSync(resolvedInput);
      videoFilters.push(buildCropExpression(cropPath, duration, dims.width, dims.height));
    } else {
      videoFilters.push('crop=1080:1920');
    }

    if (useKenBurns) {
      const zoomEnd = typeof opts.kenBurns === 'number' ? opts.kenBurns : 1.08;
      const zoomRange = zoomEnd - 1.0;
      videoFilters.push(
        `scale=iw*(${1.0}+${zoomRange}*t/${duration}):ih*(${1.0}+${zoomRange}*t/${duration}):flags=bilinear,crop=1080:1920:(iw*${zoomEnd}-1080)/2:(ih*${zoomEnd}-1920)/2`
      );
    }

    if (assPath && fs.existsSync(assPath)) {
      // Escape colons in path for ffmpeg filter syntax, convert backslashes
      const escaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      videoFilters.push(`ass=${escaped}`);
    }

    const filterChain = videoFilters.join(',');

    // --- Build arguments ---
    const args = [
      '-ss', String(startTime),
      '-i', resolvedInput,
      '-t', String(duration),
      '-vf', filterChain,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    ];

    if (useLoudnorm) {
      args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    }

    args.push('-y', resolvedOutput);

    // --- Logging ---
    const startTs = Date.now();
    console.log(`[encode] ==============================`);
    console.log(`[encode] Input: ${resolvedInput}`);
    console.log(`[encode] Output: ${resolvedOutput}`);
    console.log(`[encode] FFmpeg: ${ffmpegExe}`);
    console.log(`[encode] Working dir: ${process.cwd()}`);
    console.log(`[encode] Start time: ${startTime}s`);
    console.log(`[encode] Duration: ${duration}s`);
    console.log(`[encode] Args: ${args.join(' ')}`);

    // --- Spawn ---
    const proc = spawn(ffmpegExe, args, { windowsHide: true });
    let stderrBuf = '';
    let settled = false;

    const dynamicTimeout = Math.max(10 * 60 * 1000, duration * 4 * 1000);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error(`[encode] Timed out after ${(dynamicTimeout / 1000).toFixed(0)}s`);
      console.error(`[encode] Partial stderr:\n${stderrBuf.slice(-3000)}`);
      proc.kill();
      reject(new Error(`Reel encode timed out after ${(dynamicTimeout / 1000).toFixed(0)}s`));
    }, dynamicTimeout);

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderrBuf += text;
      if (onProgress) {
        const m = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (m) {
          const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
          onProgress(Math.min(100, Math.round((secs / duration) * 100)));
        }
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      const elapsed = Date.now() - startTs;
      console.log(`[encode] Exit code: ${code}, elapsed: ${(elapsed / 1000).toFixed(1)}s`);

      if (code === 0 && fs.existsSync(resolvedOutput)) {
        const outStat = fs.statSync(resolvedOutput);
        console.log(`[encode] Output created: ${resolvedOutput} (${(outStat.size / 1024 / 1024).toFixed(1)}MB)`);
        settled = true;
        resolve(resolvedOutput);
      } else {
        settled = true;
        console.error(`[encode] FAILED (exit ${code})`);
        console.error(`[encode] Full stderr:\n${stderrBuf}`);
        const reason = stderrBuf.slice(-1500);
        reject(new Error(`Reel encode failed (exit ${code}). Stderr: ${reason}`));
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.error(`[encode] Spawn error: ${err.message}`);
      reject(new Error(`Reel encode spawn error: ${err.message}`));
    });
  });
}

function createVerticalClip(inputPath, outputPath, startTime, duration, onProgress, editOptions) {
  return runFfmpegEncode(inputPath, outputPath, startTime, duration, onProgress, editOptions)
    .catch(err => {
      if (editOptions && editOptions.cropPath) {
        console.warn(`[reels] Smart crop encode failed, retrying with center crop: ${err.message}`);
        const retryOpts = { ...editOptions, cropPath: null };
        return runFfmpegEncode(inputPath, outputPath, startTime, duration, onProgress, retryOpts);
      }
      throw err;
    });
}

function extractThumbnail(videoPath, outputPath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(videoPath)) return resolve(null);

    const ff = getFfmpegPath();
    const args = [
      '-ss', '00:00:01',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '5',
      '-y', outputPath
    ];
    console.log(`[thumbnail] ${ff} ${args.join(' ')}`);

    const proc = spawn(ff, args, { windowsHide: true });
    let stderrBuf = '';

    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 60 * 1000);

    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        if (code !== 0) console.warn(`[thumbnail] Failed (exit ${code}): ${stderrBuf.slice(-300)}`);
        resolve(null);
      }
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

async function validateVideoForReels(videoPath, outputDir, quality) {
  console.log(`[validation] Starting pre-validation for ${videoPath}`);

  // 1. Source video exists
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Source video not found: ${videoPath}`);
  }

  const stats = fs.statSync(videoPath);
  const fileSizeMB = stats.size / (1024 * 1024);
  console.log(`[validation] Source size: ${fileSizeMB.toFixed(2)}MB`);

  if (fileSizeMB < 0.1) {
    throw new Error(`Source video too small: ${fileSizeMB.toFixed(2)}MB`);
  }

  // 2. Output directory exists and writable
  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`[validation] Created output dir: ${outputDir}`);
    } catch (e) {
      throw new Error(`Failed to create output directory ${outputDir}: ${e.message}`);
    }
  }

  try {
    fs.accessSync(outputDir, fs.constants.W_OK);
    console.log(`[validation] Output dir writable: ${outputDir}`);
  } catch (e) {
    throw new Error(`Output directory not writable: ${outputDir} - ${e.message}`);
  }

  // 3. Check free disk space (need at least 2x source file)
  const tmpDir = path.dirname(outputDir);
  try {
    const { execSync } = require('child_process');
    const dfOut = execSync(`fsutil volume diskfree "${tmpDir}"`, { encoding: 'utf-8', timeout: 5000 });
    const freeMatch = dfOut.match(/Total free bytes\s+:\s+(\d+)/i);
    if (freeMatch) {
      const freeBytes = parseInt(freeMatch[1]);
      const freeGB = freeBytes / (1024 * 1024 * 1024);
      console.log(`[validation] Free disk space: ${freeGB.toFixed(2)}GB`);
      if (freeBytes < stats.size * 2) {
        throw new Error(`Insufficient disk space. Need ${(stats.size * 2 / 1024/1024/1024).toFixed(1)}GB, have ${freeGB.toFixed(1)}GB`);
      }
    }
  } catch (e) {
    if (e.message && e.message.includes('Insufficient disk')) throw e;
    console.warn(`[validation] Could not check disk space: ${e.message}`);
  }

  // 4. FFmpeg executable
  const ffmpegExe = getFfmpegPath();
  console.log(`[validation] FFmpeg: ${ffmpegExe}`);
  if (!fs.existsSync(ffmpegExe)) {
    throw new Error(`FFmpeg not found: ${ffmpegExe}`);
  }

  // 5. FFprobe executable
  const ffprobeExe = getFfprobePath();
  console.log(`[validation] FFprobe: ${ffprobeExe}`);
  if (!fs.existsSync(ffprobeExe)) {
    throw new Error(`FFprobe not found: ${ffprobeExe}`);
  }

  // 6. Verify ffprobe works
  try {
    const { execFileSync } = require('child_process');
    execFileSync(ffprobeExe, ['-version'], { stdio: 'pipe', timeout: 5000 });
    console.log(`[validation] FFprobe works`);
  } catch (e) {
    throw new Error(`FFprobe execution failed: ${e.message}`);
  }

  // 7. Duration
  const duration = await getDuration(videoPath);
  console.log(`[validation] Duration: ${duration.toFixed(2)}s`);
  if (!duration || duration < 5) {
    throw new Error(`Video too short or invalid: ${duration?.toFixed(2)}s (minimum 5s)`);
  }

  // 8. Resolution / codec
  const dims = await getInputDimensions(videoPath);
  const smallestDim = Math.min(dims.width, dims.height);
  console.log(`[validation] Resolution: ${dims.width}x${dims.height} (requested quality: ${quality || 'not specified'})`);
  if (smallestDim < 360) {
    throw new Error(
      `Video resolution too low: ${dims.width}x${dims.height} (smallest dimension ${smallestDim}px, minimum 360px). ` +
      `This source video's best available stream is only ${dims.width}x${dims.height}. ` +
      `A higher-resolution source is not available for this video.`
    );
  }

  // 9. Temp dir writable
  try {
    fs.accessSync(tmpDir, fs.constants.W_OK);
  } catch (e) {
    throw new Error(`Temp directory not writable: ${tmpDir} - ${e.message}`);
  }

  console.log(`[validation] PASSED`);
  return { duration, dimensions: dims };
}

async function generateReels(options) {
  const { videoPath, outputDir, count, reelDuration, onProgress, styleProfile, quality } = options;
  const editOpts = options.editOptions || {};

  await validateVideoForReels(videoPath, outputDir, quality);

  const ANALYSIS_DEADLINE_MS = 12 * 60 * 1000;
  const analysisStartMs = Date.now();

  onProgress(0, 'analyzing video');

  const totalDuration = await getDuration(videoPath);

  const [{ scenes, motionScores }, { silences, audioBeats }] = await Promise.all([
    detectVideoChanges(videoPath, totalDuration),
    detectAudioChanges(videoPath, totalDuration)
  ]);

  let highlights = null;

  onProgress(5, 'transcribing');
  const transcript = await transcriptionService.transcribeAudio(videoPath);

  const analysisElapsed = Date.now() - analysisStartMs;
  const aiEnabled = transcript.segments.length > 0
    && process.env.ENABLE_AI_HIGHLIGHTS !== 'false'
    && analysisElapsed < ANALYSIS_DEADLINE_MS;

  if (!aiEnabled && analysisElapsed >= ANALYSIS_DEADLINE_MS) {
    console.warn(`[generateReels] Analysis deadline (${ANALYSIS_DEADLINE_MS/1000}s) reached after ${(analysisElapsed/1000).toFixed(0)}s, skipping AI selection`);
  }

  if (aiEnabled) {
    try {
      onProgress(10, 'selecting highlights with AI');
      const aiOptions = { transcript, totalDuration, count, reelDuration };
      if (styleProfile) aiOptions.styleProfile = styleProfile;
      const aiHighlights = await highlightAIService.selectHighlightsWithAI(aiOptions);

      if (aiHighlights.length > 0) {
        console.log(`AI selected ${aiHighlights.length} highlights based on transcript`);
        highlights = aiHighlights.map(h => ({
          start: h.start,
          end: h.end,
          score: h.score,
          title: h.title,
          reason: h.reason
        }));
      } else {
        console.warn('AI returned zero highlights, falling back to heuristic');
      }
    } catch (aiErr) {
      console.warn(`AI highlight selection failed: ${aiErr.message}, falling back to heuristic`);
    }
  }

  if (!highlights && aiAssistantClient.isAvailable()) {
    try {
      onProgress(10, 'selecting highlights with AI assistant');
      const payload = { scenes, motionScores, silences, audioBeats, totalDuration, count, reelDuration, transcriptSegments: transcript.segments };
      const assistantHighlights = await aiAssistantClient.analyze(payload);
      if (assistantHighlights && assistantHighlights.length > 0) {
        console.log(`AI assistant selected ${assistantHighlights.length} highlights`);
        highlights = assistantHighlights.map(h => ({
          start: h.start, end: h.end, score: h.score, features: h.features
        }));
      } else {
        console.warn('AI assistant returned zero highlights, falling back to heuristic');
      }
    } catch (assistErr) {
      console.warn(`AI assistant selection failed: ${assistErr.message}, falling back to heuristic`);
    }
  }

  if (!highlights) {
    highlights = scoreHighlights(totalDuration, scenes, silences, motionScores, audioBeats, count, reelDuration, styleProfile, transcript);
  }

  if (highlights.length === 0) {
    const mid = totalDuration / 2;
    highlights.push({ start: Math.max(0, mid - reelDuration / 2), end: Math.min(totalDuration, mid + reelDuration / 2), score: 0 });
  }

  highlights = highlights.map(h => ({
    ...h,
    features: h.features || computeHighlightFeatures(h.start, h.end, scenes, motionScores, audioBeats, silences, transcript.segments, totalDuration)
  }));

  let fullCropPath = null;
  if (editOpts.smartCrop !== false) {
    onProgress(15, 'smart cropping');
    fullCropPath = await smartCropService.computeCropPath(videoPath);
  }

  const tasks = highlights.map((h, i) => {
    return async () => {
      const idx = i + 1;
      const reelPath = path.resolve(outputDir, `reel_${idx}.mp4`);
      const thumbPath = path.resolve(outputDir, `thumb_${idx}.jpg`);

      try {
        console.log(`Generating reel ${idx}/${highlights.length} (start=${h.start}s, duration=${reelDuration}s)`);

        const clipEditOpts = {};

        if (fullCropPath) {
          clipEditOpts.cropPath = sliceCropPath(fullCropPath, h.start, reelDuration);
        }

        if (editOpts.kenBurns !== false) {
          const windowScenes = scenes.filter(s => s >= h.start && s <= h.start + reelDuration);
          clipEditOpts.kenBurns = windowScenes.length < 2;
        } else {
          clipEditOpts.kenBurns = false;
        }

        clipEditOpts.loudnorm = editOpts.loudnorm !== false;

        let assPath = null;
        if (editOpts.captions !== false) {
          onProgress(
            20 + Math.round((i / highlights.length) * 15),
            'adding captions'
          );
          assPath = path.resolve(outputDir, `captions_${idx}.ass`);
          const captionResult = await captionService.generateCaptionFile(transcript, assPath, { start: h.start, end: h.start + reelDuration });
          if (captionResult) {
            clipEditOpts.assPath = captionResult;
          }
        }

        await createVerticalClip(videoPath, reelPath, h.start, reelDuration, null, clipEditOpts);

        if (!fs.existsSync(reelPath)) {
          throw new Error(`Output file not found after encoding: ${reelPath}`);
        }

        let thumbnail = null;
        try {
          const result = await extractThumbnail(reelPath, thumbPath);
          if (result && fs.existsSync(thumbPath)) {
            thumbnail = thumbPath;
          }
        } catch (thumbErr) {
          console.warn(`Thumbnail extraction failed for reel ${idx}: ${thumbErr.message}`);
        }

        if (assPath && fs.existsSync(assPath)) {
          try { fs.unlinkSync(assPath); } catch {}
        }

        return {
          index: idx,
          path: reelPath,
          thumbnail,
          filename: `reel_${idx}.mp4`,
          startTime: h.start,
          title: h.title,
          reason: h.reason,
          features: h.features
        };
      } catch (err) {
        console.error(`Reel ${idx} generation failed: ${err.message}`);
        return null;
      }
    };
  });

  const results = await processQueue(tasks, 2);

  const reels = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r) {
      reels.push(r);
    }
    onProgress(Math.round(((i + 1) / results.length) * 100), `creating reel ${Math.min(i + 1, results.length)}/${count}`);
  }

  if (reels.length === 0) {
    throw new Error('No reels could be generated. All reel encodings failed.');
  }

  onProgress(100, 'finalizing');
  return reels;
}

function packageAsZip(reels, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outputPath));
    archive.on('error', (err) => reject(new Error(`ZIP error: ${err.message}`)));

    archive.pipe(output);

    for (const reel of reels) {
      if (reel.path && fs.existsSync(reel.path)) {
        archive.file(reel.path, { name: reel.filename });
      }
    }

    archive.finalize();
  });
}

function matchHighlightsToReference(totalDuration, scenes, silences, motionScores, audioBeats, reference, count, reelDuration, styleProfile, transcript) {
  const refSceneDensity = reference.cutsFrequency || 0.3;
  const refAudioEnergy = reference.audioEnergy || 0.5;

  const candidates = [];
  const step = Math.max(1, Math.floor(totalDuration / 150));

  const introEnd = totalDuration * 0.08;
  const creditsStart = totalDuration * 0.92;

  for (let start = introEnd; start + reelDuration <= creditsStart; start += step) {
    const end = start + reelDuration;

    const windowScenes = scenes.filter(s => s >= start && s <= end);
    const candidateDensity = windowScenes.length / reelDuration;
    const densityScore = 10 * (1 - Math.abs(candidateDensity - refSceneDensity) / Math.max(refSceneDensity, 0.01));

    const windowMotion = motionScores.filter(m => m.time >= start && m.time <= end);
    const avgMotion = windowMotion.length > 0
      ? windowMotion.reduce((a, m) => a + m.score, 0) / windowMotion.length
      : 0;
    const motionScore = avgMotion * 30;

    const windowBeats = audioBeats.filter(b => b.time >= start && b.time <= end);
    const beatsScore = windowBeats.length * 8;

    const silDur = silences
      .filter(s => s.start < end && s.end > start)
      .reduce((a, s) => a + Math.min(s.end, end) - Math.max(s.start, start), 0);
    const silenceRatio = silDur / reelDuration;
    let silenceScore = -25 * silenceRatio;
    if (silenceRatio > 0.5) silenceScore -= 15;

    const mid = (start + end / 2) / totalDuration;
    const centerScore = 5 * (1 - Math.abs(mid - 0.5) * 2);

    const sceneBonus = windowScenes.length >= 1 ? 5 : -10;
    const motionBonus = avgMotion > 0.2 ? 8 : 0;
    const beatsBonus = windowBeats.length >= 2 ? 5 : 0;

    let styleScore = 0;
    if (styleProfile) {
      if (styleProfile.cutsPerMinute != null && windowScenes.length > 0) {
        const localCutsPerMin = (windowScenes.length / reelDuration) * 60;
        const cutDiff = Math.abs(localCutsPerMin - styleProfile.cutsPerMinute);
        const maxCutDiff = Math.max(styleProfile.cutsPerMinute, 1);
        styleScore += 20 * (1 - Math.min(1, cutDiff / maxCutDiff));
      }
      if (styleProfile.motionIntensity != null && avgMotion > 0) {
        const localMotion = avgMotion * 100;
        const motionDiff = Math.abs(localMotion - styleProfile.motionIntensity);
        styleScore += 15 * (1 - Math.min(1, motionDiff / Math.max(styleProfile.motionIntensity, 10)));
      }
    }

    candidates.push({
      start: Math.max(0, start),
      end: Math.min(totalDuration, end),
      score: densityScore + silenceScore + centerScore + sceneBonus + motionScore + beatsScore + motionBonus + beatsBonus + styleScore
    });
  }

  if (transcript && transcript.segments && transcript.segments.length > 0) {
    const scored = lexicalHighlightService.addTranscriptBonusToCandidates(candidates, transcript.segments, reelDuration);
    candidates.length = 0;
    candidates.push(...scored);
  } else {
    candidates.sort((a, b) => b.score - a.score);
  }

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

function concatenateClips(clipPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    const concatFile = path.resolve(dir, 'concat_list.txt');

    const lines = clipPaths.map(p => {
      const normalized = p.replace(/\\/g, '/');
      return `file '${normalized}'`;
    });
    fs.writeFileSync(concatFile, lines.join('\n'), 'utf-8');

    const ff = getFfmpegPath();
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c', 'copy',
      '-y', outputPath
    ];
    const startTs = Date.now();
    console.log(`[concat] ${ff} ${args.join(' ')}`);

    const proc = spawn(ff, args, { windowsHide: true });
    let stderrBuf = '';

    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    const timeout = setTimeout(() => { proc.kill(); reject(new Error('Concat timed out')); }, 5 * 60 * 1000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const elapsed = Date.now() - startTs;
      try { fs.unlinkSync(concatFile); } catch {}
      console.log(`[concat] Exit code: ${code}, elapsed: ${(elapsed/1000).toFixed(1)}s`);
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[concat] Output: ${outputPath}`);
        resolve(outputPath);
      } else {
        console.error(`[concat] Failed (exit ${code}): ${stderrBuf.slice(-500)}`);
        reject(new Error(`Concat failed (exit ${code}): ${stderrBuf.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      try { fs.unlinkSync(concatFile); } catch {}
      reject(err);
    });
  });
}

async function generateReelsWithReference(options) {
  const { videoPath, outputDir, count, reelDuration, referenceAnalysis, styleProfile, editOptions, onProgress } = options;

  if (!fs.existsSync(videoPath)) throw new Error(`Source video not found: ${videoPath}`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ANALYSIS_DEADLINE_MS = 12 * 60 * 1000;
  const analysisStartMs = Date.now();

  onProgress(0, 'analyzing video');

  const totalDuration = await getDuration(videoPath);

  const [{ scenes, motionScores }, { silences, audioBeats }] = await Promise.all([
    detectVideoChanges(videoPath, totalDuration),
    detectAudioChanges(videoPath, totalDuration)
  ]);

  let transcript = null;
  if (!editOptions || editOptions.captions !== false) {
    onProgress(5, 'transcribing');
    transcript = await transcriptionService.transcribeAudio(videoPath);
  }

  let fullCropPath = null;
  if (!editOptions || editOptions.smartCrop !== false) {
    onProgress(15, 'smart cropping');
    fullCropPath = await smartCropService.computeCropPath(videoPath);
  }

  let highlights = null;

  const analysisElapsed = Date.now() - analysisStartMs;
  const aiEnabled = transcript && transcript.segments && transcript.segments.length > 0
    && process.env.ENABLE_AI_HIGHLIGHTS !== 'false'
    && analysisElapsed < ANALYSIS_DEADLINE_MS;

  if (aiEnabled) {
    try {
      onProgress(10, 'selecting highlights with AI');
      const aiOptions = { transcript, totalDuration, count, reelDuration };
      if (styleProfile) aiOptions.styleProfile = styleProfile;
      const aiHighlights = await highlightAIService.selectHighlightsWithAI(aiOptions);
      if (aiHighlights.length > 0) {
        console.log(`AI selected ${aiHighlights.length} highlights based on transcript`);
        highlights = aiHighlights.map(h => ({
          start: h.start, end: h.end, score: h.score, title: h.title, reason: h.reason
        }));
      } else {
        console.warn('AI returned zero highlights, falling back to heuristic');
      }
    } catch (aiErr) {
      console.warn(`AI highlight selection failed: ${aiErr.message}, falling back to heuristic`);
    }
  }

  if (!highlights && aiAssistantClient.isAvailable()) {
    try {
      onProgress(10, 'selecting highlights with AI assistant');
      const payload = { scenes, motionScores, silences, audioBeats, totalDuration, count, reelDuration, transcriptSegments: transcript?.segments || [] };
      const assistantHighlights = await aiAssistantClient.analyze(payload);
      if (assistantHighlights && assistantHighlights.length > 0) {
        console.log(`AI assistant selected ${assistantHighlights.length} highlights`);
        highlights = assistantHighlights.map(h => ({
          start: h.start, end: h.end, score: h.score, features: h.features
        }));
      } else {
        console.warn('AI assistant returned zero highlights, falling back to heuristic');
      }
    } catch (assistErr) {
      console.warn(`AI assistant selection failed: ${assistErr.message}, falling back to heuristic`);
    }
  }

  if (!highlights) {
    highlights = matchHighlightsToReference(
      totalDuration, scenes, silences, motionScores, audioBeats, referenceAnalysis, count, reelDuration, styleProfile, transcript
    );
  }

  if (highlights.length === 0) {
    const mid = totalDuration / 2;
    const clipStart = Math.max(0, mid - reelDuration / 2);
    const reelPath = path.resolve(outputDir, 'reel_1.mp4');
    const thumbPath = path.resolve(outputDir, 'thumb_1.jpg');

    const clipEditOpts = {};
    if (fullCropPath) {
      clipEditOpts.cropPath = sliceCropPath(fullCropPath, clipStart, reelDuration);
    }
    clipEditOpts.kenBurns = getKenBurnsZoom(styleProfile, reelDuration, scenes, clipStart);
    clipEditOpts.loudnorm = !editOptions || editOptions.loudnorm !== false;

    if (transcript && (!editOptions || editOptions.captions !== false)) {
      const assPath = path.resolve(outputDir, 'captions_1.ass');
      const captionResult = await captionService.generateCaptionFile(transcript, assPath, { start: clipStart, end: clipStart + reelDuration });
      if (captionResult) {
        clipEditOpts.assPath = captionResult;
      }
    }

    await createVerticalClip(videoPath, reelPath, clipStart, reelDuration, null, clipEditOpts);
    let thumbnail = null;
    try { const r = await extractThumbnail(reelPath, thumbPath); if (r && fs.existsSync(thumbPath)) thumbnail = thumbPath; } catch {}
    return [{ index: 1, path: reelPath, thumbnail, filename: 'reel_1.mp4', startTime: clipStart }];
  }

  highlights = highlights.map(h => ({
    ...h,
    features: h.features || computeHighlightFeatures(h.start, h.end, scenes, motionScores, audioBeats, silences, transcript?.segments || [], totalDuration)
  }));

  const results = [];

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    const idx = i + 1;

    onProgress(Math.round((i / highlights.length) * 100), `creating reel ${idx}/${count}`);

    const startTime = h.start;
    const reelPath = path.resolve(outputDir, `reel_${idx}.mp4`);
    const thumbPath = path.resolve(outputDir, `thumb_${idx}.jpg`);

    try {
      const clipEditOpts = {};

      if (fullCropPath) {
        clipEditOpts.cropPath = sliceCropPath(fullCropPath, startTime, reelDuration);
      }

      clipEditOpts.kenBurns = getKenBurnsZoom(styleProfile, reelDuration, scenes, startTime);

      clipEditOpts.loudnorm = !editOptions || editOptions.loudnorm !== false;

      let assPath = null;
      if (transcript && (!editOptions || editOptions.captions !== false)) {
        assPath = path.resolve(outputDir, `captions_${idx}.ass`);
        const captionResult = await captionService.generateCaptionFile(transcript, assPath, { start: startTime, end: startTime + reelDuration });
        if (captionResult) {
          clipEditOpts.assPath = captionResult;
        }
      }

      await createVerticalClip(videoPath, reelPath, startTime, reelDuration, null, clipEditOpts);

      if (!fs.existsSync(reelPath)) {
        throw new Error(`Output file not found after encoding: ${reelPath}`);
      }

      let thumbnail = null;
      try {
        const r = await extractThumbnail(reelPath, thumbPath);
        if (r && fs.existsSync(thumbPath)) {
          thumbnail = thumbPath;
        }
      } catch (thumbErr) {
        console.warn(`Thumbnail extraction failed for reel ${idx}: ${thumbErr.message}`);
      }

      if (assPath && fs.existsSync(assPath)) {
        try { fs.unlinkSync(assPath); } catch {}
      }

      results.push({
        index: idx,
        path: reelPath,
        thumbnail,
        filename: `reel_${idx}.mp4`,
        startTime,
        title: h.title,
        features: h.features
      });
    } catch (err) {
      console.error(`Reel ${idx} generation failed: ${err.message}`);
    }
  }

  if (results.length === 0) {
    throw new Error('No reels could be generated from reference matching');
  }

  onProgress(100, 'finalizing');
  return results;
}

function getKenBurnsZoom(styleProfile, reelDuration, scenes, startTime) {
  if (styleProfile && styleProfile.cutsPerMinute != null) {
    if (styleProfile.cutsPerMinute > 30) return 1.04;
    if (styleProfile.cutsPerMinute > 12) return 1.08;
    return 1.12;
  }
  const windowScenes = scenes.filter(s => s >= startTime && s <= startTime + reelDuration);
  return windowScenes.length < 2;
}

module.exports = { generateReels, generateReelsWithReference, packageAsZip, concatenateClips, sliceCropPath, buildCropExpression, getDuration, getInputDimensions, detectScenes, getFfmpegPath };

