const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptsDir = execSync(
  'python -c "import sys,os; print(os.path.join(sys.base_exec_prefix,\'Scripts\'))"',
  { encoding: 'utf-8' }
).trim();
const ytDlpPath = path.join(scriptsDir, 'yt-dlp.exe');

console.log('yt-dlp version:', execSync(`"${ytDlpPath}" --version`, { encoding: 'utf-8' }).trim());
try { console.log('ffmpeg:', execSync('where ffmpeg', { encoding: 'utf-8' }).trim()); } catch { console.log('ffmpeg: NOT FOUND'); }

const outputPath = `C:\\Users\\hp\\AppData\\Local\\Temp\\test_dl_${Date.now()}.mp4`;
console.log('Output:', outputPath);

const args = [
  '-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]',
  '-o', outputPath,
  '--no-playlist',
  '--merge-output-format', 'mp4',
  '--no-progress',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
];

console.log('Args:', args.join(' '));
const proc = spawn(ytDlpPath, args);
let stderr = '';

proc.stderr.on('data', d => {
  const t = d.toString();
  stderr += t;
  process.stdout.write(t);
});

proc.stdout.on('data', d => process.stdout.write(d.toString()));

proc.on('close', code => {
  console.log('\n--- EXIT CODE:', code, '---');
  console.log('File exists:', fs.existsSync(outputPath));
  console.log('stderr (last 1000):', stderr.slice(-1000));
});

proc.on('error', e => console.error('SPAWN ERROR:', e.message));
