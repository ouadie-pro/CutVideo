const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let capabilitiesChecked = false;
let pythonAvailable = false;

function checkCapabilities() {
  if (capabilitiesChecked) return pythonAvailable;
  capabilitiesChecked = true;
  try {
    const result = require('child_process').spawnSync('python3', ['-c', 'import cv2; print("ok")'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    if (result.status === 0) {
      pythonAvailable = true;
    } else {
      const result2 = require('child_process').spawnSync('python', ['-c', 'import cv2; print("ok")'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      if (result2.status === 0) {
        pythonAvailable = true;
      }
    }
  } catch {
    pythonAvailable = false;
  }
  if (!pythonAvailable) {
    console.warn('smartCropService: Python3/OpenCV not available, smart crop disabled');
  }
  return pythonAvailable;
}

function getPythonCmd() {
  const r1 = require('child_process').spawnSync('python3', ['--version'], {
    timeout: 3000, stdio: 'pipe', windowsHide: true
  });
  if (r1.status === 0) return 'python3';
  return 'python';
}

async function computeCropPath(inputVideoPath) {
  try {
    if (!checkCapabilities()) return null;

    if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
      console.warn('smartCropService: input video not found');
      return null;
    }

    const scriptPath = path.resolve(__dirname, '..', 'python', 'smart_crop.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('smartCropService: smart_crop.py not found');
      return null;
    }

    const pythonCmd = getPythonCmd();

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(pythonCmd, [scriptPath, inputVideoPath], {
        windowsHide: true,
        timeout: 60000
      });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('smart_crop.py timed out after 60s'));
      }, 60000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error(`smart_crop.py: unparseable JSON output: ${stdout.slice(200)}`));
          }
        } else {
          reject(new Error(`smart_crop.py exited with code ${code}: ${stderr.slice(200)}`));
        }
      });
      proc.on('error', reject);
    });

    if (!result || result.error) {
      console.warn(`smartCropService: ${result?.error || 'no result'}`);
      return null;
    }

    if (!result.crop_path || result.crop_path.length === 0) {
      console.warn('smartCropService: no crop path generated');
      return null;
    }

    console.log(`smartCropService: got ${result.crop_path.length} crop points (src: ${result.width}x${result.height})`);
    return result.crop_path;
  } catch (err) {
    console.warn(`smartCropService: error: ${err.message}`);
    return null;
  }
}

module.exports = { computeCropPath };
