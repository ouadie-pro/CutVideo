import os
import sys
import json
import time
import logging
import numpy as np
from pathlib import Path
from threading import Lock
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

logging.basicConfig(level=logging.INFO, format="[ai_assistant] %(levelname)s: %(message)s")
logger = logging.getLogger("ai_assistant")

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
FEEDBACK_PATH = DATA_DIR / "feedback.jsonl"
MODEL_PATH = DATA_DIR / "model.joblib"
METADATA_PATH = DATA_DIR / "metadata.json"
MIN_TRAINING_SAMPLES = int(os.environ.get("AI_ASSISTANT_MIN_SAMPLES", "50"))

MODEL_VERSION = "0.1.0"
_model = None
_model_mtime = 0
_scaler = None
_scaler_mtime = 0
_model_lock = Lock()
_training_samples = 0

SCALER_PATH = DATA_DIR / "scaler.joblib"

ENGAGEMENT_WORDS = frozenset({
    "insane", "crazy", "never", "best", "secret", "wow", "amazing", "incredible",
    "shocking", "terrible", "worst", "hilarious", "unbelievable", "genius",
    "epic", "legendary", "disaster", "nightmare", "perfect",
    "must", "need", "love", "hate",
    "seriously", "literally", "actually", "finally", "impossible",
    "what", "why", "how", "wait", "stop", "guaranteed", "free",
    "you won't believe", "no way", "mind blowing", "game changer",
    "never seen", "best ever", "worst ever", "check this out"
})

