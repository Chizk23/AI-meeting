import json
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from src.api import schemas

def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    if not raw_text or not raw_text.strip():
        raise ValueError("Router returned empty response")

    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", raw_text, re.DOTALL)
    if not match:
        raise ValueError("Router response did not contain a JSON object")

    parsed = json.loads(match.group())
    if not isinstance(parsed, dict):
        raise ValueError("Router JSON payload must be an object")
    return parsed


AI_SUMMARY_MAX_CHARS = 1400
AI_ITEM_MAX_CHARS = 220
AI_KEY_POINTS_LIMIT = 8
AI_DECISIONS_LIMIT = 6
AI_ACTION_ITEMS_LIMIT = 7
AI_RISKS_LIMIT = 4
AI_OPEN_QUESTIONS_LIMIT = 4
AI_TIMELINE_HIGHLIGHTS_LIMIT = 6
AI_SPEAKER_SUMMARIES_LIMIT = 6


def _compact_ai_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _try_parse_date(value: Optional[str]) -> Optional[date]:
    if not value or value.lower() in {"n/a", "unassigned", ""}:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _clip_ai_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    clipped = text[:max_chars].rstrip()
    sentence_end = max(clipped.rfind("."), clipped.rfind("!"), clipped.rfind("?"), clipped.rfind("。"))
    if sentence_end >= max_chars - 160:
        return clipped[: sentence_end + 1].strip()
    word_end = clipped.rfind(" ")
    if word_end >= max_chars - 80:
        clipped = clipped[:word_end].rstrip()
    return f"{clipped}..."


def _split_ai_owner_text(owner_text: str) -> List[str]:
    normalized = (owner_text or "").strip()
    if not normalized:
        return []
    parts = re.split(r",|;|/|&|\band\b|\bvà\b", normalized, flags=re.IGNORECASE)
    unique: List[str] = []
    seen = set()
    for part in parts:
        cleaned = _clip_ai_text(_compact_ai_text(part), 80)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(cleaned)
    return unique


def _normalize_ai_string_list(value: Any, limit: int, max_chars: int = AI_ITEM_MAX_CHARS) -> List[str]:
    if isinstance(value, str):
        raw_items = [line.strip(" -•\t") for line in value.splitlines()]
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []

    normalized: List[str] = []
    seen = set()
    for item in raw_items:
        text = _clip_ai_text(_compact_ai_text(item), max_chars)
        if not text:
            continue
        dedupe_key = text.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized.append(text)
        if len(normalized) >= limit:
            break
    return normalized


def _normalize_analysis_payload(payload: Dict[str, Any]) -> schemas.MeetingAnalysisOutput:
    normalized_action_items = []
    seen_tasks = set()
    for item in payload.get("action_items") or []:
        if isinstance(item, dict):
            task = _clip_ai_text(_compact_ai_text(item.get("task")), AI_ITEM_MAX_CHARS)
            if not task:
                continue
            task_key = task.lower()
            if task_key in seen_tasks:
                continue
            seen_tasks.add(task_key)
            owner_raw = _clip_ai_text(_compact_ai_text(item.get("owner") or ""), 80)
            deadline_raw = _clip_ai_text(_compact_ai_text(item.get("deadline") or ""), 80)
            normalized_action_items.append(
                {
                    "task": task,
                    "owner": owner_raw if owner_raw and owner_raw.lower() not in {"unassigned", "n/a"} else "",
                    "deadline": deadline_raw if deadline_raw and deadline_raw.lower() not in {"n/a", "unassigned"} else "",
                }
            )
            if len(normalized_action_items) >= AI_ACTION_ITEMS_LIMIT:
                break

    normalized = {
        "meeting_summary": _clip_ai_text(_compact_ai_text(payload.get("meeting_summary")), AI_SUMMARY_MAX_CHARS),
        "key_points": _normalize_ai_string_list(payload.get("key_points"), AI_KEY_POINTS_LIMIT),
        "decisions": _normalize_ai_string_list(payload.get("decisions"), AI_DECISIONS_LIMIT),
        "action_items": normalized_action_items,
        "risks": _normalize_ai_string_list(payload.get("risks"), AI_RISKS_LIMIT),
        "open_questions": _normalize_ai_string_list(payload.get("open_questions"), AI_OPEN_QUESTIONS_LIMIT),
        "timeline_highlights": _normalize_ai_string_list(payload.get("timeline_highlights"), AI_TIMELINE_HIGHLIGHTS_LIMIT),
        "speaker_summaries": _normalize_ai_string_list(payload.get("speaker_summaries"), AI_SPEAKER_SUMMARIES_LIMIT),
    }
    return schemas.MeetingAnalysisOutput.model_validate(normalized)


