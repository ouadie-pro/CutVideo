import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

export async function analyzeVideo(url) {
  const { data } = await api.post('/analyze', { url });
  return data;
}

export async function startCutJob(url, start, end, quality) {
  const { data } = await api.post('/cut', { url, start, end, quality });
  return data;
}

export async function getCutStatus(jobId) {
  const { data } = await api.get(`/cut/status/${jobId}`);
  return data;
}

export async function downloadCutFile(jobId, onProgress) {
  const response = await api.get(`/cut/download/${jobId}`, {
    responseType: 'blob',
    onDownloadProgress: onProgress
  });
  return response;
}

export async function startReelsJob(url, count, duration, quality) {
  const { data } = await api.post('/reels/generate', { url, count, duration, quality });
  return data;
}

export async function getReelsStatus(jobId) {
  const { data } = await api.get(`/reels/status/${jobId}`);
  return data;
}

export async function downloadReelFile(jobId, index) {
  const response = await api.get(`/reels/download/${jobId}/${index}`, {
    responseType: 'blob'
  });
  return response;
}

export async function downloadAllReels(jobId) {
  const response = await api.get(`/reels/download/${jobId}`, {
    responseType: 'blob'
  });
  return response;
}

export default api;
