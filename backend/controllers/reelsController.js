const youtubeService = require('../services/youtubeService');
const reelsService = require('../services/reelsService');
const referenceReelsService = require('../services/referenceReelsService');
const aiAssistantClient = require('../services/aiAssistantClient');
require('../services/ffmpegService');
const { validateYouTubeUrl } = require('../utils/validators');
const { cleanupFile, cleanupDirectory } = require('../utils/cleanup');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const jobs = new Map();
const TEMP_DIR = path.resolve(__dirname, '..', process.env.TEMP_DIR || './temp');

exports.generateWithReference = async (req, res, next) => {
  try {
    const { url, count, duration, quality, referenceFilename } = req.body;

    if (!url || !count || !duration || !referenceFilename) {
      return res.status(400).json({ error: 'url, count, duration, and referenceFilename are required' });
    }

    if (!validateYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const reelCount = Math.min(Math.max(parseInt(count) || 1, 1), 20);
    const reelDuration = Math.min(Math.max(parseInt(duration) || 15, 15), 60);

    const referenceAnalysis = await referenceReelsService.analyzeReference(referenceFilename);
    const metrics = referenceReelsService.getReferenceMetrics(referenceAnalysis);

    const jobId = crypto.randomUUID();
    const outputDir = path.join(TEMP_DIR, `reels_${jobId}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const job = {
      id: jobId,
      status: 'queued',
      progress: 0,
      step: 'preparing',
      error: null,
      errorDetails: null,
      reels: [],
      zipPath: null,
      outputDir,
      createdAt: Date.now(),
      url,
      count: reelCount,
      duration: reelDuration,
      quality,
      referenceFilename,
      referenceAnalysis: metrics
    };

    jobs.set(jobId, job);

    processJobWithReference(jobId).catch(err => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'error';
        j.error = err.message || 'Reels generation failed';
      }
    });

    res.json({ jobId, referenceAnalysis: metrics, referenceReel: { filename: referenceFilename, duration: referenceAnalysis.totalDuration, avgShotDuration: metrics.avgShotDuration } });
  } catch (error) {
    next(error);
  }
};

exports.generate = async (req, res, next) => {
  try {
    const { url, count, duration, quality, captions, smartCrop } = req.body;

    if (!url || !count || !duration) {
      return res.status(400).json({ error: 'url, count, and duration are required' });
    }

    if (!validateYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const reelCount = Math.min(Math.max(parseInt(count) || 1, 1), 20);
    const reelDuration = Math.min(Math.max(parseInt(duration) || 15, 15), 60);

    const jobId = crypto.randomUUID();
    const outputDir = path.join(TEMP_DIR, `reels_${jobId}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const job = {
      id: jobId,
      status: 'queued',
      progress: 0,
      step: 'preparing',
      error: null,
      errorDetails: null,
      reels: [],
      zipPath: null,
      outputDir,
      createdAt: Date.now(),
      url,
      count: reelCount,
      duration: reelDuration,
      quality,
      editOptions: {
        captions: captions !== false,
        smartCrop: smartCrop !== false,
        kenBurns: true,
        loudnorm: true
      }
    };

    jobs.set(jobId, job);

    processJob(jobId).catch(err => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'error';
        j.error = err.message || 'Reels generation failed';
      }
    });

    res.json({ jobId });
  } catch (error) {
    next(error);
  }
};

exports.getStatus = (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
    errorDetails: job.errorDetails,
    reels: job.reels.map(r => ({
      index: r.index,
      filename: r.filename,
      startTime: r.startTime,
      hasThumbnail: !!r.thumbnail,
      title: r.title
    })),
    hasZip: !!job.zipPath
  });
};

exports.getThumbnail = (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const index = parseInt(req.params.index);
  const reel = job.reels.find(r => r.index === index);
  if (!reel || !reel.thumbnail || !fs.existsSync(reel.thumbnail)) {
    return res.status(404).json({ error: 'Thumbnail not found' });
  }
  res.sendFile(reel.thumbnail);
};

