const youtubeService = require('../services/youtubeService');
const ffmpegService = require('../services/ffmpegService');
const { validateYouTubeUrl, validateTimeRange } = require('../utils/validators');
const { cleanupFile } = require('../utils/cleanup');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const jobs = new Map();
const TEMP_DIR = path.resolve(__dirname, '..', process.env.TEMP_DIR || './temp');

exports.startCut = async (req, res, next) => {
  try {
    const { url, start, end, quality } = req.body;

    if (!url || !start || !end) {
      return res.status(400).json({ error: 'url, start, and end are required' });
    }

    if (!validateYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      status: 'queued',
      progress: 0,
      step: 'preparing',
      error: null,
      filePath: null,
      fileName: null,
      createdAt: Date.now(),
      url,
      start,
      end,
      quality
    };

    jobs.set(jobId, job);

    processJob(jobId).catch(err => {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'error';
        j.error = err.message || 'Processing failed';
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
    error: job.error
  });
};

exports.download = (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    console.error('Download: Job not found', req.params.jobId);
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'ready') {
    console.error('Download: File not ready', req.params.jobId, job.status);
    return res.status(400).json({ error: 'File not ready', status: job.status });
  }
  if (!job.filePath || !fs.existsSync(job.filePath)) {
    console.error('Download: File not found at path', job.filePath);
    jobs.delete(req.params.jobId);
    return res.status(404).json({ error: 'File not found' });
  }

  console.log('Download: Starting file download', job.filePath);
  res.download(job.filePath, job.fileName, err => {
    if (err) {
      console.error('Download error:', err.message);
    } else {
      console.log('Download: Completed successfully');
    }
    cleanupFile(job.filePath).catch(() => {});
    jobs.delete(req.params.jobId);
  });
};

async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const timestamp = Date.now();
  const downloadedPath = path.join(TEMP_DIR, `download_${jobId}_${timestamp}.mp4`);
  const outputPath = path.join(TEMP_DIR, `output_${jobId}_${timestamp}.mp4`);

  try {
    console.log(`Job ${jobId}: Starting download`, job.url);
    job.status = 'downloading';
    job.progress = 5;
    job.step = 'downloading';

    await youtubeService.downloadVideo(job.url, job.quality, downloadedPath, (pct) => {
      job.progress = 5 + Math.round(pct * 0.55);
    }, job.start, job.end);

    console.log(`Job ${jobId}: Download complete, starting trim`);
    job.progress = 60;
    job.step = 'cutting';

    await ffmpegService.trimVideo(downloadedPath, outputPath, job.start, job.end);

    console.log(`Job ${jobId}: Trim complete, cleaning up`);
    job.progress = 90;
    job.step = 'finishing';

    await cleanupFile(downloadedPath);

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      throw new Error('Generated file is empty');
    }

    console.log(`Job ${jobId}: Ready for download`, outputPath);
    job.status = 'ready';
    job.progress = 100;
    job.step = 'ready';
    job.filePath = outputPath;
    job.fileName = `cutvideo_${timestamp}.mp4`;
  } catch (error) {
    console.error(`Job ${jobId}: Error`, error.message);
    await cleanupFile(downloadedPath).catch(() => {});
    await cleanupFile(outputPath).catch(() => {});
    throw error;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > 30 * 60 * 1000) {
      if (job.filePath) {
        cleanupFile(job.filePath).catch(() => {});
      }
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);
