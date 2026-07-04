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

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { timeout: 5000 });
      console.log(`[yt-dlp] Killed process tree for PID ${pid}`);
    } else {
      try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
    }
  } catch (err) {
    console.error(`[yt-dlp] Failed to kill process tree for PID ${pid}: ${err.message}`);
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
      args.push('--ffmpeg-location', path.dirname(path.resolve(ffmpegPath)));
    }

    console.log(`Executing: "${cmd}" ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
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

    // ROOT CAUSE FIX: Use single-stream format to avoid FFmpeg merge hang.
    // bestvideo+bestaudio requires FFmpeg to merge separate video/audio streams.
    // On Windows, ffmpeg-static's FFmpeg binary can hang during merge (e.g. opus->AAC
    // re-encode for mp4 container), causing yt-dlp to wait forever.
    // best[height<=N] downloads a pre-muxed stream (combined video+audio).
    // No FFmpeg merge needed -> no hang.
    const formatStr = height > 0
      ? `best[height<=${height}]`
      : 'best';

    const hasNode = checkNodeJsRuntime();
    const jsRuntimeArgs = hasNode ? ['--js-runtimes', 'node'] : [];

    const args = [
      '-f', formatStr,
      '-o', outputPath,
      '--no-playlist',
      '--extractor-retries', '3',
      '--newline',
      '--progress',
      '--no-color',
      ...jsRuntimeArgs,
      url
    ];

    const ffmpegPath = resolveFfmpegPath();
    if (ffmpegPath) {
      args.push('--ffmpeg-location', path.dirname(path.resolve(ffmpegPath)));
    } else {
      const err = new Error('FFmpeg not found. The project requires FFmpeg for video processing. Please ensure ffmpeg-static is properly installed.');
      console.error(err.message);
      return reject(err);
    }

    const resolvedOutputPath = path.resolve(outputPath);

    console.log(`[yt-dlp] Executing: "${cmd}" ${args.join(' ')}`);
    console.log(`[yt-dlp] Output path (resolved): ${resolvedOutputPath}`);
    console.log(`[yt-dlp] FFmpeg location: ${path.dirname(path.resolve(ffmpegPath))}`);
    console.log(`[yt-dlp] Start time: ${new Date().toISOString()}`);

    const startTimeMs = Date.now();

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8'
    };

    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: env
    });

    let settled = false;
    let stderr = '';
    let stdout = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timeoutTimer = null;
    let lastActivityTime = Date.now();
    let lastProgress = 0;

    console.log(`[yt-dlp] Spawned PID: ${proc.pid}`);

    const progressRegex = /\[download\]\s+(\d+\.?\d*)%/;
    const mergeDetectRegex = /\[merge\]|\[ffmpeg\]|Merging formats/i;

    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

    function resetIdleTimeout() {
      lastActivityTime = Date.now();
      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const elapsed = ((Date.now() - startTimeMs) / 1000).toFixed(1);
        const idleFor = ((Date.now() - lastActivityTime) / 1000).toFixed(1);
        console.error(`[yt-dlp] Idle timeout: no activity for ${idleFor}s (total: ${elapsed}s). Last progress: ${lastProgress}%. Killing process tree...`);
        killProcessTree(proc.pid);
        reject(new Error(`Download timed out: no activity for 5 minutes`));
      }, IDLE_TIMEOUT_MS);
    }

    resetIdleTimeout();
    console.log(`[yt-dlp] Idle timeout set: ${IDLE_TIMEOUT_MS / 1000}s of inactivity`);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`[yt-dlp:stdout] ${text}`);
      stdout += text;
      stdoutBuffer += text;

      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        if (mergeDetectRegex.test(line)) {
          console.log(`[yt-dlp] FFmpeg merge detected (stdout): ${line.trim()}`);
        }
        const match = line.match(progressRegex);
        if (match) {
          lastProgress = parseFloat(match[1]);
          if (onProgress) {
            onProgress(lastProgress);
          }
        }
      }

      resetIdleTimeout();
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(`[yt-dlp:stderr] ${text}`);
      stderr += text;
      stderrBuffer += text;

      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        if (mergeDetectRegex.test(line)) {
          console.log(`[yt-dlp] FFmpeg merge detected (stderr): ${line.trim()}`);
        }
        const match = line.match(progressRegex);
        if (match) {
          lastProgress = parseFloat(match[1]);
          if (onProgress) {
            onProgress(lastProgress);
          }
        }
      }

      resetIdleTimeout();
    });

    proc.on('exit', (code, signal) => {
      console.log(`[yt-dlp] Process exited (PID: ${proc.pid}, code: ${code}, signal: ${signal})`);
    });

    proc.on('close', (code) => {
      if (settled) {
        console.log(`[yt-dlp] Close event skipped (already settled). Code: ${code}`);
        return;
      }
      clearTimeout(timeoutTimer);

      const duration = ((Date.now() - startTimeMs) / 1000).toFixed(1);
      console.log(`[yt-dlp] Process closed (PID: ${proc.pid}, code: ${code}, duration: ${duration}s)`);
      console.log(`[yt-dlp] End time: ${new Date().toISOString()}`);

      if (stderr.trim()) {
        if (code === 0) {
          console.warn(`[yt-dlp] Warnings: ${stderr.trim()}`);
        } else {
          console.error(`[yt-dlp] Errors: ${stderr.trim()}`);
        }
      }

      const fileExists = fs.existsSync(resolvedOutputPath);

      if (code === 0 && fileExists) {
        console.log(`[yt-dlp] Download successful (${duration}s)`);
        settled = true;
        resolve(resolvedOutputPath);
      } else if (code === 0 && !fileExists) {
        settled = true;
        const errMsg = `Download reported success (code 0) but output file is missing: ${resolvedOutputPath}`;
        console.error(`[yt-dlp] ${errMsg}`);
        reject(new Error(errMsg));
      } else {
        settled = true;
        const friendlyError = parseYtDlpErrors(stderr);
        const errMsg = friendlyError || (stderr + stdout).slice(-500).trim();
        console.error(`[yt-dlp] Download failed (code: ${code}): ${errMsg}`);
        reject(new Error(errMsg || `Download failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      console.error(`[yt-dlp] Spawn error: ${err.message}`);
      reject(new Error(`yt-dlp error: ${err.message}`));
    });

    proc.on('disconnect', () => {
      console.log(`[yt-dlp] Process disconnected (PID: ${proc.pid})`);
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
