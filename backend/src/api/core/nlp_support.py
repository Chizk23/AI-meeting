"""NLP support: PhoBERT integration, AI summary prompts, and analysis normalization."""

import json
import os
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from src.api import models, schemas
from src.api.core.meetings_support import normalize_speaker_label

# ─── AI Constants ────────────────────────────────────────────────────────────

AI_SUMMARY_MAX_CHARS = 1400
AI_ITEM_MAX_CHARS = 220
AI_KEY_POINTS_LIMIT = 8
AI_DECISIONS_LIMIT = 6
AI_ACTION_ITEMS_LIMIT = 7
AI_RISKS_LIMIT = 4
AI_OPEN_QUESTIONS_LIMIT = 4
AI_TIMELINE_HIGHLIGHTS_LIMIT = 6
AI_SPEAKER_SUMMARIES_LIMIT = 6

# ─── PhoBERT Integration ────────────────────────────────────────────────────

_phobert_processor = None


def get_phobert_processor():
    global _phobert_processor
    if _phobert_processor is None:
        from src.nlp import PhoBERTPostProcessor

        _phobert_processor = PhoBERTPostProcessor()
    return _phobert_processor


def phobert_enabled_for(language: str) -> bool:
    return os.getenv("PHOBERT_ENABLED", "false").lower() == "true" and (language or "vi").lower() in {"vi", "auto"}


# ─── AI Text Utilities ──────────────────────────────────────────────────────


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


# ─── JSON Extraction ─────────────────────────────────────────────────────────


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


# ─── Analysis Normalization ──────────────────────────────────────────────────


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


# ─── Prompt Builders ─────────────────────────────────────────────────────────


def build_structured_summary_prompts(
    transcript: str,
    custom_instruction: str,
    language: str = "vi",
    nlp_metadata: Optional[Dict[str, Any]] = None,
    *,
    source_language: Optional[str] = None,
    include_action_items: bool = True,
) -> tuple[str, str]:
    lang_names = {"vi": "Vietnamese", "en": "English", "zh": "Chinese", "ja": "Japanese", "ko": "Korean"}
    lang_name = lang_names.get(language, "Vietnamese")

    system_prompt = (
        f"You are an executive meeting note assistant. "
        f"Respond ONLY in {lang_name}. "
        f"Return ONLY a valid JSON object, no markdown, no explanation, no extra text. "
        f"JSON must have exactly 8 keys: meeting_summary, key_points, decisions, action_items, risks, open_questions, timeline_highlights, speaker_summaries. "
        f"Create a balanced, useful meeting brief: complete enough to preserve the important content, but not a verbatim transcript. "
        f"Use only facts explicitly supported by the transcript. Do not invent decisions, owners, deadlines, or tasks. "
        f"For multilingual output, translate the same source facts into the requested language; do not add, remove, or reinterpret facts. "
        f"meeting_summary must be 4-7 clear sentences and under {AI_SUMMARY_MAX_CHARS} characters. It must mention the meeting objective/context, main discussion themes, outcomes, and next direction when present. "
        f"key_points has at most {AI_KEY_POINTS_LIMIT} important points and should cover distinct discussion topics, not only final conclusions. "
        f"decisions has at most {AI_DECISIONS_LIMIT} explicit decisions, agreements, approvals, or confirmed directions, or an empty array. "
        f"action_items has at most {AI_ACTION_ITEMS_LIMIT} explicit tasks with keys: task, owner, deadline. Include only concrete follow-up work. "
        f"For owner: use the speaker's display name from the transcript if a person is clearly responsible. If not stated, use empty string \"\". "
        f"For deadline: use the exact date/time mentioned. If not stated, use empty string \"\". "
        f"risks has at most {AI_RISKS_LIMIT} explicit blockers or risks, or an empty array. "
        f"open_questions has at most {AI_OPEN_QUESTIONS_LIMIT} unresolved questions, or an empty array. "
        f"timeline_highlights has at most {AI_TIMELINE_HIGHLIGHTS_LIMIT} short highlights with timestamps or order markers when available; use it to preserve the flow of meaningful discussion. "
        f"speaker_summaries has at most {AI_SPEAKER_SUMMARIES_LIMIT} short strings like 'Name: contribution'. "
        f"If the transcript is short or thin, still provide the useful facts available without padding."
    )
    action_instruction = (
        f"action_items has at most {AI_ACTION_ITEMS_LIMIT} explicit tasks with keys: task, owner, deadline. Include only concrete follow-up work. "
        if include_action_items
        else "action_items must be an empty array because canonical tasks are generated separately. "
    )
    system_prompt = system_prompt.replace(
        f"action_items has at most {AI_ACTION_ITEMS_LIMIT} explicit tasks with keys: task, owner, deadline. Include only concrete follow-up work. ",
        action_instruction,
    )
    source_block = f"\nSource transcript language: {source_language}." if source_language else ""
    nlp_block = ""
    if nlp_metadata:
        dialect_hint = nlp_metadata.get("dialect_hint") or "unknown"
        dialect_confidence = nlp_metadata.get("dialect_confidence")
        correction_count = nlp_metadata.get("correction_count", 0)
        terms = ", ".join(nlp_metadata.get("terms") or [])
        nlp_block = (
            "\nLow-priority transcript processing context. Use this only to interpret wording; do not infer facts from it:\n"
            f"- regional_text_hint: {dialect_hint}\n"
            f"- regional_text_confidence: {dialect_confidence}\n"
            f"- correction_count: {correction_count}\n"
            f"- detected_terms: {terms or '(none)'}\n"
        )
    user_prompt = (
        f"Admin guidance, lower priority than the concise JSON rules above:\n{custom_instruction.strip()}\n\n"
        f"{nlp_block}{source_block}\n"
        f"Return JSON in exactly this schema:\n"
        "{\n"
        '  "meeting_summary": "4-7 clear sentences covering objective/context, main discussion, outcomes, and next direction when present",\n'
        '  "key_points": ["max 8 important distinct points from the discussion"],\n'
        '  "decisions": ["max 6 explicit decisions, agreements, approvals, or confirmed directions only"],\n'
        '  "action_items": [{"task": "string", "owner": "string", "deadline": "string"}],\n'
        '  "risks": ["max 4 explicit risks or blockers"],\n'
        '  "open_questions": ["max 4 unresolved questions"],\n'
        '  "timeline_highlights": ["max 6 short timeline highlights"],\n'
        '  "speaker_summaries": ["max 6 speaker contribution summaries"]\n'
        "}\n\n"
        f"Quality bar: prefer specific, content-rich bullets over generic statements. Mention project names, numbers, constraints, deadlines, blockers, or owners when they appear in the transcript. If a field lacks evidence, return an empty array for that field.\n\n"
        f"Transcript:\n{transcript}"
    )
    return system_prompt, user_prompt


# ─── Transcript Builder ──────────────────────────────────────────────────────


def build_speaker_aware_transcript(
    transcript_text: str,
    segments: List[Dict[str, Any]],
    speaker_map: Dict[str, str],
) -> str:
    if not segments:
        return transcript_text
    lines = []
    for segment in segments:
        text = (segment.get("text") or "").strip()
        if not text:
            continue
        raw_label = normalize_speaker_label(segment.get("speaker") or segment.get("speaker_label"))
        display_name = speaker_map.get(raw_label, raw_label)
        start = float(segment.get("start", segment.get("start_time", 0)) or 0)
        lines.append(f"[{start:0.1f}s] {display_name}: {text}")
    return "\n".join(lines) or transcript_text

