# Local-first privacy, untrusted content and release boundaries

Reviewed: 2026-09-08. Classification: public security reference; not a security certification.

OWASP describes prompt injection as a risk when instructions and untrusted content are mixed. Layered defenses include separating source data from instructions, validating outputs, limiting tool permissions and requiring human approval for consequential actions. Prompt wording alone is not a reliable security boundary. [Source: OWASP prompt injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

Public source code and personal knowledge belong in separate storage domains. Personal databases, attachments, logs, exports, training data and credentials should stay outside the public repository. Ignore rules and filename gates reduce accidental staging; they do not encrypt content, remove historical leaks or replace secret scanning.

Private model payloads should use an explicitly trusted local service, with proxy and redirect behavior constrained. Local inference does not mean the whole application is offline: model downloads, updates, web retrieval and enabled integrations can use the network. Do not send personal prompts or files to a remote service merely because it offers better answers.

Ordinary SQLite is not encrypted application storage. OS account permissions and disk encryption are separate protections. Remote backups require authenticated encryption with recoverable keys kept separately, private destination verification, and a restore drill before relying on them.
