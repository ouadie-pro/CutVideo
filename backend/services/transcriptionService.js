const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const ffmpegStatic = require('ffmpeg-static');

function getFfmpegPath() {
  if (ffmpegStatic) return ffmpegStatic;
  try {
    const p = require('ffmpeg-static');
    if (p) return p;
  } catch {}
  return 'ffmpeg';
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT = 3 * 60 * 1000;

let localTranscriptionChecked = false;
let localTranscriptionAvailable = false;

function checkLocalTranscription() {
  if (localTranscriptionChecked) return localTranscriptionAvailable;
  localTranscriptionChecked = true;
  try {
    const scriptPath = path.resolve(__dirname, '..', 'python', 'transcribe.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('transcriptionService: transcribe.py not found');
      return false;
    }
    const result = require('child_process').spawnSync('python3', ['-c', 'from faster_whisper import WhisperModel; print("ok")'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    if (result.status === 0) {
      localTranscriptionAvailable = true;
    } else {
      const result2 = require('child_process').spawnSync('python', ['-c', 'from faster_whisper import WhisperModel; print("ok")'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      if (result2.status === 0) {
        localTranscriptionAvailable = true;
      }
    }
  } catch {
    localTranscriptionAvailable = false;
  }
  if (!localTranscriptionAvailable) {
    console.warn('transcriptionService: faster-whisper not available, local transcription disabled. pip install -r backend/python/requirements.txt');
  }
  return localTranscriptionAvailable;
}

function getPythonCmd() {
  const r1 = require('child_process').spawnSync('python3', ['--version'], {
    timeout: 3000, stdio: 'pipe', windowsHide: true
  });
  if (r1.status === 0) return 'python3';
  return 'python';
}

function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = getFfmpegPath();
    const args = [
      '-i', videoPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-y',
      outputPath
    ];
    console.log(`Transcription: extracting audio: "${ff}" ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`Audio extraction failed: ${stderr.slice(-300)}`));
      }
    });
    proc.on('error', reject);
  });
}

function compressAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = getFfmpegPath();
    const args = [
      '-i', inputPath,
      '-vn',
      '-acodec', 'libmp3lame',
      '-ab', '32k',
      '-ar', '22050',
      '-ac', '1',
      '-y',
      outputPath
    ];
    console.log(`Transcription: compressing audio to mono 32k: "${ff}" ${args.join(' ')}`);
    const proc = spawn(ff, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`Audio compression failed: ${stderr.slice(-300)}`));
      }
    });
    proc.on('error', reject);
  });
}

async function transcribeWithOpenAI(videoPath) {
  let tempAudio = null;
  let compressedAudio = null;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('transcriptionService: OPENAI_API_KEY not set, cannot use openai provider');
      return null;
    }

    const model = process.env.TRANSCRIBE_MODEL || 'whisper-1';
    const ext = '.mp3';
    tempAudio = path.resolve(
      path.dirname(videoPath),
      `transcribe_${path.basename(videoPath, path.extname(videoPath))}${ext}`
    );

    await extractAudio(videoPath, tempAudio);

    let audioFile = tempAudio;
    const stat = fs.statSync(audioFile);
    if (stat.size > MAX_FILE_SIZE) {
      console.log(`Transcription: audio too large (${(stat.size / 1024 / 1024).toFixed(1)}MB), compressing`);
      compressedAudio = audioFile.replace('.mp3', '_compressed.mp3');
      await compressAudio(audioFile, compressedAudio);
      audioFile = compressedAudio;
      const compressedStat = fs.statSync(audioFile);
      if (compressedStat.size > MAX_FILE_SIZE) {
        console.warn(`Transcription: compressed audio still too large (${(compressedStat.size / 1024 / 1024).toFixed(1)}MB), returning empty`);
        return null;
      }
    }

    const openai = new OpenAI({ apiKey });

    const transcription = await Promise.race([
      openai.audio.transcriptions.create({
        model,
        file: fs.createReadStream(audioFile),
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Transcription timed out after 3 minutes')), TRANSCRIBE_TIMEOUT)
      )
    ]);

    if (!transcription || !transcription.segments || transcription.segments.length === 0) {
      console.warn('transcriptionService: no speech detected in audio');
      return null;
    }

    const segments = transcription.segments.map(s => ({
      start: s.start,
      end: s.end,
      text: s.text.trim()
    }));

    const fullText = transcription.text || segments.map(s => s.text).join(' ');

    return { segments, fullText };
  } catch (err) {
    console.warn(`transcriptionService: OpenAI transcription error: ${err.message}`);
    return null;
  } finally {
    if (tempAudio && fs.existsSync(tempAudio)) {
      try { fs.unlinkSync(tempAudio); } catch {}
    }
    if (compressedAudio && fs.existsSync(compressedAudio)) {
      try { fs.unlinkSync(compressedAudio); } catch {}
    }
  }
}

async function transcribeWithLocal(videoPath) {
  let tempAudio = null;

  try {
    if (!checkLocalTranscription()) return null;

    const scriptPath = path.resolve(__dirname, '..', 'python', 'transcribe.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('transcriptionService: transcribe.py not found');
      return null;
    }

    const ext = '.wav';
    tempAudio = path.resolve(
      path.dirname(videoPath),
      `transcribe_${path.basename(videoPath, path.extname(videoPath))}${ext}`
    );

    const ff = getFfmpegPath();
    const extractArgs = [
      '-i', videoPath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      tempAudio
    ];
    console.log(`Transcription: extracting audio for local: "${ff}" ${extractArgs.join(' ')}`);
    await new Promise((resolve, reject) => {
      const proc = spawn(ff, extractArgs, { windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempAudio)) resolve();
        else reject(new Error(`Audio extraction failed: ${stderr.slice(-300)}`));
      });
      proc.on('error', reject);
    });

    const pythonCmd = getPythonCmd();
    const modelSize = process.env.WHISPER_MODEL || 'base';

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(pythonCmd, [scriptPath, tempAudio, modelSize], {
        windowsHide: true,
        timeout: 600000
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('Local transcription timed out after 10 minutes'));
      }, 600000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error(`transcribe.py: unparseable JSON: ${stdout.slice(200)}`));
          }
        } else {
          reject(new Error(`transcribe.py exited with code ${code}: ${stderr.slice(200)}`));
        }
      });
      proc.on('error', reject);
    });

    if (!result || result.error) {
      console.warn(`transcriptionService: local transcription error: ${result?.error || 'no result'}`);
      return null;
    }

    return {
      segments: result.segments || [],
      fullText: result.full_text || ''
    };
  } catch (err) {
    console.warn(`transcriptionService: local transcription error: ${err.message}`);
    return null;
  } finally {
    if (tempAudio && fs.existsSync(tempAudio)) {
      try { fs.unlinkSync(tempAudio); } catch {}
    }
  }
}

async function transcribeAudio(videoPath) {
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'local').toLowerCase();

  try {
    let result = null;

    if (provider === 'openai') {
      result = await transcribeWithOpenAI(videoPath);
    } else if (provider === 'local') {
      result = await transcribeWithLocal(videoPath);
    } else if (provider === 'none') {
      console.log('transcriptionService: TRANSCRIPTION_PROVIDER=none, skipping');
      return { segments: [], fullText: '' };
    } else {
      console.warn(`transcriptionService: unknown TRANSCRIPTION_PROVIDER "${provider}", falling back to local`);
      result = await transcribeWithLocal(videoPath);
    }

    if (!result) {
      console.warn('transcriptionService: transcription returned no result');
      return { segments: [], fullText: '' };
    }

    return result;
  } catch (err) {
    console.warn(`transcriptionService: error: ${err.message}`);
    return { segments: [], fullText: '' };
  }
}

module.exports = { transcribeAudio };
