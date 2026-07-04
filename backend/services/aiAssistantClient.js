const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.env.PY_ASSISTANT_PORT || '8787', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCRIPT_DIR = path.resolve(__dirname, '..', 'python', 'ai_assistant');
const SERVER_SCRIPT = path.join(SCRIPT_DIR, 'server.py');

let available = false;
let childProcess = null;
let healthCheckTimer = null;
const ANALYZE_TIMEOUT = 15_000;
const FEEDBACK_TIMEOUT = 5_000;
const STARTUP_TIMEOUT = 15_000;
const HEALTH_POLL_INTERVAL = 500;

function getPythonCmd() {
  const { spawnSync } = require('child_process');
  const r1 = spawnSync('python3', ['--version'], { timeout: 2000, windowsHide: true });
  if (r1.status === 0) return 'python3';
  const r2 = spawnSync('python', ['--version'], { timeout: 2000, windowsHide: true });
  if (r2.status === 0) return 'python';
  return null;
}

function checkDepsAvailable(pythonCmd) {
  const { spawnSync } = require('child_process');
  const result = spawnSync(pythonCmd, [
    '-c', 'import fastapi, uvicorn, sklearn, joblib, numpy, pandas; print("ok")'
  ], { timeout: 5000, windowsHide: true });
  return result.status === 0;
}

function httpRequest(method, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function startService() {
  const pythonCmd = getPythonCmd();
  if (!pythonCmd) {
    console.warn('[aiAssistantClient] Python not found. AI assistant unavailable.');
    return;
  }
  if (!checkDepsAvailable(pythonCmd)) {
    console.warn('[aiAssistantClient] Required Python packages (fastapi, uvicorn, sklearn, etc.) not installed.');
    console.warn('[aiAssistantClient] Run: pip install -r "' + path.join(SCRIPT_DIR, 'requirements.txt') + '"');
    return;
  }
  console.log(`[aiAssistantClient] Starting Python AI assistant (port ${PORT})...`);
  childProcess = spawn(pythonCmd, ['-u', SERVER_SCRIPT], {
    cwd: SCRIPT_DIR,
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PY_ASSISTANT_PORT: String(PORT) }
  });
  childProcess.stdout.on('data', (d) => {
    for (const line of d.toString().trim().split('\n')) {
      if (line) console.log(`[ai_assistant] ${line}`);
    }
  });
  childProcess.stderr.on('data', (d) => {
    for (const line of d.toString().trim().split('\n')) {
      if (line) console.log(`[ai_assistant] ${line}`);
    }
  });
  childProcess.on('exit', (code, signal) => {
    console.warn(`[aiAssistantClient] Process exited (code=${code}, signal=${signal})`);
    childProcess = null;
    available = false;
  });
  childProcess.on('error', (err) => {
    console.warn(`[aiAssistantClient] Failed to start: ${err.message}`);
    childProcess = null;
    available = false;
  });
  waitForHealth();
}

function waitForHealth() {
  const start = Date.now();
  const poll = () => {
    if (!childProcess) {
      available = false;
      return;
    }
    httpRequest('GET', '/health', null, 2000)
      .then((res) => {
        if (res.status === 200) {
          available = true;
          console.log(`[aiAssistantClient] Ready (port ${PORT}, samples=${res.body.trainingSamples || 0})`);
        }
      })
      .catch(() => {
        if (Date.now() - start < STARTUP_TIMEOUT) {
          healthCheckTimer = setTimeout(poll, HEALTH_POLL_INTERVAL);
        } else {
          console.warn('[aiAssistantClient] Startup timeout — AI assistant unavailable');
          available = false;
        }
      });
  };
  poll();
}

function stopService() {
  if (healthCheckTimer) {
    clearTimeout(healthCheckTimer);
    healthCheckTimer = null;
  }
  if (childProcess) {
    try {
      childProcess.kill('SIGTERM');
      setTimeout(() => {
        if (childProcess) {
          try { childProcess.kill('SIGKILL'); } catch {}
        }
      }, 3000);
    } catch {}
    childProcess = null;
  }
  available = false;
}

function isAvailable() {
  return available;
}

async function analyze(payload) {
  if (!available) return null;
  try {
    const res = await httpRequest('POST', '/analyze', payload, ANALYZE_TIMEOUT);
    if (res.status === 200 && res.body && Array.isArray(res.body.highlights)) {
      return res.body.highlights;
    }
    return null;
  } catch (err) {
    console.warn(`[aiAssistantClient] /analyze failed: ${err.message}`);
    return null;
  }
}

function recordFeedback({ jobId, reelIndex, features, label }) {
  if (!available) return;
  httpRequest('POST', '/feedback', { jobId, reelIndex, features, label }, FEEDBACK_TIMEOUT)
    .catch((err) => {
      console.warn(`[aiAssistantClient] /feedback failed: ${err.message}`);
    });
}

module.exports = { startService, stopService, isAvailable, analyze, recordFeedback };
