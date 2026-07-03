import sys
import json
import cv2
import numpy as np

SAMPLE_INTERVAL = 0.5
SMOOTHING_FACTOR = 0.6


def process_video(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Cannot open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if fps <= 0:
        cap.release()
        raise RuntimeError("Invalid FPS")

    sample_interval_frames = max(1, int(fps * SAMPLE_INTERVAL))

    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    crop_center_x = width / 2
    crop_center_y = height / 2
    points = []

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_interval_frames == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)
            )

            if len(faces) > 0:
                largest = max(faces, key=lambda f: f[2] * f[3])
                fx, fy, fw, fh = largest
                face_center_x = fx + fw / 2
                face_center_y = fy + fh / 2
                crop_center_x = (
                    SMOOTHING_FACTOR * face_center_x
                    + (1 - SMOOTHING_FACTOR) * crop_center_x
                )
                crop_center_y = (
                    SMOOTHING_FACTOR * face_center_y
                    + (1 - SMOOTHING_FACTOR) * crop_center_y
                )

            time_sec = frame_idx / fps
            points.append(
                {"time": round(time_sec, 3), "x": round(crop_center_x), "y": round(crop_center_y)}
            )

        frame_idx += 1

    cap.release()

    if len(points) == 0:
        points.append({"time": 0, "x": width // 2, "y": height // 2})

    return {"width": width, "height": height, "crop_path": points}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: smart_crop.py <video_path>"}))
        sys.exit(1)

    video_path = sys.argv[1]
    try:
        result = process_video(video_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
