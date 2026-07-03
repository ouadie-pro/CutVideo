require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const analyzeRoutes = require('./routes/analyze');
const cutRoutes = require('./routes/cut');
const reelsRoutes = require('./routes/reels');
const referenceReelsRoutes = require('./routes/referenceReels');

const app = express();
const PORT = process.env.PORT || 5000;

const tempDir = path.resolve(__dirname, process.env.TEMP_DIR || './temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
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

app.listen(PORT, () => {
  console.log(`CutVideo backend running on http://localhost:${PORT}`);
});
