const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let ytDlpAvailable = null;
let ytDlpExecPath = null;

function checkYtDlp() {
  if (ytDlpAvailable !== null) return ytDlpAvailable;
  try {
    const ytDlpExec = require('yt-dlp-exec');
    const binaryMatch = ytDlpExec.exec.toString().match(/'([^']*yt-dlp\.exe)'/);
    if (binaryMatch) {
      ytDlpExecPath = binaryMatch[1];
    } else {
      ytDlpExecPath = path.resolve(__dirname, '..', 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe');
    }
    execSync(`"${ytDlpExecPath}" --version`, { stdio: 'pipe', timeout: 5000 });
    ytDlpAvailable = true;
    console.log('Using yt-dlp engine (via yt-dlp-exec)');
    return ytDlpAvailable;
  } catch {
    ytDlpExecPath = null;
  }
  try {
    execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 });
    ytDlpAvailable = true;
    ytDlpExecPath = 'yt-dlp';
    console.log('Using yt-dlp engine');
  } catch {
    ytDlpAvailable = false;
    try {
      execSync('yt-dlp.exe --version', { stdio: 'pipe', timeout: 5000 });
      ytDlpAvailable = true;
      ytDlpExecPath = 'yt-dlp.exe';
      console.log('Using yt-dlp engine (exe)');
    } catch {
      try {
        const scriptsDir = execSync(
          'python -c "import sys,os; print(os.path.join(sys.base_exec_prefix,\'Scripts\'))"',
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        const ytDlpPath = path.join(scriptsDir, 'yt-dlp.exe');
        execSync(`"${ytDlpPath}" --version`, { stdio: 'pipe', timeout: 5000 });
        ytDlpExecPath = ytDlpPath;
        process.env.PATH = scriptsDir + path.delimiter + (process.env.PATH || '');
        ytDlpAvailable = true;
        console.log('Using yt-dlp engine (via Python Scripts)');
      } catch {
        console.log('yt-dlp not found, will use ytdl-core fallback');
      }
    }
  }
  return ytDlpAvailable;
}

