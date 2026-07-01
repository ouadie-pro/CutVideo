import { useState } from 'react';
import UrlInput from '../components/UrlInput';
import VideoPreview from '../components/VideoPreview';
import TimeSelector from '../components/TimeSelector';
import QualitySelector from '../components/QualitySelector';
import DownloadButton from '../components/DownloadButton';
import ErrorAlert from '../components/ErrorAlert';
import RecentDownloads from '../components/RecentDownloads';
import { useVideoAnalyzer } from '../hooks/useVideoAnalyzer';
import { useVideoDownloader } from '../hooks/useVideoDownloader';
import './Home.css';

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Home() {
  const { analyze, loading, videoInfo, error: analyzeError, setError: setAnalyzeError, reset } = useVideoAnalyzer();
  const downloader = useVideoDownloader();
  const [url, setUrl] = useState('');
  const [startTime, setStartTime] = useState('00:00:00');
  const [endTime, setEndTime] = useState('00:00:10');
  const [quality, setQuality] = useState('');

  const handleAnalyze = async (inputUrl) => {
    setUrl(inputUrl);
    const info = await analyze(inputUrl);
    if (info) {
      const defaultEnd = Math.min(30, info.durationSeconds);
      setEndTime(formatTime(defaultEnd));
      if (info.availableQualities && info.availableQualities.length > 0) {
        setQuality(info.availableQualities[0]);
      }
    }
  };

  const handleDownload = () => {
    downloader.download(url, startTime, endTime, quality);
  };

  const handleTimeChange = (start, end) => {
    setStartTime(start);
    setEndTime(end);
  };

  const handleRecentSelect = (item) => {
    setUrl(item.url);
    setStartTime(item.start);
    setEndTime(item.end);
    setQuality(item.quality);
    if (item.url) handleAnalyze(item.url);
  };

  const displayError = analyzeError || downloader.error;

  return (
    <div className="home">
      <header className="home-header">
        <div className="logo">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <h1>CutVideo</h1>
        </div>
        <p className="tagline">Cut any YouTube video to the perfect moment</p>
      </header>

      <main className="home-main">
        <UrlInput
          onAnalyze={handleAnalyze}
          loading={loading}
          url={url}
          setUrl={setUrl}
        />

        {videoInfo && (
          <div className="video-section">
            <VideoPreview info={videoInfo} />

            <div className="controls-section">
              <TimeSelector
                duration={videoInfo.durationSeconds}
                startTime={startTime}
                endTime={endTime}
                onChange={handleTimeChange}
              />

              <QualitySelector
                qualities={videoInfo.availableQualities}
                value={quality}
                onChange={setQuality}
              />

              <DownloadButton
                state={downloader.state}
                progress={downloader.progress}
                step={downloader.step}
                onDownload={handleDownload}
                onCancel={downloader.cancel}
                onReset={downloader.reset}
                success={downloader.success}
              />
            </div>
          </div>
        )}

        <RecentDownloads onSelect={handleRecentSelect} />
      </main>

      {displayError && (
        <ErrorAlert message={displayError} onClose={() => {
          setAnalyzeError(null);
          downloader.setError(null);
        }} />
      )}
    </div>
  );
}
