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

async function getVideoInfo(url) {
  if (checkYtDlp()) {
    return getInfoWithYtDlp(url);
  }
  return getInfoWithYtdlCore(url);
}

async function getInfoWithYtDlp(url) {
  try {
    checkYtDlp();
    const cmd = ytDlpExecPath || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    let infoArgs = `--dump-json --no-playlist --skip-download --js-runtimes node`;
    try {
      const ffmpegPath = require('ffmpeg-static');
      if (ffmpegPath) {
        infoArgs += ` --ffmpeg-location "${path.dirname(ffmpegPath)}"`;
      }
    } catch {}
    const output = execSync(
      `"${cmd}" ${infoArgs} "${url}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000, encoding: 'utf-8' }
    );

    const data = JSON.parse(output);

    const formats = (data.formats || []).map(f => ({
      height: f.height,
      format_id: f.format_id,
      ext: f.ext,
      vcodec: f.vcodec,
      acodec: f.acodec,
      filesize: f.filesize
    }));

    return {
      title: data.title || 'Unknown',
      duration: data.duration || 0,
      thumbnail: data.thumbnail || '',
      author: data.uploader || data.uploader_id || data.channel || 'Unknown',
      formats
    };
  } catch (error) {
    if (error.message.includes('private')) {
      throw new Error('Private video');
    }
    if (error.message.includes('unavailable') || error.message.includes('not found')) {
      throw new Error('This video is unavailable');
    }
    throw new Error(`Failed to get video info: ${error.message}`);
  }
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

    const args = [
      '-f', formatStr,
      '-o', outputPath,
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--js-runtimes', 'node',
      '--newline',
      url
    ];

    let ffmpegPath = null;
    try {
      ffmpegPath = require('ffmpeg-static');
      if (ffmpegPath) {
        args.push('--ffmpeg-location', path.dirname(ffmpegPath));
      }
    } catch {}

    const proc = spawn(cmd, args);
    let stderr = '';
    let stdout = '';
    let timeoutTimer = null;

    // Set a timeout to prevent hanging
    timeoutTimer = setTimeout(() => {
      proc.kill();
      reject(new Error('Download timeout after 5 minutes'));
    }, 5 * 60 * 1000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      const match = text.match(/(\d+\.?\d*)%/);
      if (match && onProgress) {
        onProgress(parseFloat(match[1]));
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;

      const match = text.match(/(\d+\.?\d*)%/);
      if (match && onProgress) {
        onProgress(parseFloat(match[1]));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        const errMsg = (stderr + stdout).slice(-500).trim();
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