def count_positives():
    if not FEEDBACK_PATH.exists():
        return 0, 0
    pos = 0
    neg = 0
    with open(FEEDBACK_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("label") == 1:
                    pos += 1
                else:
                    neg += 1
            except json.JSONDecodeError:
                pass
    return pos, neg

def _load_model():
    global _model, _model_mtime, _scaler, _scaler_mtime, _training_samples
    if not MODEL_PATH.exists():
        _model = None
        _scaler = None
        return False
    try:
        mtime = os.path.getmtime(MODEL_PATH)
        if mtime > _model_mtime:
            import joblib
            _model = joblib.load(MODEL_PATH)
            _model_mtime = mtime
            if SCALER_PATH.exists():
                scaler_mtime = os.path.getmtime(SCALER_PATH)
                if scaler_mtime > _scaler_mtime:
                    _scaler = joblib.load(SCALER_PATH)
                    _scaler_mtime = scaler_mtime
            else:
                _scaler = None
            if METADATA_PATH.exists():
                try:
                    meta = json.loads(METADATA_PATH.read_text())
                    _training_samples = meta.get("training_samples", 0)
                except Exception:
                    _training_samples = 0
            logger.info(f"Model loaded: {_training_samples} training samples, version={MODEL_VERSION}")
            return True
        return _model is not None
    except Exception as e:
        logger.warning(f"Failed to load model: {e}")
        _model = None
        _scaler = None
        return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model()
    yield

app = FastAPI(title="AI Assistant", version=MODEL_VERSION, lifespan=lifespan)

class AnalyzeRequest(BaseModel):
    scenes: list[float] = Field(default_factory=list)
    motionScores: list[dict] = Field(default_factory=list)
    silences: list[dict] = Field(default_factory=list)
    audioBeats: list[dict] = Field(default_factory=list)
    totalDuration: float
    count: int
    reelDuration: float
    transcriptSegments: Optional[list[dict]] = None

class AnalyzeResponse(BaseModel):
    highlights: list[dict]

class FeedbackRequest(BaseModel):
    jobId: str
    reelIndex: int
    features: dict
    label: int

class FeedbackResponse(BaseModel):
    status: str

class HealthResponse(BaseModel):
    status: str
    modelVersion: str
    trainingSamples: int
    positiveSamples: int
    negativeSamples: int

def compute_lexical_score(text):
    if not text:
        return 0
    score = 0
    exc_count = text.count("!")
    q_count = text.count("?")
    score += exc_count * 10
    score += q_count * 8
    lower = text.lower()
    for word in ENGAGEMENT_WORDS:
        if word in lower:
            score += 12
    words = text.split()
    upper_words = sum(1 for w in words if len(w) > 1 and w.isupper() and any(c.isalpha() for c in w))
    score += upper_words * 5
    if 20 < len(text) < 200:
        score += 5
    return score

def compute_features(window_start, window_end, scenes, motion_scores, silences, audio_beats, transcript_segments, total_duration):
    duration = window_end - window_start
    scene_count = sum(1 for s in scenes if window_start <= s <= window_end)
    window_motion = [m.get("score", 0) for m in motion_scores if window_start <= m.get("time", 0) <= window_end]
    avg_motion = sum(window_motion) / len(window_motion) if window_motion else 0
    beat_count = sum(1 for b in audio_beats if window_start <= b.get("time", 0) <= window_end)
    sil_dur = 0
    for s in silences:
        s_start = s.get("start", 0)
        s_end = s.get("end", 0)
        if s_start < window_end and s_end > window_start:
            sil_dur += min(s_end, window_end) - max(s_start, window_start)
    silence_ratio = sil_dur / duration if duration > 0 else 0
    center = (window_start + window_end) / 2
    norm_pos = center / total_duration if total_duration > 0 else 0.5
    lexical_score = 0
    if transcript_segments:
        for seg in transcript_segments:
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            if seg_start < window_end and seg_end > window_start:
                lexical_score += compute_lexical_score(seg.get("text", ""))
    return {
        "sceneCount": scene_count,
        "avgMotion": round(avg_motion, 4),
        "beatCount": beat_count,
        "silenceRatio": round(silence_ratio, 4),
        "normPos": round(norm_pos, 4),
        "lexicalScore": lexical_score,
        "windowDuration": round(duration, 2)
    }

def cold_start_score(features):
    score = 0.0
    score += features["sceneCount"] * 8
    score += features["avgMotion"] * 50
    score += features["beatCount"] * 10
    score -= features["silenceRatio"] * 40
    silence_ratio = features["silenceRatio"]
    if silence_ratio > 0.5:
        score -= 30
    avg_motion = features["avgMotion"]
    scene_count = features["sceneCount"]
    if scene_count < 2 and avg_motion == 0:
        score -= 20
    score += (1 - abs(features["normPos"] - 0.5) * 2) * 15
    if scene_count >= 2:
        score += 5
    if scene_count >= 4:
        score += 5
    if avg_motion > 0.3:
        score += 10
    if features["beatCount"] >= 3:
        score += 8
    score += features["lexicalScore"]
    return round(score, 2)

def model_score(features):
    global _model, _scaler
    keys = ["sceneCount", "avgMotion", "beatCount", "silenceRatio", "normPos", "lexicalScore", "windowDuration"]
    x = np.array([[features[k] for k in keys]], dtype=float)
    try:
        if _scaler is not None:
            x = _scaler.transform(x)
        prob = _model.predict_proba(x)[0, 1]
        return round(float(prob), 4)
    except Exception as e:
        logger.warning(f"Model prediction failed: {e}, falling back to cold-start")
        return cold_start_score(features)

SHARED_KEYS = ["sceneCount", "avgMotion", "beatCount", "silenceRatio", "normPos", "lexicalScore", "windowDuration"]

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    try:
        _load_model()
        has_model = _model is not None
        scenes = req.scenes
        motion_scores = req.motionScores
        silences = req.silences
        audio_beats = req.audioBeats
        total_duration = req.totalDuration
        count_arg = req.count
        reel_duration = req.reelDuration
        transcript_segments = req.transcriptSegments
        if total_duration <= 0 or reel_duration <= 0:
            return AnalyzeResponse(highlights=[])
        step = max(1, int(total_duration / 150))
        intro_end = total_duration * 0.08
        credits_start = total_duration * 0.92
        candidates = []
        raw_start = intro_end
        while raw_start + reel_duration <= credits_start:
            window_end = raw_start + reel_duration
            feat = compute_features(raw_start, window_end, scenes, motion_scores, silences, audio_beats, transcript_segments, total_duration)
            if has_model:
                score = model_score(feat)
            else:
                score = cold_start_score(feat)
            candidates.append({
                "start": round(max(0, raw_start), 2),
                "end": round(min(total_duration, window_end), 2),
                "score": score,
                "features": {k: feat[k] for k in SHARED_KEYS}
            })
            raw_start += step
        candidates.sort(key=lambda c: c["score"], reverse=True)
        selected = []
        min_gap = reel_duration * 0.6
        for c in candidates:
            if len(selected) >= count_arg:
                break
            if not any(abs(s["start"] - c["start"]) < min_gap for s in selected):
                selected.append(c)
        selected.sort(key=lambda c: c["start"])
        logger.info(f"/analyze: {len(selected)} highlights from {len(candidates)} candidates, model={'yes' if has_model else 'no'}")
        return AnalyzeResponse(highlights=selected)
    except Exception as e:
        logger.error(f"/analyze failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/feedback", response_model=FeedbackResponse)
def record_feedback(req: FeedbackRequest):
    try:
        FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "jobId": req.jobId,
            "reelIndex": req.reelIndex,
            "features": req.features,
            "label": req.label,
            "timestamp": time.time()
        }
        with open(FEEDBACK_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")
        pos, neg = count_positives()
        logger.info(f"/feedback: label={req.label}, total pos={pos}, neg={neg}")
        return FeedbackResponse(status="ok")
    except Exception as e:
        logger.error(f"/feedback failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health", response_model=HealthResponse)
def health():
    _load_model()
    pos, neg = count_positives()
    samples = pos + neg
    return HealthResponse(
        status="ok",
        modelVersion=MODEL_VERSION,
        trainingSamples=samples,
        positiveSamples=pos,
        negativeSamples=neg
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PY_ASSISTANT_PORT", "8787"))
    uvicorn.run(app, host="127.0.0.1", port=port)
