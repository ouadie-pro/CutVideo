const express = require('express');
const router = express.Router();
const referenceReelsService = require('../services/referenceReelsService');
const path = require('path');

router.get('/reference-reels/list', (req, res) => {
  try {
    const refs = referenceReelsService.listReferences();
    res.json({ reels: refs });
  } catch (error) {
    console.error('List reference reels error:', error.message);
    res.status(500).json({ error: 'Failed to list reference reels' });
  }
});

router.get('/reference-reels/analyze/:filename', async (req, res) => {
  try {
    const analysis = await referenceReelsService.analyzeReference(req.params.filename);
    res.json(analysis);
  } catch (error) {
    console.error('Analyze reference reel error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to analyze reference reel' });
  }
});

router.get('/reference-reels/thumbnail/:filename', (req, res) => {
  try {
    const thumbPath = referenceReelsService.getThumbnailPath(req.params.filename);
    if (!thumbPath || !require('fs').existsSync(thumbPath)) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    res.sendFile(thumbPath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

router.get('/reference-reels/video/:filename', (req, res) => {
  try {
    const videoPath = referenceReelsService.getVideoPath(req.params.filename);
    if (!videoPath || !require('fs').existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video not found' });
    }
    res.sendFile(videoPath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get video' });
  }
});

module.exports = router;