exports.downloadOne = (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'ready') {
    return res.status(400).json({ error: 'Not ready', status: job.status });
  }

  const index = parseInt(req.params.index);
  const reel = job.reels.find(r => r.index === index);
  if (!reel || !fs.existsSync(reel.path)) {
    return res.status(404).json({ error: 'Reel not found' });
  }

  if (reel.features && !reel.downloaded) {
    reel.downloaded = true;
    aiAssistantClient.recordFeedback({
      jobId: job.id,
      reelIndex: reel.index,
      features: reel.features,
      label: 1
    });
  }

  res.download(reel.path, reel.filename, err => {
    if (err) console.error('Reel download error:', err.message);
  });
};

exports.downloadAll = (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'ready') {
    return res.status(400).json({ error: 'Not ready', status: job.status });
  }

  if (job.reels.length === 1) {
    const reel = job.reels[0];
    if (!fs.existsSync(reel.path)) {
      return res.status(404).json({ error: 'Reel not found' });
    }
    if (reel.features && !reel.downloaded) {
      reel.downloaded = true;
      aiAssistantClient.recordFeedback({
        jobId: job.id,
        reelIndex: reel.index,
        features: reel.features,
        label: 1
      });
    }
    return res.download(reel.path, reel.filename, err => {
      if (err) console.error('Reel download error:', err.message);
      cleanupJobFiles(job);
    });
  }

  if (!job.zipPath || !fs.existsSync(job.zipPath)) {
    return res.status(404).json({ error: 'ZIP not found' });
  }

  res.download(job.zipPath, `reels_${job.id}.zip`, err => {
    if (err) console.error('ZIP download error:', err.message);
    cleanupJobFiles(job);
  });
};

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const timestamp = Date.now();
  const videoPath = path.join(TEMP_DIR, `reels_source_${jobId}_${timestamp}.mp4`);

  try {
    console.log(`Reels job ${jobId}: Starting download`);
    job.status = 'downloading';
    job.progress = 0;
    job.step = 'downloading';

    await youtubeService.downloadVideo(job.url, job.quality, videoPath, (pct) => {
      job.progress = Math.round(pct * 0.20);
    });

    if (!fs.existsSync(videoPath)) {
      throw new Error(`Downloaded video not found: ${videoPath}`);
    }

    console.log(`Reels job ${jobId}: Starting highlight detection`);
    job.progress = 20;
    job.step = 'analyzing video';

    const reels = await reelsService.generateReels({
      videoPath,
      outputDir: job.outputDir,
      count: job.count,
      reelDuration: job.duration,
      quality: job.quality,
      jobId: job.id,
      editOptions: job.editOptions,
      styleProfile: job.styleProfile,
      onProgress: (pct, step) => {
        job.progress = 20 + Math.round(pct * 0.70);
        job.step = step;
      }
    });

    job.reels = reels.map(r => ({ ...r, downloaded: false }));

    for (const reel of reels) {
      if (!fs.existsSync(reel.path)) {
        console.error(`Reel ${reel.index} missing at ${reel.path}`);
      }
    }

    if (reels.length > 1) {
      try {
        console.log(`Reels job ${jobId}: Creating ZIP`);
        job.progress = 90;
        job.step = 'compressing';
        const zipPath = path.join(job.outputDir, `reels_${job.id}.zip`);
        await reelsService.packageAsZip(reels, zipPath);
        if (fs.existsSync(zipPath)) {
          job.zipPath = zipPath;
        }
      } catch (zipErr) {
        console.error(`Reels job ${jobId}: ZIP creation failed, continuing without ZIP:`, zipErr.message);
      }
    }

    console.log(`Reels job ${jobId}: Complete. Generated ${reels.length} reels`);
    job.status = 'ready';
    job.progress = 100;
    job.step = 'finished';

    await cleanupFile(videoPath);
  } catch (error) {
    console.error(`Reels job ${jobId}: Error`, error.message);
    console.error(`Reels job ${jobId}: Stack`, error.stack);
    console.error(`Reels job ${jobId}: Request body`, JSON.stringify({ url: job.url, count: job.count, duration: job.duration, quality: job.quality }));
    console.error(`Reels job ${jobId}: Video path`, videoPath);
    console.error(`Reels job ${jobId}: Output dir`, job.outputDir);

    const j = jobs.get(jobId);
    if (j) {
      j.status = 'error';
      j.error = error.message || 'Reels generation failed';
      j.errorDetails = {
        stage: j.step || 'unknown',
        message: error.message,
        stack: error.stack,
        videoPath,
        outputDir: job.outputDir,
        reelsGenerated: job.reels ? job.reels.length : 0
      };
    }

    await cleanupFile(videoPath).catch(() => {});
  }
}

