import re
from typing import Any

def normalize_speaker_label(value: Any) -> str:
    raw = str(value or "").strip()
    canonical = re.match(r"^speaker_(\d{2,})$", raw, re.IGNORECASE)
    if canonical:
        return f"Speaker_{int(canonical.group(1)):02d}"
    match = re.search(r"(\d+)", raw)
    if match:
        number = int(match.group(1)) + 1
        return f"Speaker_{number:02d}"
    return "Speaker_01"

def estimate_segment_end(start_seconds: float, text: str) -> float:
    words = len(text.split())
    # Assume roughly 2.5 words per second
    duration = words / 2.5
    return start_seconds + duration
