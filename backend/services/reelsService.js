const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');

const ffmpegStatic = require('ffmpeg-static');
const { path: ffprobeStaticPath } = require('ffprobe-static');
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStaticPath) ffmpeg.setFfprobePath(ffprobeStaticPath);

const transcriptionService = require('./transcriptionService');
const highlightAIService = require('./highlightAIService');
const lexicalHighlightService = require('./lexicalHighlightService');
const smartCropService = require('./smartCropService');
const captionService = require('./captionService');

function getFfmpegPath() {
  if (ffmpegStatic) return ffmpegStatic;
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

function detectScenes(videoPath) {
  return new Promise((resolve) => {
    const timestamps = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vf', "select='gt(scene,0.3)',showinfo",
      '-f', 'null', '-'
    ];
    console.log(`FFmpeg detectScenes: "${ff}" ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });

    const timer = setTimeout(() => {
      console.warn('detectScenes timed out, killing process');
      proc.kill();
      resolve([]);
    }, 5 * 60 * 1000);

    proc.stderr.on('data', (data) => {
      const regex = /pts_time:([\d.]+)/g;
      let m;
      while ((m = regex.exec(data.toString())) !== null) {
        timestamps.push(parseFloat(m[1]));
      }
    });

    proc.on('close', () => {
      clearTimeout(timer);
      resolve(timestamps);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.warn('detectScenes error:', err.message);
      resolve([]);
    });
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
    console.log(`FFmpeg detectSilence: "${ff}" ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });

    const timer = setTimeout(() => {
      console.warn('detectSilence timed out, killing process');
      proc.kill();
      resolve([]);
    }, 5 * 60 * 1000);

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

    proc.on('close', () => {
      clearTimeout(timer);
      resolve(intervals);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.warn('detectSilence error:', err.message);
      resolve([]);
    });
  });
}

