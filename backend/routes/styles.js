const express = require('express');
const router = express.Router();
const stylesController = require('../controllers/stylesController');

router.get('/styles/samples', stylesController.listSamples);
router.get('/styles/samples/:id/thumbnail', stylesController.getThumbnail);
router.get('/styles/samples/:id/profile', stylesController.getProfile);

module.exports = router;
