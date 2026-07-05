import { useState, useCallback, useRef, useEffect } from 'react';
import { startReelsJob, startReelsWithReference, getReelsStatus, downloadReelFile, downloadAllReels } from '../services/api';

const stepMap = {
  'downloading': 'Downloading...',
  'analyzing video': 'Analyzing...',
  'transcribing': 'Transcribing audio...',
  'selecting highlights with AI': 'Finding the best moments...',
  'smart cropping': 'Tracking the action...',
  'adding captions': 'Adding captions...',
  'polishing audio': 'Polishing audio...',
  'compressing': 'Compressing...',
  'finished': 'Finished.',
};

function mapStep(backendStep) {
  if (!backendStep) return 'Processing...';
  if (backendStep.startsWith('creating reel')) {
    const parts = backendStep.split(' ');
    const idx = parts[2];
    const total = parts[3] ? parts[3].split('/')[1] : '';
    return `Generating reel ${idx}/${total}...`;
  }
  return stepMap[backendStep] || backendStep;
}

export function useReelsGenerator() {
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [error, setError] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [reels, setReels] = useState([]);
  const [hasZip, setHasZip] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [referenceInfo, setReferenceInfo] = useState(null);
  const pollingRef = useRef(null);
  const abortRef = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  const generate = useCallback(async (url, count, reelDuration, quality, referenceFilename, captions = true, smartCrop = true, referenceAnalysis = null) => {
    setState('generating');
    setProgress(0);
    setError(null);
    setErrorDetails(null);
    setReels([]);
    setHasZip(false);
    setJobId(null);
    setReferenceInfo(null);
    setStep('Downloading...');
    abortRef.current = false;

    try {
      let result;
      if (referenceFilename) {
        result = await startReelsWithReference(url, count, reelDuration, quality, referenceFilename, referenceAnalysis);
        if (result.referenceReel) {
          setReferenceInfo(result.referenceReel);
        }
      } else {
        result = await startReelsJob(url, count, reelDuration, quality, captions, smartCrop);
      }

      const id = result.jobId;
      setJobId(id);
      if (abortRef.current) return;

      const status = await pollStatus(id);
      if (abortRef.current) return;

      setReels(status.reels || []);
      setHasZip(status.hasZip);
      setProgress(100);
      setStep('Finished.');
      setState('complete');
    } catch (err) {
      if (abortRef.current) return;
      const data = err.response?.data;
      const message = data?.error || data?.message || 'Reels generation failed. Please try again.';
      setError(message);
      if (data?.errorDetails) {
        setErrorDetails(data.errorDetails);
      }
      setState('error');
    }
  }, []);

  async function pollStatus(id) {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await getReelsStatus(id);
          setProgress(status.progress);
          setStep(mapStep(status.step));

          if (status.status === 'ready') {
            resolve(status);
          } else if (status.status === 'error') {
            const errMsg = status.errorDetails?.message || status.error || 'Generation failed';
            reject(new Error(errMsg));
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

  const downloadOne = useCallback(async (id, index) => {
    try {
      const response = await downloadReelFile(id, index);
      const blob = response.data;
      const contentDisposition = response.headers?.['content-disposition'];
      let filename = `reel_${index}.mp4`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+?)"?$/);
        if (match) filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Reel download failed:', err);
    }
  }, []);

  const downloadAll = useCallback(async (id) => {
    try {
      const response = await downloadAllReels(id);
      const blob = response.data;
      const contentDisposition = response.headers?.['content-disposition'];
      let filename = `reels_${id}.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+?)"?$/);
        if (match) filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download all failed:', err);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current = true;
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    setState('idle');
    setProgress(0);
    setStep('');
    setReels([]);
    setHasZip(false);
    setJobId(null);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setError(null);
    setErrorDetails(null);
  }, [cancel]);

  return { generate, downloadOne, downloadAll, cancel, reset, state, progress, step, error, errorDetails, reels, hasZip, jobId, referenceInfo, setError };
}

