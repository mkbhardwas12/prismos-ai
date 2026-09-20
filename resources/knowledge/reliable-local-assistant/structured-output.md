# Structured outputs and complete document specifications

Reviewed: 2026-09-08. Classification: public technical reference.

Ollama supports constraining a response using a JSON schema in the `format` field. Its documentation recommends also grounding the prompt in the expected structure and validating the returned object in application code. Structured output improves format reliability, not truthfulness. [Source: Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)

Application acceptance should check required titles, correct field types, nonempty substantive content, limits on record counts and lengths, and valid layout variants. A transport response cut short by the token budget is incomplete even if part of it can be parsed. Closing brackets on truncated output can silently create a partial document; a bounded complete regeneration or visible failure is safer.

Separate the user's request from retrieved source material. Provide source IDs and explicitly distinguish assumptions from supported claims. Validate before writing. Reserve a new output file atomically so concurrent requests do not overwrite earlier work. Return an attachment only after the writer succeeds. ZIP/XML structural checks establish container integrity; opening or rendering the file is still needed to assess layout and readability.

PrismOS's audited document lane produces DOCX and PPTX. JSON validation alone does not prove that every requested landscape, citation, or executive decision has been covered.
