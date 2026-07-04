# AI Assistant — Highlight Scoring Service

A persistent Python microservice that scores video highlight candidates using
either a cold-start heuristic (matching the existing JavaScript heuristic) or
a trained classical ML model that improves as real user feedback accumulates.

## How it works

1. **`POST /analyze`** — Receives the same scene/motion/silence/beat/transcript
   data that the Node backend already computes, scores candidate highlight
   windows, and returns the top N with per-window feature vectors.

2. **`POST /feedback`** — Records a feature vector + label (1 = downloaded,
   0 = not downloaded) to `data/feedback.jsonl`. This is called transparently
   by the Node backend when users download generated reels or when completed
   jobs expire without any downloads.

3. **`python train.py`** — Manually triggered; trains a `LogisticRegression`
   classifier on accumulated feedback data. Saves `data/model.joblib` and
   `data/metadata.json`. The server auto-detects and hot-reloads the model
   on the next `/analyze` call without restarting.

## What data is collected

Only feature vectors (7 numeric values per highlight window: scene count,
average motion, beat count, silence ratio, normalized position, lexical
engagement score, window duration) plus a binary download/no-download label.
**No video content, no audio, no transcripts are stored.** All data is local
to `backend/python/ai_assistant/data/` — nothing leaves the machine.

## Realistic expectations

- **Cold start (0 samples):** The heuristic produces identical scoring to the
  existing JS heuristic in `reelsService.js`. Quality is unchanged.
- **Early training (<50 samples):** `train.py` will refuse to train. No model
  is persisted.
- **50+ samples with both classes:** A `LogisticRegression` model is trained.
  With small data it will closely resemble the heuristic baseline. As more
  feedback accumulates, it gradually learns what feature combinations
  actually correlate with user downloads in this specific deployment.
- **Production-quality signal:** Hundreds to low thousands of samples are
  needed for meaningful divergence from the baseline. This is a learning
  system, not an instant improvement.

## Usage

```bash
# Start the server (usually started automatically by the Node backend)
PY_ASSISTANT_PORT=8787 python server.py

# Train from accumulated feedback
python train.py

# Check service health
curl http://localhost:8787/health
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PY_ASSISTANT_PORT` | `8787` | Port for the FastAPI server |
| `AI_ASSISTANT_MIN_SAMPLES` | `50` | Minimum labeled samples before training |

## File layout

```
ai_assistant/
  server.py          — FastAPI app (analyze/feedback/health endpoints)
  train.py           — Training script (manual trigger)
  requirements.txt   — Python dependencies
  README.md          — This file
  data/
    feedback.jsonl   — Accumulated feature + label pairs (one JSON per line)
    model.joblib     — Trained LogisticRegression model (created by train.py)
    scaler.joblib    — Feature scaler (created by train.py)
    metadata.json    — Training metadata (samples, accuracy, timestamp)
```
