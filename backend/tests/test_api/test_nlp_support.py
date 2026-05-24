from src.api.core.nlp_support import build_structured_summary_prompts


def test_structured_summary_prompt_includes_source_language_context():
    system_prompt, user_prompt = build_structured_summary_prompts(
        "Speaker_01: Chúng ta thống nhất rollout tuần sau.",
        "Summarize accurately.",
        language="en",
        source_language="vi",
        include_action_items=False,
    )

    assert "Respond ONLY in English" in system_prompt
    assert "action_items must be an empty array because canonical tasks are generated separately" in system_prompt
    assert "Source transcript language: vi." in user_prompt
