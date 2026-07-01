import { useState, useCallback } from 'react';
import { analyzeVideo } from '../services/api';

export function useVideoAnalyzer() {
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [error, setError] = useState(null);

  const analyze = useCallback(async (url) => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setVideoInfo(null);
    try {
      const info = await analyzeVideo(url);
      setVideoInfo(info);
      return info;
    } catch (err) {
      const message =
        err.response?.data?.error ||
        'Failed to analyze video. Please check the URL and try again.';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setVideoInfo(null);
    setError(null);
    setLoading(false);
  }, []);

  return { analyze, loading, videoInfo, error, setError, reset };
}
