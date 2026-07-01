const youtubeService = require('../services/youtubeService');
const reelsService = require('../services/reelsService');
const { validateYouTubeUrl } = require('../utils/validators');
const { cleanupFile, cleanupDirectory } = require('../utils/cleanup');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const jobs = new Map();
const TEMP_DIR = path.resolve(__dirname, '..', process.env.TEMP_DIR || './temp');

exports.generate = async (req, res, next) => {
  try {
    const { url, count, duration, quality } = req.body;

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
      reels: [],
      zipPath: null,
      outputDir,
      createdAt: Date.now(),
      url,
      count: reelCount,
      duration: reelDuration,
      quality
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
    reels: job.reels.map(r => ({
      index: r.index,
      filename: r.filename,
      startTime: r.startTime
    })),
    hasZip: !!job.zipPath
  });
};

exports.getThumbnail = (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const index = parseInt(req.params.index);
  const reel = job.reels.find(r => r.index === index);
  if (!reel || !fs.existsSync(reel.thumbnail)) {
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
      job.progress = Math.round(pct * 0.25);
    });

    console.log(`Reels job ${jobId}: Starting highlight detection`);
    job.progress = 25;
    job.step = 'analyzing video';

    const reels = await reelsService.generateReels({
      videoPath,
      outputDir: job.outputDir,
      count: job.count,
      reelDuration: job.duration,
      jobId: job.id,
      onProgress: (pct, step) => {
        job.progress = 25 + Math.round(pct * 0.70);
        job.step = step;
      }
    });

    job.reels = reels;

    if (reels.length > 1) {
      console.log(`Reels job ${jobId}: Creating ZIP`);
      job.progress = 95;
      job.step = 'compressing';
      const zipPath = path.join(job.outputDir, `reels_${job.id}.zip`);
      await reelsService.packageAsZip(reels, zipPath);
      job.zipPath = zipPath;
    }

    console.log(`Reels job ${jobId}: Complete`);
    job.status = 'ready';
    job.progress = 100;
    job.step = 'finished';

    await cleanupFile(videoPath);
  } catch (error) {
    console.error(`Reels job ${jobId}: Error`, error.message);
    await cleanupFile(videoPath).catch(() => {});
    throw error;
  }
}

function cleanupJobFiles(job) {
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