function detectMotion(videoPath) {
  return new Promise((resolve) => {
    const motionScores = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vf', 'select=\'gt(scene,0.1)\',metadata=print:file=-',
      '-f', 'null', '-'
    ];
    console.log(`FFmpeg detectMotion: "${ff}" ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });

    const timer = setTimeout(() => {
      console.warn('detectMotion timed out, killing process');
      proc.kill();
      resolve([]);
    }, 5 * 60 * 1000);

    proc.stderr.on('data', (data) => {
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

    proc.on('close', () => {
      clearTimeout(timer);
      resolve(motionScores);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.warn('detectMotion error:', err.message);
      resolve([]);
    });
  });
}

function detectAudioBeats(videoPath) {
  return new Promise((resolve) => {
    const beatPoints = [];
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-'
    ];
    console.log(`FFmpeg detectAudioBeats: "${ff}" ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });

    const timer = setTimeout(() => {
      console.warn('detectAudioBeats timed out, killing process');
      proc.kill();
      resolve([]);
    }, 5 * 60 * 1000);

    let prevRMS = 0;
    proc.stderr.on('data', (data) => {
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

    proc.on('close', () => {
      clearTimeout(timer);
      resolve(beatPoints);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.warn('detectAudioBeats error:', err.message);
      resolve([]);
    });
  });
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

function runFfmpegEncode(inputPath, outputPath, startTime, duration, onProgress, editOptions) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Source video not found: ${inputPath}`));
    }

    const resolvedInputPath = path.resolve(inputPath);
    const resolvedOutputPath = path.resolve(outputPath);
    const outputDir = path.dirname(resolvedOutputPath);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`[reels] Created output directory: ${outputDir}`);
    }

    const ffmpegExe = getFfmpegPath();
    console.log(`[reels] Input: ${resolvedInputPath}`);
    console.log(`[reels] Output: ${resolvedOutputPath}`);
    console.log(`[reels] FFmpeg: ${ffmpegExe}`);
    console.log(`[reels] Start: ${startTime}s, Duration: ${duration}s`);

    const opts = editOptions || {};

    const cropPath = opts.cropPath || null;
    const assPath = opts.assPath || null;
    const useKenBurns = opts.kenBurns === true;
    const useLoudnorm = opts.loudnorm !== false;

    const videoFilters = [];

    videoFilters.push("scale='if(gt(dar,9/16),-2,1080)':'if(gt(dar,9/16),1920,-2)'");

    if (cropPath && cropPath.length > 0) {
      const dims = getInputDimensionsSync(resolvedInputPath);
      const cropExpr = buildCropExpression(cropPath, duration, dims.width, dims.height);
      videoFilters.push(cropExpr);
    } else {
      videoFilters.push('crop=1080:1920');
    }

    if (useKenBurns) {
      const zoomEnd = 1.08;
      const zoomRange = zoomEnd - 1.0;
      const kbScaleExpr = escapeFfmpegFilterArg(`(${1.0}+${zoomRange}*t/${duration})`);
      const kbCropXExpr = escapeFfmpegFilterArg(`(iw*${zoomEnd}-1080)/2`);
      const kbCropYExpr = escapeFfmpegFilterArg(`(ih*${zoomEnd}-1920)/2`);
      videoFilters.push(
        `scale=iw*${kbScaleExpr}:ih*${kbScaleExpr}:flags=bilinear,crop=1080:1920:${kbCropXExpr}:${kbCropYExpr}`
      );
    }

    if (assPath && fs.existsSync(assPath)) {
      const normalizedAssPath = escapeFfmpegFilterArg(assPath.replace(/\\/g, '/'));
      videoFilters.push(`ass='${normalizedAssPath}'`);
    }

    const outputOpts = [
      '-vf', videoFilters.join(','),
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    ];

    if (useLoudnorm && !opts._loudnormSkipped) {
      outputOpts.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    }

    const cmd = ffmpeg(resolvedInputPath)
      .seekInput(startTime)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(outputOpts);

    cmd.on('start', (commandLine) => {
      console.log(`[reels] FFmpeg command: ${commandLine}`);
    });

    if (onProgress) {
      cmd.on('stderr', (line) => {
        const m = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (m) {
          const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
          onProgress(Math.min(100, Math.round((secs / duration) * 100)));
        }
      });
    }

    cmd.on('end', () => {
      console.log(`[reels] Encoding completed: ${resolvedOutputPath}`);
      if (!fs.existsSync(resolvedOutputPath)) {
        return reject(new Error(`Output file not created: ${resolvedOutputPath}`));
      }
      resolve(resolvedOutputPath);
    });
    cmd.on('error', (err) => {
      console.error(`[reels] Encoding failed: ${err.message}`);
      reject(new Error(`Reel encode error: ${err.message}`));
    });

    const timeout = setTimeout(() => { cmd.kill(); reject(new Error('Reel encode timeout after 5 minutes')); }, 5 * 60 * 1000);
    cmd.on('end', () => clearTimeout(timeout));
    cmd.on('error', () => clearTimeout(timeout));

    cmd.save(resolvedOutputPath);
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
    if (!fs.existsSync(videoPath)) {
      return resolve(null);
    }
    const cmd = ffmpeg(videoPath)
      .seekInput('00:00:01')
      .frames(1)
      .outputOptions('-q:v', '5')
      .output(outputPath);

    cmd.on('start', (commandLine) => {
      console.log(`FFmpeg extractThumbnail: ${commandLine}`);
    });

    cmd.on('end', () => {
      if (fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        resolve(null);
      }
    });
    cmd.on('error', () => resolve(null));

    const timeout = setTimeout(() => { cmd.kill(); resolve(null); }, 60 * 1000);
    cmd.on('end', () => clearTimeout(timeout));
    cmd.on('error', () => clearTimeout(timeout));

    cmd.save(outputPath);
  });
}

async function generateReels(options) {
  const { videoPath, outputDir, count, reelDuration, onProgress, styleProfile } = options;
  const editOpts = options.editOptions || {};

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Source video not found: ${videoPath}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  onProgress(0, 'analyzing video');

  const [totalDuration, scenes, silences, motionScores, audioBeats] = await Promise.all([
    getDuration(videoPath),
    detectScenes(videoPath),
    detectSilence(videoPath),
    detectMotion(videoPath),
    detectAudioBeats(videoPath)
  ]);

  let highlights = null;

  onProgress(5, 'transcribing');
  const transcript = await transcriptionService.transcribeAudio(videoPath);

  if (transcript.segments.length > 0 && process.env.ENABLE_AI_HIGHLIGHTS !== 'false') {
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

  if (!highlights) {
    highlights = scoreHighlights(totalDuration, scenes, silences, motionScores, audioBeats, count, reelDuration, styleProfile, transcript);
  }

  if (highlights.length === 0) {
    const mid = totalDuration / 2;
    highlights.push({ start: Math.max(0, mid - reelDuration / 2), end: Math.min(totalDuration, mid + reelDuration / 2), score: 0 });
  }

  let fullCropPath = null;
  if (editOpts.smartCrop !== false) {
    onProgress(15, 'smart cropping');
    fullCropPath = await smartCropService.computeCropPath(videoPath);
  }

  const promises = highlights.map(async (h, i) => {
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
        reason: h.reason
      };
    } catch (err) {
      console.error(`Reel ${idx} generation failed: ${err.message}`);
      return null;
    }
  });

  const results = await Promise.allSettled(promises);

  const reels = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      reels.push(r.value);
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

function matchHighlightsToReference(totalDuration, scenes, silences, motionScores, audioBeats, reference, count, reelDuration) {
  const refAvgShot = reference.avgShotDuration || 2;
  const refAudioEnergy = reference.audioEnergy || 0.5;
  const refSceneDensity = reference.cutsFrequency || 0.3;

  const clipLength = Math.min(10, Math.max(1, refAvgShot));
  const clipsPerReel = Math.max(1, Math.round(reelDuration / clipLength));
  const totalClipsNeeded = count * clipsPerReel;
  const step = Math.max(1, Math.floor(clipLength / 2));

  const introEnd = totalDuration * 0.08;
  const creditsStart = totalDuration * 0.92;

  const candidates = [];

  for (let start = introEnd; start + clipLength <= creditsStart; start += step) {
    const end = start + clipLength;

    const windowScenes = scenes.filter(s => s >= start && s <= end);
    const candidateDensity = windowScenes.length / clipLength;
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
    const silenceRatio = silDur / clipLength;
    const silenceScore = -25 * silenceRatio;

    if (silenceRatio > 0.5) silenceScore -= 15;

    const mid = (start + end / 2) / totalDuration;
    const centerScore = 5 * (1 - Math.abs(mid - 0.5) * 2);

    const sceneBonus = windowScenes.length >= 1 ? 5 : -10;
    const motionBonus = avgMotion > 0.2 ? 8 : 0;
    const beatsBonus = windowBeats.length >= 2 ? 5 : 0;

    candidates.push({
      start: Math.max(0, start),
      end: Math.min(totalDuration, end),
      score: densityScore + silenceScore + centerScore + sceneBonus + motionScore + beatsScore + motionBonus + beatsBonus,
      sceneCount: windowScenes.length
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const selected = [];
  const minGap = clipLength * 0.5;

  for (const c of candidates) {
    if (selected.length >= totalClipsNeeded) break;
    if (!selected.some(s => Math.abs(s.start - c.start) < minGap)) {
      selected.push(c);
    }
  }

  selected.sort((a, b) => a.start - b.start);

  const reelGroups = [];
  for (let i = 0; i < count; i++) {
    const startIdx = i * clipsPerReel;
    const groupClips = selected.slice(startIdx, startIdx + clipsPerReel);
    if (groupClips.length > 0) {
      reelGroups.push(groupClips);
    }
  }

  return reelGroups;
}

function concatenateClips(clipPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    const concatFile = path.join(dir, 'concat_list.txt');

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
      outputPath
    ];

    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';

    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      try { fs.unlinkSync(concatFile); } catch {}
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`Concat failed: ${stderr.slice(-200)}`));
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(concatFile); } catch {}
      reject(err);
    });

    const timeout = setTimeout(() => { proc.kill(); reject(new Error('Concat timeout')); }, 5 * 60 * 1000);
    proc.on('close', () => clearTimeout(timeout));
  });
}

async function generateReelsWithReference(options) {
  const { videoPath, outputDir, count, reelDuration, referenceAnalysis, onProgress } = options;

  if (!fs.existsSync(videoPath)) throw new Error(`Source video not found: ${videoPath}`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  onProgress(0, 'analyzing video');

  const [totalDuration, scenes, silences, motionScores, audioBeats] = await Promise.all([
    getDuration(videoPath),
    detectScenes(videoPath),
    detectSilence(videoPath),
    detectMotion(videoPath),
    detectAudioBeats(videoPath)
  ]);

  const reelGroups = matchHighlightsToReference(
    totalDuration, scenes, silences, motionScores, audioBeats, referenceAnalysis, count, reelDuration
  );

  if (reelGroups.length === 0) {
    const mid = totalDuration / 2;
    const clipStart = Math.max(0, mid - reelDuration / 2);
    const reelPath = path.resolve(outputDir, 'reel_1.mp4');
    await createVerticalClip(videoPath, reelPath, clipStart, reelDuration);
    const thumbPath = path.resolve(outputDir, 'thumb_1.jpg');
    let thumbnail = null;
    try { const r = await extractThumbnail(reelPath, thumbPath); if (r && fs.existsSync(thumbPath)) thumbnail = thumbPath; } catch {}
    return [{ index: 1, path: reelPath, thumbnail, filename: 'reel_1.mp4', startTime: clipStart }];
  }

  const clipsDir = path.join(outputDir, 'clips');
  if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

  const results = [];

  for (let groupIdx = 0; groupIdx < reelGroups.length; groupIdx++) {
    const group = reelGroups[groupIdx];
    const idx = groupIdx + 1;

    onProgress(Math.round((groupIdx / reelGroups.length) * 100), `creating reel ${idx}/${count}`);

    const clipPaths = [];

    for (let clipIdx = 0; clipIdx < group.length; clipIdx++) {
      const clip = group[clipIdx];
      const clipPath = path.resolve(clipsDir, `clip_${idx}_${clipIdx + 1}.mp4`);

      try {
        await createVerticalClip(videoPath, clipPath, clip.start, clip.end - clip.start);
        if (fs.existsSync(clipPath)) {
          clipPaths.push(clipPath);
        }
      } catch (err) {
        console.warn(`Clip ${clipIdx + 1} in group ${idx} failed: ${err.message}`);
      }
    }

    if (clipPaths.length === 0) {
      console.warn(`Group ${idx} has no valid clips, skipping`);
      continue;
    }

    const reelPath = path.resolve(outputDir, `reel_${idx}.mp4`);
    try {
      await concatenateClips(clipPaths, reelPath);
    } catch (err) {
      console.warn(`Concat failed for group ${idx}, using single clip fallback: ${err.message}`);
      if (clipPaths.length > 0) {
        try { fs.copyFileSync(clipPaths[0], reelPath); } catch {}
      }
    }

    if (!fs.existsSync(reelPath)) continue;

    const thumbPath = path.resolve(outputDir, `thumb_${idx}.jpg`);
    let thumbnail = null;
    try {
      const r = await extractThumbnail(reelPath, thumbPath);
      if (r && fs.existsSync(thumbPath)) thumbnail = thumbPath;
    } catch {}

    results.push({
      index: idx,
      path: reelPath,
      thumbnail,
      filename: `reel_${idx}.mp4`,
      startTime: group[0]?.start || 0,
      clipCount: clipPaths.length
    });

    for (const cp of clipPaths) {
      try { fs.unlinkSync(cp); } catch {}
    }
  }

  try { fs.rmdirSync(clipsDir); } catch {}

  if (results.length === 0) {
    throw new Error('No reels could be generated from reference matching');
  }

  onProgress(100, 'finalizing');
  return results;
}

module.exports = { generateReels, generateReelsWithReference, packageAsZip, concatenateClips, sliceCropPath, buildCropExpression, getDuration, getInputDimensions, detectScenes, getFfmpegPath };

