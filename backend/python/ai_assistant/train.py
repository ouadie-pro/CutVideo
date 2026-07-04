"""
train.py — Train the highlight-scoring model from accumulated feedback data.

Usage:
    python train.py

Reads feedback.jsonl, trains a LogisticRegression model on the feature vectors
to predict download/no-download label, and saves model.joblib + metadata.json.

Design choice: LogisticRegression over more complex models (GBM, RF) because:
  - Small dataset regime (starts at 50 samples) — linear model is less prone to overfitting
  - Predicted probabilities are naturally well-calibrated (good as "scores")
  - Coefficients are interpretable feature weights
  - Fast to train with no hyperparameter tuning needed
  - With L2 regularization (C=1.0) it handles collinearity in correlated features well
"""

import json
import time
import logging
import numpy as np
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score
from sklearn.preprocessing import StandardScaler
import joblib

logging.basicConfig(level=logging.INFO, format="[train] %(levelname)s: %(message)s")
logger = logging.getLogger("train")

DATA_DIR = Path(__file__).resolve().parent / "data"
FEEDBACK_PATH = DATA_DIR / "feedback.jsonl"
MODEL_PATH = DATA_DIR / "model.joblib"
METADATA_PATH = DATA_DIR / "metadata.json"
SCALER_PATH = DATA_DIR / "scaler.joblib"

MIN_TRAINING_SAMPLES = 50
FEATURE_KEYS = ["sceneCount", "avgMotion", "beatCount", "silenceRatio", "normPos", "lexicalScore", "windowDuration"]

def load_feedback():
    if not FEEDBACK_PATH.exists():
        logger.warning("No feedback data found")
        return [], []
    X, y = [], []
    with open(FEEDBACK_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                feat = entry.get("features", {})
                row = [feat.get(k, 0) for k in FEATURE_KEYS]
                X.append(row)
                y.append(entry["label"])
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"Skipping bad entry: {e}")
    return np.array(X, dtype=float), np.array(y, dtype=int)

def main():
    X, y = load_feedback()
    if len(X) == 0:
        logger.error("No training data available")
        return
    n_samples = len(X)
    n_pos = int(y.sum())
    n_neg = n_samples - n_pos
    logger.info(f"Loaded {n_samples} samples ({n_pos} positive, {n_neg} negative)")
    if n_samples < MIN_TRAINING_SAMPLES:
        logger.warning(f"Only {n_samples} samples, need {MIN_TRAINING_SAMPLES}. Skipping training.")
        return
    if n_pos == 0 or n_neg == 0:
        logger.warning("Only one class present. Skipping training.")
        return

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    val_accuracy = 0.0
    val_auc = 0.0
    if n_samples >= 20:
        try:
            X_train, X_val, y_train, y_val = train_test_split(
                X_scaled, y, test_size=0.2, random_state=42, stratify=y
            )
            model = LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000, random_state=42)
            model.fit(X_train, y_train)
            y_pred = model.predict(X_val)
            val_accuracy = float(accuracy_score(y_val, y_pred))
            if len(np.unique(y_val)) > 1:
                y_prob = model.predict_proba(X_val)[:, 1]
                val_auc = float(roc_auc_score(y_val, y_prob))
            else:
                val_auc = 0.0
            logger.info(f"Validation accuracy={val_accuracy:.4f}, AUC={val_auc:.4f}")
        except ValueError as e:
            logger.warning(f"Train/test split failed ({e}), training on full set")
            model = LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000, random_state=42)
            model.fit(X_scaled, y)
    else:
        model = LogisticRegression(C=1.0, solver="lbfgs", max_iter=1000, random_state=42)
        model.fit(X_scaled, y)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)

    feature_weights = dict(zip(FEATURE_KEYS, model.coef_[0].tolist()))
    metadata = {
        "modelVersion": "0.1.0",
        "training_samples": n_samples,
        "positive_samples": int(n_pos),
        "negative_samples": int(n_neg),
        "feature_weights": feature_weights,
        "val_accuracy": round(val_accuracy, 4),
        "val_auc": round(val_auc, 4),
        "trained_at": time.time(),
        "min_training_samples": MIN_TRAINING_SAMPLES
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)

    logger.info(f"Model saved to {MODEL_PATH}")
    logger.info(f"Metadata saved to {METADATA_PATH}")
    logger.info(f"Feature weights: {json.dumps(feature_weights, indent=2)}")

if __name__ == "__main__":
    main()
