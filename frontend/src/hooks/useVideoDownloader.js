import { useState, useCallback, useRef } from 'react';
import { startCutJob, getCutStatus, downloadCutFile } from '../services/api';

export function useVideoDownloader() {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const pollingRef = useRef(null);
  const abortRef = useRef(false);

  const download = useCallback(async (url, start, end, quality) => {
    setState('processing');
    setProgress(0);
    setError(null);
    setSuccess(null);
    setStep('Preparing...');
    abortRef.current = false;

    try {
      const { jobId } = await startCutJob(url, start, end, quality);

      const status = await pollStatus(jobId);
      if (abortRef.current) return;

      setStep('Downloading file...');

      const response = await downloadCutFile(jobId, (progressEvent) => {
        if (progressEvent.total) {
          const pct = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          setProgress(Math.min(90 + Math.round(pct * 0.1), 99));
        }
      });

      if (abortRef.current) return;

      const blob = response.data;
      const contentDisposition = response.headers?.['content-disposition'];
      let filename = 'cutvideo.mp4';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+?)"?$/);
        if (match) filename = match[1];
      }

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);

      setProgress(100);
      setStep('Complete!');
      setState('complete');
      const successData = { filename, url, start, end, quality, timestamp: Date.now() };
      setSuccess(successData);
      saveToHistory(successData);
    } catch (err) {
      if (abortRef.current) return;
      const message = err.response?.data?.error || 'Download failed. Please try again.';
      setError(message);
      setState('error');
    }
  }, []);

  async function pollStatus(jobId) {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await getCutStatus(jobId);
          setProgress(status.progress);
          const stepLabel = status.step
            ? status.step.charAt(0).toUpperCase() + status.step.slice(1) + '...'
            : 'Processing...';
          setStep(stepLabel);

          if (status.status === 'ready') {
            resolve(status);
          } else if (status.status === 'error') {
            reject(new Error(status.error || 'Processing failed'));
          } else if (abortRef.current) {
            reject(new Error('Cancelled'));
          } else {
            pollingRef.current = setTimeout(poll, 500);
          }
        } catch (err) {
          reject(err);
        }
      };
      poll();
    });
  }

  const cancel = useCallback(() => {
    abortRef.current = true;
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    setState('idle');
    setProgress(0);
    setStep('');
  }, []);

  const reset = useCallback(() => {
    cancel();
    setError(null);
    setSuccess(null);
  }, [cancel]);

  return { download, cancel, reset, state, progress, step, error, success, setError };
}

function saveToHistory(item) {
  try {
    const history = JSON.parse(localStorage.getItem('cutvideo_history') || '[]');
    history.unshift(item);
    if (history.length > 20) history.pop();
    localStorage.setItem('cutvideo_history', JSON.stringify(history));
  } catch {
    console.warn('Failed to save download history');
  }
}
