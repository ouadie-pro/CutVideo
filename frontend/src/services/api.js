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

export default api;
