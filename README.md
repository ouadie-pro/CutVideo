# CutVideo

Cut YouTube videos and generate AI-powered short-form reels directly from your browser.

## Features

- Paste any YouTube URL to analyze available formats
- Select start and end times via slider or manual input
- Choose from available video qualities
- Download only the trimmed clip
- **Auto Shorts/Reels Generator** — automatically creates multiple vertical (9:16) reels from any YouTube video with smart highlight detection, scene analysis, and AI-powered selection
- **Reference Reel Style Matching** — generate reels that match the editing style of a reference video (pacing, cut density, audio energy)
- **Transcription** — speech-to-text via local faster-whisper or OpenAI Whisper API
- **AI Highlight Selection** — optional LLM-based highlight ranking via OpenAI GPT or Ollama
- **Smart Crop** — face-tracking center crop using OpenCV Haar cascade (Python)
- **Auto Captions** — burns ASS subtitle files into reels
- **Ken Burns effect** — slow zoom on low-motion segments
- **Loudness normalization** — EBU R128 loudnorm filter
- **Download as ZIP** bundle or individual MP4 files
- Drag & drop URL support
- Recent downloads history (stored locally)
- Copy video information to clipboard
- Dark mode UI with responsive design

## Prerequisites

- **Node.js** 18+
- **FFmpeg** (bundled via `ffmpeg-static`; also checked on PATH as fallback)
- **yt-dlp** (bundled via `yt-dlp-exec`; also checked on PATH and Python Scripts as fallback)
- **Python 3.8+** (optional) — required for face-tracking smart crop and local faster-whisper transcription

### Installing FFmpeg (if not using bundled version)

- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH, or use `winget install FFmpeg`
- **macOS**: `brew install ffmpeg`
- **Linux**: `sudo apt install ffmpeg` (Ubuntu/Debian) or `sudo dnf install ffmpeg` (Fedora)

### Installing yt-dlp (if not using bundled version)

- **Windows**: `winget install yt-dlp` or download from [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)
- **macOS**: `brew install yt-dlp`
- **Linux**: `sudo apt install yt-dlp` or `sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp`

### Installing Python Dependencies (optional)

Required only if using face-tracking smart crop or local faster-whisper transcription:

```bash
cd backend/python
pip install -r requirements.txt
```

See [Python Dependencies](#python-dependencies) for details.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd CutVideo

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

## Configuration

Copy the example environment file and edit it:

```bash
cd backend
cp .env.example .env
```

Available environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | API server port |
| `TEMP_DIR` | `./temp` | Working directory for downloads and processing |
| `TRANSCRIPTION_PROVIDER` | `local` | Transcription engine: `local` (faster-whisper), `openai` (Whisper API), or `none` |
| `WHISPER_MODEL` | `base` | faster-whisper model size: `tiny`, `base`, `small`, `medium`, `large-v3` |
| `TRANSCRIBE_MODEL` | `whisper-1` | OpenAI transcription model name |
| `OPENAI_API_KEY` | — | Required for OpenAI transcription and AI highlight selection |
| `LLM_PROVIDER` | `none` | AI highlight provider: `openai`, `ollama`, or `none` |
| `HIGHLIGHT_AI_MODEL` | `gpt-4o-mini` | OpenAI model for highlight selection |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.1` | Ollama model for highlight selection |
| `ENABLE_AI_HIGHLIGHTS` | `true` | Master toggle for AI highlight selection |

## Running the Application

### Start the backend

```bash
cd backend
npm start
```

For development with auto-restart:

```bash
cd backend
npm run dev
```

The API server runs on `http://localhost:5000`.

### Start the frontend

```bash
cd frontend
npm run dev
```

The development server runs on `http://localhost:3000` and automatically proxies API requests to the backend.

### Production Build

```bash
cd frontend
npm run build
```

Serve the `dist/` folder with any static server or configure the backend to serve it.

## API Documentation

### Analysis

#### POST /api/analyze

Analyze a YouTube video and get available formats.

**Request Body:**

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**

```json
{
  "title": "Video Title",
  "duration": 300,
  "thumbnail": "https://i.ytimg.com/vi/.../maxresdefault.jpg",
  "author": "Channel Name",
  "availableQualities": ["1080p", "720p", "480p", "360p"],
  "durationSeconds": 300,
  "videoId": "VIDEO_ID"
}
```

### Cut (Trim)

#### POST /api/cut

Start a cut job. Returns a `jobId` for status polling.

**Request Body:**

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "start": "00:01:20",
  "end": "00:02:45",
  "quality": "720p"
}
```

**Response:**

```json
{
  "jobId": "uuid-string"
}
```

#### GET /api/cut/status/:jobId

Poll the status of a cut job.

**Response:**

```json
{
  "status": "downloading",
  "progress": 35,
  "step": "downloading",
  "error": null
}
```

Possible statuses: `queued`, `downloading`, `ready`, `error`

The `step` field provides more detail (e.g. `downloading`, `cutting`, `finishing`, `ready`).

#### GET /api/cut/download/:jobId

Download the processed clip when status is `ready`. Returns the MP4 file.

### Reels (Auto Shorts Generator)

#### POST /api/reels/generate

Start a reels generation job. Returns a `jobId` for status polling.

**Request Body:**

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "count": 5,
  "duration": 30,
  "quality": "1080p",
  "captions": true,
  "smartCrop": true
}
```

