const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const styleAnalysisService = require('../services/styleAnalysisService');
const reelsService = require('../services/reelsService');

const SAMPLE_REELS_DIR = path.resolve(__dirname, '..', 'sample-reels');
const SUPPORTED_EXT = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

function ensureSampleReelsDir() {
  if (!fs.existsSync(SAMPLE_REELS_DIR)) {
    fs.mkdirSync(SAMPLE_REELS_DIR, { recursive: true });
  }
}

function scanSamples() {
  ensureSampleReelsDir();
  const files = fs.readdirSync(SAMPLE_REELS_DIR);
  const videos = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (SUPPORTED_EXT.includes(ext)) {
      const filePath = path.join(SAMPLE_REELS_DIR, file);
      const stat = fs.statSync(filePath);
      const basename = path.basename(file, ext);
      const thumbPath = path.join(SAMPLE_REELS_DIR, basename + '.thumb.jpg');
      const profilePath = path.join(SAMPLE_REELS_DIR, basename + '.profile.json');
      videos.push({
        id: file,
        filename: file,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hasThumbnail: fs.existsSync(thumbPath),
        hasProfile: fs.existsSync(profilePath)
      });
    }
  }
  return videos.sort((a, b) => a.filename.localeCompare(b.filename));
}

function ensureThumbnail(videoPath, thumbPath) {
  return new Promise((resolve) => {
    if (fs.existsSync(thumbPath)) return resolve(thumbPath);
    const ff = reelsService.getFfmpegPath();
    const proc = spawn(ff, [
      '-i', videoPath,
      '-ss', '00:00:01',
      '-vframes', '1',
      '-q:v', '5',
      '-y', thumbPath
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 30000);
    proc.on('close', () => {
      clearTimeout(timer);
      resolve(fs.existsSync(thumbPath) ? thumbPath : null);
    });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

exports.listSamples = (req, res) => {
  try {
    const samples = scanSamples();
    res.json({ samples });
  } catch (err) {
    console.error('listSamples error:', err.message);
    res.status(500).json({ error: 'Failed to list style samples' });
  }
};

exports.getThumbnail = async (req, res) => {
  try {
    const { id } = req.params;
    const safeId = path.basename(id);
    const videoPath = path.join(SAMPLE_REELS_DIR, safeId);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Sample not found' });
    }
    const ext = path.extname(safeId);
    const thumbPath = path.join(SAMPLE_REELS_DIR, path.basename(safeId, ext) + '.thumb.jpg');
    const thumb = await ensureThumbnail(videoPath, thumbPath);
    if (!thumb) return res.status(500).json({ error: 'Failed to generate thumbnail' });
    res.sendFile(thumb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const safeId = path.basename(id);
    const videoPath = path.join(SAMPLE_REELS_DIR, safeId);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Sample not found' });
    }
    const profile = await styleAnalysisService.getOrAnalyze(videoPath);
    res.json({ id: safeId, filename: safeId, profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