function getYtDlpVersionString() {
  try {
    const cmd = ytDlpExecPath || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    return execSync(`"${cmd}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

function checkNodeJsRuntime() {
  try {
    execSync('node --version', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function parseYtDlpErrors(stderr) {
  const patterns = [
    { pattern: /HTTP Error 403/i, message: 'Access forbidden (HTTP 403). The video may be restricted.' },
    { pattern: /HTTP Error 429/i, message: 'Too many requests (HTTP 429). Please wait before trying again.' },
    { pattern: /HTTP Error 4\d{2}/i, message: 'HTTP request failed. The video may be unavailable.' },
    { pattern: /Sign in to confirm your age/i, message: 'This video is age-restricted and cannot be downloaded.' },
    { pattern: /age-?restricted/i, message: 'This video is age-restricted and cannot be downloaded.' },
    { pattern: /private video/i, message: 'This video is private.' },
    { pattern: /[Uu]navailable/i, message: 'This video is unavailable.' },
    { pattern: /[Gg]eo[ -]?restricted/i, message: 'This video is geo-restricted and not available in your region.' },
    { pattern: /not available in your country/i, message: 'This video is geo-restricted and not available in your region.' },
    { pattern: /[js]c.*challenge.*(failed|skip)/i, message: 'YouTube JavaScript challenge could not be solved. Try updating yt-dlp.' },
    { pattern: /signature extraction failed/i, message: 'Failed to extract video signature. Try updating yt-dlp.' },
    { pattern: /is live/i, message: 'This video is a live stream. Partial clip downloads are not supported for live content.' },
    { pattern: /requested format is not available/i, message: 'The requested video quality is not available for this video.' }
  ];
  for (const { pattern, message } of patterns) {
    if (pattern.test(stderr)) {
      return message;
    }
  }
  return null;
}

function resolveFfmpegPath() {
  try {
    const ffmpegPath = require('ffmpeg-static');
    const exists = ffmpegPath && fs.existsSync(ffmpegPath);

    if (ffmpegPath) {
      const stat = fs.statSync(ffmpegPath);
      console.log('FFmpeg detection:');
      console.log(`  path: ${ffmpegPath}`);
      console.log(`  exists: ${exists}`);
      console.log(`  size: ${stat.size}`);
      console.log(`  isFile: ${stat.isFile()}`);
    }

    if (!ffmpegPath || !exists) {
      console.log('FFmpeg detection: binary not found at', ffmpegPath);
      return null;
    }

    console.log(`  --ffmpeg-location value: ${ffmpegPath}`);
    return ffmpegPath;
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('FFmpeg detection: ffmpeg-static module not found');
      return null;
    }
    throw error;
  }
}

async function getVideoInfo(url) {
  if (checkYtDlp()) {
    return getInfoWithYtDlp(url);
  }
  return getInfoWithYtdlCore(url);
}

async function getInfoWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    checkYtDlp();
    const cmd = ytDlpExecPath || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    const hasNode = checkNodeJsRuntime();
    const jsRuntimeArgs = hasNode ? ['--js-runtimes', 'node'] : [];

    const args = [
      '--dump-json',
      '--no-playlist',
      '--skip-download',
      '--extractor-retries', '3',
      ...jsRuntimeArgs,
      url
    ];

    const ffmpegPath = resolveFfmpegPath();
    if (ffmpegPath) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    console.log(`Executing: "${cmd}" ${args.join(' ')}`);

    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (stderr.trim()) {
        console.warn(`yt-dlp stderr (getInfo): ${stderr.trim()}`);
      }

      if (code !== 0 || !stdout) {
        const friendlyError = parseYtDlpErrors(stderr);
        const errMsg = (stderr || stdout || 'Unknown error').slice(0, 500).trim();
        reject(new Error(friendlyError || `Failed to get video info: ${errMsg}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);

        const formats = (data.formats || []).map(f => ({
          height: f.height,
          format_id: f.format_id,
          ext: f.ext,
          vcodec: f.vcodec,
          acodec: f.acodec,
          filesize: f.filesize
        }));

        resolve({
          title: data.title || 'Unknown',
          duration: data.duration || 0,
          thumbnail: data.thumbnail || '',
          author: data.uploader || data.uploader_id || data.channel || 'Unknown',
          formats,
          isLive: !!data.is_live,
          wasLive: !!data.was_live
        });
      } catch (parseError) {
        reject(new Error('Failed to parse video info from yt-dlp output'));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp error: ${err.message}`));
    });
  });
}

async function getInfoWithYtdlCore(url) {
  try {
    const ytdl = require('@distube/ytdl-core');
    const info = await ytdl.getInfo(url);

    const formats = (info.formats || []).map(f => ({
      height: f.height || (f.qualityLabel ? parseInt(f.qualityLabel) : null),
      format_id: f.itag,
      ext: f.container,
      vcodec: f.vcodec,
      acodec: f.acodec,
      filesize: f.contentLength ? parseInt(f.contentLength) : null
    }));

    return {
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds) || 0,
      thumbnail: info.videoDetails.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || '',
      author: info.videoDetails.ownerChannelName || info.videoDetails.author?.name || 'Unknown',
      formats
    };
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('private')) {
      throw new Error('Private video');
    }
    if (error.message && (error.message.includes('unavailable') || error.message.includes('not found'))) {
      throw new Error('This video is unavailable');
    }
    throw new Error(`Failed to get video info: ${error.message}`);
  }
}

async function downloadVideo(url, quality, outputPath, onProgress, startTime, endTime) {
  if (checkYtDlp()) {
    return downloadWithYtDlp(url, quality, outputPath, onProgress, startTime, endTime);
  }
  return downloadWithYtdlCore(url, quality, outputPath, onProgress, startTime, endTime);
}

async function downloadWithYtDlp(url, quality, outputPath, onProgress, startTime, endTime) {
  return new Promise((resolve, reject) => {
    checkYtDlp();
    const cmd = ytDlpExecPath || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    const height = parseInt(quality) || 0;
    const formatStr = height > 0
      ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`
      : 'best';

    const hasNode = checkNodeJsRuntime();
    const jsRuntimeArgs = hasNode ? ['--js-runtimes', 'node'] : [];

    const args = [
      '-f', formatStr,
      '-o', outputPath,
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--extractor-retries', '3',
      '--newline',
      '--progress',
      '--no-color',
      '--progress-template', 'download:%(progress.status)s - %(progress.downloaded_bytes)s/%(progress.total_bytes)s - %(progress.percent)s',
      ...jsRuntimeArgs,
      url
    ];

    const ffmpegPath = resolveFfmpegPath();
    if (ffmpegPath) {
      args.push('--ffmpeg-location', ffmpegPath);
    } else {
      const err = new Error('FFmpeg not found. The project requires FFmpeg for video processing. Please ensure ffmpeg-static is properly installed.');
      console.error(err.message);
      return reject(err);
    }

    if (startTime && endTime) {
      try {
        const infoOutput = execSync(
          `"${cmd}" --dump-json --no-playlist --skip-download ${jsRuntimeArgs.length ? '--js-runtimes node' : ''} "${url}"`,
          { maxBuffer: 1024 * 1024, timeout: 15000, encoding: 'utf-8' }
        );
        const info = JSON.parse(infoOutput);
        if (info.is_live || info.was_live) {
          console.log(`Live stream detected for ${url}, skipping --download-sections`);
        } else {
          args.push('--download-sections', `*${startTime}-${endTime}`);
        }
      } catch (e) {
        console.warn(`Could not check video type for --download-sections: ${e.message}`);
      }
    }

    console.log(`Executing: "${cmd}" ${args.join(' ')}`);

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    };

    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: env,
      shell: false
    });
    let stderr = '';
    let stdout = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timeoutTimer = null;

    // Set a timeout to prevent hanging
    timeoutTimer = setTimeout(() => {
      proc.kill();
      reject(new Error('Download timeout after 5 minutes'));
    }, 5 * 60 * 1000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      console.log('[yt-dlp stdout chunk]:', text);
      stdout += text;
      stdoutBuffer += text;

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        // Try to match the new progress-template format first
        let match = line.match(/download:.*? - (\d+\.?\d*)%/);
        // Fallback to the old format
        if (!match) {
          match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        }
        if (match && onProgress) {
          console.log('[yt-dlp stdout progress]:', match[1]);
          onProgress(parseFloat(match[1]));
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      console.log('[yt-dlp stderr chunk]:', text);
      stderr += text;
      stderrBuffer += text;

      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        // Try to match the new progress-template format first
        let match = line.match(/download:.*? - (\d+\.?\d*)%/);
        // Fallback to the old format
        if (!match) {
          match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
        }
        if (match && onProgress) {
          console.log('[yt-dlp stderr progress]:', match[1]);
          onProgress(parseFloat(match[1]));
        }
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutTimer);

      if (stderr.trim()) {
        if (code === 0) {
          console.warn(`yt-dlp warnings for ${url}: ${stderr.trim()}`);
        } else {
          console.error(`yt-dlp errors for ${url}: ${stderr.trim()}`);
        }
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        const friendlyError = parseYtDlpErrors(stderr);
        const errMsg = friendlyError || (stderr + stdout).slice(-500).trim();
        reject(new Error(errMsg || `Download failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutTimer);
      reject(new Error(`yt-dlp error: ${err.message}`));
    });
  });
}

async function downloadWithYtdlCore(url, quality, outputPath, onProgress, startTime, endTime) {
  return new Promise((resolve, reject) => {
    try {
      const ytdl = require('@distube/ytdl-core');
      const options = { quality: 'highestvideo' };

      const stream = ytdl(url, options);
      const writeStream = fs.createWriteStream(outputPath);

      let downloaded = 0;
      stream.on('progress', (chunkLength, downloadedBytes, totalBytes) => {
        downloaded = downloadedBytes;
        if (totalBytes && onProgress) {
          onProgress((downloadedBytes / totalBytes) * 100);
        }
      });

      stream.pipe(writeStream);

      writeStream.on('finish', () => resolve(outputPath));
      writeStream.on('error', reject);
      stream.on('error', (err) => {
        reject(new Error(`ytdl-core: ${err.message}`));
      });
    } catch (error) {
      reject(new Error(`ytdl-core failed: ${error.message}`));
    }
  });
}

module.exports = { getVideoInfo, downloadVideo, checkYtDlp };
