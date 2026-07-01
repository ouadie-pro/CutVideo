const express = require('express');
const router = express.Router();
const cutController = require('../controllers/cutController');

router.post('/cut', cutController.startCut);
router.get('/cut/status/:jobId', cutController.getStatus);
router.get('/cut/download/:jobId', cutController.download);

module.exports = router;
