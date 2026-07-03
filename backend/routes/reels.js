const express = require('express');
const router = express.Router();
const reelsController = require('../controllers/reelsController');

router.post('/reels/generate', reelsController.generate);
router.post('/reels/generate-with-reference', reelsController.generateWithReference);
router.get('/reels/status/:jobId', reelsController.getStatus);
router.get('/reels/download/:jobId/:index', reelsController.downloadOne);
router.get('/reels/download/:jobId', reelsController.downloadAll);
router.get('/reels/thumbnail/:jobId/:index', reelsController.getThumbnail);

module.exports = router;
