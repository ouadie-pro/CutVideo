import sys
import json
import os
import faulthandler

faulthandler.enable()

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper not installed. Run: pip install -r backend/python/requirements.txt"}))
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_path> [model_size]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("WHISPER_MODEL", "base")

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        segments, info = model.transcribe(audio_path, beam_size=5)

        result_segments = []
        for seg in segments:
            result_segments.append({
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip()
            })

        full_text = " ".join(s["text"] for s in result_segments if s["text"])

        print(json.dumps({"segments": result_segments, "full_text": full_text}))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
