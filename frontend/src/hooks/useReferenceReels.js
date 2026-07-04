import { useState, useCallback, useEffect, useRef } from 'react';
import { getReferenceReels, analyzeReferenceReel } from '../services/api';

export function useReferenceReels() {
  const [reels, setReels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchReels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReferenceReels();
      if (mountedRef.current) {
        setReels(data.reels || []);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError('Failed to load reference reels');
        console.error('useReferenceReels fetch error:', err);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  const selectReel = useCallback(async (filename) => {
    setSelected(filename);
    setAnalysis(null);
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeReferenceReel(filename);
      if (mountedRef.current) {
        setAnalysis(result);
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        setError('Failed to analyze reference reel');
        console.error('useReferenceReels analyze error:', err);
      }
    } finally {
      if (mountedRef.current) setAnalyzing(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setAnalysis(null);
  }, []);

  const refresh = useCallback(() => {
    fetchReels();
    clearSelection();
  }, [fetchReels, clearSelection]);

  const getMetricsSummary = useCallback((analysisResult) => {
    if (!analysisResult) return '';
    const parts = [];
    if (analysisResult.editSpeed) parts.push(`Edit: ${analysisResult.editSpeed}`);
    if (analysisResult.movementIntensity) parts.push(`Motion: ${analysisResult.movementIntensity}`);
    if (analysisResult.totalDuration) parts.push(`${Math.round(analysisResult.totalDuration)}s`);
    if (analysisResult.avgShotDuration) parts.push(`Avg cut: ${analysisResult.avgShotDuration.toFixed(1)}s`);
    if (analysisResult.sceneCount !== undefined) parts.push(`${analysisResult.sceneCount} cuts`);
    return parts.join(' | ');
  }, []);

  return {
    reels,
    selected,
    analysis,
    loading,
    analyzing,
    error,
    selectReel,
    clearSelection,
    refresh,
    getMetricsSummary,
    setError
  };
}