- `count` — Number of reels to generate (1–20)
- `duration` — Length of each reel in seconds (15, 30, 45, or 60)
- `captions` — Enable auto-generated ASS captions (optional, default false)
- `smartCrop` — Enable face-tracking smart crop (optional, default false)

**Response:**

```json
{
  "jobId": "uuid-string"
}
```

#### POST /api/reels/generate-with-reference

Start a reels generation job styled after a reference video.

**Request Body:**

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "count": 5,
  "duration": 30,
  "quality": "1080p",
  "referenceFilename": "WhatsApp Video 2026-07-02 at 14.43.05.mp4",
  "captions": true,
  "smartCrop": true
}
```

**Response:**

```json
{
  "jobId": "uuid-string",
  "referenceAnalysis": { ... },
  "referenceReel": { "filename": "...", "path": "..." }
}
```

#### GET /api/reels/status/:jobId

Poll the status of a reels generation job.

**Response:**

```json
{
  "status": "downloading",
  "progress": 35,
  "step": "analyzing video",
  "error": null,
  "errorDetails": null,
  "hasZip": false,
  "reels": []
}
```

When processing is complete, `reels` contains the generated reel metadata:

```json
{
  "status": "ready",
  "progress": 100,
  "step": "finished",
  "error": null,
  "errorDetails": null,
  "hasZip": true,
  "reels": [
    {
      "index": 1,
      "filename": "reel_1.mp4",
      "startTime": 42.5,
      "hasThumbnail": true,
      "title": "Best moment"
    }
  ]
}
```

Possible statuses: `queued`, `downloading`, `ready`, `error`

The `step` field provides more detail (e.g. `downloading`, `analyzing video`, `transcribing`, `selecting highlights with AI`, `smart cropping`, `compressing`, `finished`).

#### GET /api/reels/download/:jobId

Download all reels as a ZIP file (or a single MP4 if only one reel was generated).

#### GET /api/reels/download/:jobId/:index

Download a single reel by its 1-based index. Returns the MP4 file.

#### GET /api/reels/thumbnail/:jobId/:index

Get a reel's thumbnail image. Returns a JPEG.

### Reference Reels

#### GET /api/reference-reels/list

List all available reference reel video files in `backend/reelsSpeed/`.

**Response:**

```json
{
  "reels": [
    {
      "filename": "WhatsApp Video 2026-07-02 at 14.43.05.mp4",
      "size": 5242880,
      "mtimeMs": 1700000000000,
      "hasThumbnail": true,
      "hasAnalysis": true
    }
  ]
}
```

#### GET /api/reference-reels/analyze/:filename

Analyze a reference reel and return its editing style profile (cached on disk).

**Response:**

```json
{
  "filename": "WhatsApp Video 2026-07-02 at 14.43.05.mp4",
  "totalDuration": 30.0,
  "width": 1920,
  "height": 1080,
  "aspectRatio": "16:9",
  "aspectTag": "landscape",
  "avgShotDuration": 3.2,
  "shotDurations": [2.1, 4.5, 3.0],
  "cutsFrequency": 0.31,
  "editSpeed": "fast",
  "pacing": "fast",
  "movementIntensity": "high",
  "sceneCount": 10,
  "silenceRatio": 0.05,
  "audioEnergy": 0.75,
  "brightness": 0.6,
  "contrast": 0.5,
  "saturation": 0.4,
  "hasAudio": true,
  "thumbnail": "path/to/thumbnail.jpg",
  "analyzedAt": 1700000000000
}
```

#### GET /api/reference-reels/thumbnail/:filename

Serve a reference reel's thumbnail image. Returns a JPEG.

#### GET /api/reference-reels/video/:filename

Serve a reference reel video file for in-browser preview.

## Reel Generation Pipeline

When a reels generation job runs, it follows this pipeline:

1. **Download** — Video is downloaded via yt-dlp at the requested quality
2. **Validation** — Source video is checked for minimum file size, duration (≥5s), resolution (smallest dimension ≥360px), disk space, and FFmpeg/FFprobe availability
3. **Analysis** — Four parallel FFmpeg passes run:
   - **Scene detection** (`select='gt(scene,0.3)'`) — identifies shot boundaries
   - **Silence detection** (`silencedetect`) — maps quiet intervals
   - **Motion scoring** — per-frame scene change scores
   - **Audio beat detection** (`astats` RMS energy peaks)
4. **Transcription** — Audio is extracted and transcribed via faster-whisper (local) or OpenAI Whisper API
5. **Highlight Selection** — Candidates are scored and ranked using:
   - Heuristic scoring: scene density, motion level, beat synchronicity, silence penalty, center bias, and optional style profile
   - Lexical transcript bonus: engagement words, punctuation density, ALL-CAPS segments
   - **Optional AI scoring**: transcript is sent to an LLM (OpenAI GPT or Ollama) for intelligent highlight ranking
6. **Smart Crop** (optional) — Python OpenCV script tracks the largest face across frames and computes a smoothed crop path
7. **Encoding** — Each selected highlight is encoded as a vertical 9:16 MP4 with:
   - Scale and crop (smart crop or center crop)
   - Ken Burns slow zoom (on low-motion segments)
   - ASS caption burn-in (if enabled)
   - EBU R128 loudness normalization
   - Thumbnail extraction (JPEG)
8. **Packaging** — Individual reels are saved; if count > 1, a ZIP archive is created

## Reference Reels

Place video files in `backend/reelsSpeed/` to use them as style references. The system analyzes each reference to extract:

- **Shot durations** — average and distribution of scene lengths
- **Cut frequency** — cuts per second
- **Edit speed** — classified as slow / moderate / fast
- **Audio energy** — RMS energy profile
- **Motion intensity** — average scene change score
- **Silence ratio** — proportion of audio below threshold
- **Brightness & contrast** — per-frame luma statistics

When generating reels "with reference," the system matches the target video's highlight selection to the reference's editing style — choosing clips that match the reference's pacing, cut density, and energy profile. Analysis results are cached in `.reference_cache.json`.

## AI Providers

### Transcription

| Provider | Setting | Model | Requirements |
|----------|---------|-------|-------------|
| Local (faster-whisper) | `TRANSCRIPTION_PROVIDER=local` | tiny / base / small / medium / large-v3 | Python 3.8+, `pip install -r requirements.txt`, significant RAM for large models |
| OpenAI Whisper API | `TRANSCRIPTION_PROVIDER=openai` | configurable via `TRANSCRIBE_MODEL` | `OPENAI_API_KEY` set, internet access |
| None | `TRANSCRIPTION_PROVIDER=none` | — | Disables transcript-dependent features |

### AI Highlight Selection

| Provider | Setting | Model | Requirements |
|----------|---------|-------|-------------|
| OpenAI | `LLM_PROVIDER=openai` | configurable via `HIGHLIGHT_AI_MODEL` (default `gpt-4o-mini`) | `OPENAI_API_KEY` set, internet access |
| Ollama | `LLM_PROVIDER=ollama` | configurable via `OLLAMA_MODEL` (default `llama3.1`) | Ollama server running at `OLLAMA_BASE_URL` |
| None | `LLM_PROVIDER=none` | — | Uses heuristic scoring only |

The `ENABLE_AI_HIGHLIGHTS=false` toggle disables all AI highlight selection regardless of provider.

## Python Dependencies

Optional Python helpers are located in `backend/python/`:

| Script | Purpose | Dependencies |
|--------|---------|-------------|
| `smart_crop.py` | Face-tracking crop path via OpenCV Haar cascade | `opencv-python`, `numpy` |
| `transcribe.py` | Speech-to-text via faster-whisper | `faster-whisper`, `numpy` |

Install with:

```bash
cd backend/python
pip install -r requirements.txt
```

If Python or the required packages are not installed, the backend gracefully falls back:
- Smart crop → fixed center crop (1080×1920)
- Transcription → OpenAI Whisper API (if configured) or no captions

## Job Lifecycle

Both cut and reels endpoints use an asynchronous job queue pattern:

1. **Creation** — The endpoint creates a job with a unique UUID, stores it in an in-memory `Map`, and returns the `jobId` immediately
2. **Processing** — The job runs in the background; the frontend polls the status endpoint every 500ms
3. **Completion** — When processing finishes, the job status changes to `ready` and the output file(s) become available for download
4. **Expiration** — Jobs are automatically cleaned up:
   - Cut jobs: expire after 30 minutes of inactivity
   - Reels jobs: expire after 60 minutes of inactivity
   - Cleanup runs every 5 minutes

**Note**: Job state is stored in memory. Restarting the server clears all pending jobs. The `temp/` directory is used for all intermediate files and is cleaned up on job expiration.

## Error Handling

The API returns appropriate HTTP status codes:

- `400` — Invalid input (bad URL, time range errors, private/unavailable videos)
- `404` — Job not found or file expired
- `500` — Internal server error, download failure, FFmpeg or FFprobe errors

Common job error messages include:
- Video resolution too low / too short
- YouTube age-restricted / private / unavailable / geo-restricted content
- FFmpeg or FFprobe not found
- Insufficient disk space
- Download timeouts

## Architecture

```
CutVideo/
├── backend/
│   ├── server.js                 Express app entry point
│   ├── routes/                   API route definitions
│   │   ├── analyze.js            POST /api/analyze
│   │   ├── cut.js                POST /api/cut + status/download
│   │   ├── reels.js              Reels generation endpoints
│   │   └── referenceReels.js     Reference reel CRUD endpoints
│   ├── controllers/              Request handlers
│   │   ├── analyzeController.js
│   │   ├── cutController.js
│   │   └── reelsController.js
│   ├── services/                 Business logic
│   │   ├── youtubeService.js     yt-dlp / ytdl-core video download + info
│   │   ├── ffmpegService.js      FFmpeg trimming
│   │   ├── reelsService.js       Reels engine: scene detection, highlight scoring, encoding
│   │   ├── referenceReelsService.js  Reference analysis + caching
│   │   ├── transcriptionService.js   Speech-to-text (faster-whisper / OpenAI)
│   │   ├── highlightAIService.js     LLM highlight selection (OpenAI / Ollama)
│   │   ├── lexicalHighlightService.js  Keyword-based transcript scoring
│   │   ├── smartCropService.js       Python OpenCV face-tracking integration
│   │   └── captionService.js         ASS subtitle generation
│   ├── utils/
│   │   ├── validators.js         URL, time range, quality validation
│   │   └── cleanup.js            Async file/directory cleanup
│   ├── python/                   Optional Python helpers
│   │   ├── smart_crop.py         OpenCV face tracking → JSON crop path
│   │   ├── transcribe.py         faster-whisper transcription → JSON segments
│   │   └── requirements.txt
│   ├── reelsSpeed/               Reference reel video files
│   │   └── .thumbs/              Cached thumbnails
│   ├── temp/                     Working directory (downloads, reels, zips)
│   └── view/                     Test viewing pages (development)
├── frontend/
│   ├── src/
│   │   ├── components/           Reusable UI components
│   │   ├── pages/                Page components
│   │   ├── hooks/                Custom React hooks (useVideoAnalyzer, useReelsGenerator, etc.)
│   │   └── services/             API client (Axios)
│   └── vite.config.js            Vite configuration with /api proxy
├── backendsample-reels/          Placeholder for sample reference reels
└── README.md
```

The backend uses **yt-dlp** (bundled via `yt-dlp-exec`) as the primary engine for downloading and analyzing YouTube videos, with an automatic fallback to **@distube/ytdl-core**. **FFmpeg** (bundled via `ffmpeg-static`) handles video trimming, scene detection, audio analysis, encoding, and caption burning. Optional **Python** scripts provide face-tracking smart crop and local speech-to-text transcription.
