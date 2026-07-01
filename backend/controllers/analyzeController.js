const youtubeService = require('../services/youtubeService');
const { validateYouTubeUrl } = require('../utils/validators');

exports.analyze = async (req, res, next) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    if (!validateYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL format' });
    }

    const info = await youtubeService.getVideoInfo(url.trim());

    const seen = new Set();
    const qualities = [];
    for (const f of info.formats) {
      if (f.height && !seen.has(f.height)) {
        seen.add(f.height);
        qualities.push(`${f.height}p`);
      }
    }
    qualities.sort((a, b) => parseInt(b) - parseInt(a));

    const videoId = extractVideoId(url);

    res.json({
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      author: info.author,
      availableQualities: qualities,
      durationSeconds: info.duration,
      videoId
    });
  } catch (error) {
    if (error.message.includes('Private video') ||
        error.message.includes('private')) {
      return res.status(400).json({ error: 'This video is private' });
    }
    if (error.message.includes('unavailable') ||
        error.message.includes('not found')) {
      return res.status(400).json({ error: 'This video is unavailable' });
    }
    console.error('Analyze error:', error.message);
    res.status(500).json({ error: 'Failed to analyze video. Please try again.' });
  }
};

function extractVideoId(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}
