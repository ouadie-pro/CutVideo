require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const analyzeRoutes = require('./routes/analyze');
const cutRoutes = require('./routes/cut');
const reelsRoutes = require('./routes/reels');
const referenceReelsRoutes = require('./routes/referenceReels');
const aiAssistantClient = require('./services/aiAssistantClient');

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.stack);
});

const app = express();
const PORT = process.env.PORT || 5000;

const tempDir = path.resolve(__dirname, process.env.TEMP_DIR || './temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Ensure ffprobe exists next to ffmpeg-static so yt-dlp can find it
try {
  const ffmpegStaticPath = require('ffmpeg-static');
  const ffprobeStatic = require('ffprobe-static');
  if (ffmpegStaticPath && ffprobeStatic && ffprobeStatic.path) {
    const ffmpegDir = path.dirname(ffmpegStaticPath);
    const ffprobeDest = path.join(ffmpegDir, 'ffprobe.exe');
    if (!fs.existsSync(ffprobeDest) && fs.existsSync(ffprobeStatic.path)) {
      fs.copyFileSync(ffprobeStatic.path, ffprobeDest);
      console.log(`Copied ffprobe to ffmpeg-static directory: ${ffprobeDest}`);
    }
  }
} catch (e) {
  console.warn('Could not copy ffprobe to ffmpeg-static directory:', e.message);
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api', analyzeRoutes);
app.use('/api', cutRoutes);
app.use('/api', reelsRoutes);
app.use('/api', referenceReelsRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

aiAssistantClient.startService();

process.on('exit', () => aiAssistantClient.stopService());
process.on('SIGINT', () => { aiAssistantClient.stopService(); process.exit(0); });
process.on('SIGTERM', () => { aiAssistantClient.stopService(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`CutVideo backend running on http://localhost:${PORT}`);
});
