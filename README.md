# CutVideo

Cut and download any YouTube video clip directly from your browser.

## Features

- Paste any YouTube URL to analyze available formats
- Select start and end times via slider or manual input
- Choose from available video qualities
- Download only the trimmed clip
- Drag & drop URL support
- Recent downloads history (stored locally)
- Copy video information to clipboard
- Dark mode UI with responsive design

## Prerequisites

- **Node.js** 18+
- **FFmpeg** installed and available in PATH
- **yt-dlp** (recommended) - OR falls back to ytdl-core automatically

### Installing FFmpeg

- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH, or use `winget install FFmpeg`
- **macOS**: `brew install ffmpeg`
- **Linux**: `sudo apt install ffmpeg` (Ubuntu/Debian) or `sudo dnf install ffmpeg` (Fedora)

### Installing yt-dlp (Recommended)

- **Windows**: `winget install yt-dlp` or download from [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)
- **macOS**: `brew install yt-dlp`
- **Linux**: `sudo apt install yt-dlp` or `sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp`

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

Create a `.env` file in the `backend/` directory (a default is provided):

```
PORT=5000
```

## Running the Application

### Start the backend

```bash
cd backend
npm start
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

### POST /api/analyze

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

### POST /api/cut

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

### GET /api/cut/status/:jobId

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

Possible statuses: `queued`, `downloading`, `cutting`, `finishing`, `ready`, `error`

### GET /api/cut/download/:jobId

Download the processed clip when status is `ready`. Returns the MP4 file.

## Error Handling

The API returns appropriate HTTP status codes:

- `400` - Invalid input (bad URL, time range errors, private/unavailable videos)
- `404` - Job not found or file expired
- `500` - Internal server error

## Architecture

```
CutVideo/
├── backend/
│   ├── server.js            Express app entry point
│   ├── routes/              API route definitions
│   ├── controllers/         Request handlers
│   ├── services/            Business logic (YouTube, FFmpeg)
│   └── utils/               Validators and cleanup utilities
├── frontend/
│   ├── src/
│   │   ├── components/      Reusable UI components
│   │   ├── pages/           Page components
│   │   ├── hooks/           Custom React hooks
│   │   └── services/        API client (Axios)
│   └── vite.config.js       Vite configuration with proxy
└── README.md
```

The backend uses **yt-dlp** as the primary engine for downloading and analyzing YouTube videos. If yt-dlp is not installed, it automatically falls back to **ytdl-core**. **FFmpeg** is used exclusively for trimming operations.