async function processJobWithReference(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const timestamp = Date.now();
  const videoPath = path.join(TEMP_DIR, `reels_source_${jobId}_${timestamp}.mp4`);

  try {
    console.log(`Reference reel job ${jobId}: Starting download`);
    job.status = 'downloading';
    job.progress = 0;
    job.step = 'downloading';

    await youtubeService.downloadVideo(job.url, job.quality, videoPath, (pct) => {
      job.progress = Math.round(pct * 0.20);
    });

    if (!fs.existsSync(videoPath)) {
      throw new Error(`Downloaded video not found: ${videoPath}`);
    }

    console.log(`Reference reel job ${jobId}: Starting reference analysis`);
    job.progress = 20;
    job.step = 'analyzing video';

    const reels = await reelsService.generateReelsWithReference({
      videoPath,
      outputDir: job.outputDir,
      count: job.count,
      reelDuration: job.duration,
      jobId: job.id,
      referenceAnalysis: job.referenceAnalysis,
      onProgress: (pct, step) => {
        job.progress = 20 + Math.round(pct * 0.70);
        job.step = step;
      }
    });

    job.reels = reels.map(r => ({ ...r, downloaded: false }));

    for (const reel of reels) {
      if (!fs.existsSync(reel.path)) {
        console.error(`Reel ${reel.index} missing at ${reel.path}`);
      }
    }

    if (reels.length > 1) {
      try {
        console.log(`Reference reel job ${jobId}: Creating ZIP`);
        job.progress = 90;
        job.step = 'compressing';
        const zipPath = path.join(job.outputDir, `reels_${job.id}.zip`);
        await reelsService.packageAsZip(reels, zipPath);
        if (fs.existsSync(zipPath)) {
          job.zipPath = zipPath;
        }
      } catch (zipErr) {
        console.error(`Reference reel job ${jobId}: ZIP creation failed, continuing without ZIP:`, zipErr.message);
      }
    }

    console.log(`Reference reel job ${jobId}: Complete. Generated ${reels.length} reels`);
    job.status = 'ready';
    job.progress = 100;
    job.step = 'finished';

    await cleanupFile(videoPath);
  } catch (error) {
    console.error(`Reference reel job ${jobId}: Error`, error.message);
    console.error(`Reference reel job ${jobId}: Stack`, error.stack);
    console.error(`Reference reel job ${jobId}: Request body`, JSON.stringify({ url: job.url, count: job.count, duration: job.duration, quality: job.quality, referenceFilename: job.referenceFilename }));
    console.error(`Reference reel job ${jobId}: Video path`, videoPath);
    console.error(`Reference reel job ${jobId}: Output dir`, job.outputDir);

    const j = jobs.get(jobId);
    if (j) {
      j.status = 'error';
      j.error = error.message || 'Reels generation failed';
      j.errorDetails = {
        stage: j.step || 'unknown',
        message: error.message,
        stack: error.stack,
        videoPath,
        outputDir: job.outputDir,
        reelsGenerated: job.reels ? job.reels.length : 0
      };
    }

    await cleanupFile(videoPath).catch(() => {});
  }
}

function recordNegativeFeedback(job) {
  if (!job.reels || job.reels.length === 0) return;
  for (const reel of job.reels) {
    if (!reel.downloaded && reel.features) {
      aiAssistantClient.recordFeedback({
        jobId: job.id,
        reelIndex: reel.index,
        features: reel.features,
        label: 0
      });
    }
  }
}

function cleanupJobFiles(job) {
  recordNegativeFeedback(job);
  if (job.zipPath) cleanupFile(job.zipPath).catch(() => {});
  if (job.outputDir) cleanupDirectory(job.outputDir).catch(() => {});
  jobs.delete(job.id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > 60 * 60 * 1000) {
      cleanupJobFiles(job);
    }
  }
}, 5 * 60 * 1000);

