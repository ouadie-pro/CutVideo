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

async function transcribeAudio(videoPath) {
  let tempAudio = null;
  let compressedAudio = null;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('transcriptionService: OPENAI_API_KEY not set, skipping transcription');
      return { segments: [], fullText: '' };
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
        return { segments: [], fullText: '' };
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
      return { segments: [], fullText: '' };
    }

    const segments = transcription.segments.map(s => ({
      start: s.start,
      end: s.end,
      text: s.text.trim()
    }));

    const fullText = transcription.text || segments.map(s => s.text).join(' ');

    return { segments, fullText };
  } catch (err) {
    if (err.message && err.message.includes('OPENAI_API_KEY')) {
      console.warn('transcriptionService: invalid OpenAI API key');
      return { segments: [], fullText: '' };
    }
    console.warn(`transcriptionService: error: ${err.message}`);
    return { segments: [], fullText: '' };
  } finally {
    if (tempAudio && fs.existsSync(tempAudio)) {
      try { fs.unlinkSync(tempAudio); } catch {}
    }
    if (compressedAudio && fs.existsSync(compressedAudio)) {
      try { fs.unlinkSync(compressedAudio); } catch {}
    }
  }
}

module.exports = { transcribeAudio };
