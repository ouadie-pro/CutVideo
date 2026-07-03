# CutVideo — Optional Python Smart Crop

This folder contains an optional Python helper for face-tracking smart crop.

## Prerequisites

- Python 3.8+
- OpenCV (`pip install opencv-python numpy`)

## How it works

`smart_crop.py` uses OpenCV's Haar cascade face detector to find the
largest face in each sampled frame, applies exponential smoothing to
the center position, and outputs the tracked crop path as JSON.

## If Python/OpenCV are not installed

The backend gracefully falls back to a fixed center-crop (1080×1920).
No errors are surfaced to the user.
