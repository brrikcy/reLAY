# Relay use-case coverage

Reviewed against the official Grok Bot use-case catalog and public user workflows on November 19, 2026. “Supported” means implemented in Relay, not simulated. External-service workflows still require the relevant connector and user authorization.

## Works locally now

- **Persistent specialist bots** with separate instructions, memory, model settings, and tool assignments.
- **One-to-one chat and shared rooms** with @mentions, multiple recipients, and specialist handoffs capped at two levels.
- **Push-to-talk group voice** using browser PCM capture and AWS Transcribe. Final text is sent to selected bots. Replies use device speech synthesis. Relay does not store microphone audio.
- **Public research** using current Google News headlines, Wikimedia background, and bounded read-only HTML extraction with returned source URLs and explicit truncation/access limitations. No JavaScript browser, X, or paywall access is implied.
- **Text/document attachments** for bots and rooms, with bounded model context and PDF.js text extraction. Registered images and scanned/image-only PDFs are explicitly uninterpreted without OCR.
- **Local relevance-ranked memory** using meaningful term coverage and phrase matching with pinned rules/preferences, not neural semantic embeddings.
- **Interval, daily-local-time, and webhook routines** with hashed one-time keys, event-ID/recent-payload idempotency, durable queued execution, bounded retry, and execution history. Missed runs remain skipped.
- **Per-bot daily usage budgets** for runs, model tokens, and executed tools. These are local guardrails, not provider billing guarantees.
- **Live practical data** using Open-Meteo geocoding/weather, countries.dev, Frankfurter exchange rates, and Nager.Date holidays.
- **Custom REST APIs** using JSON Schema, server-side secret headers, validation, and per-tool approval policies.
- **Reusable skills** for research, morning briefs, writing, and PWA scaffolds.
- **Actual artifacts** in a bounded local project directory, including approval-gated file creation and predefined validation commands.
- **Interval routines**, paused/test modes, live activity, partial-result recovery, and bounded run history.
- **Loop safeguards**: duplicate call blocking, failed-tool quarantine, 8-step provider limit, 24 recorded calls, four-minute run deadline, bounded memory/context, and limited voice sessions.

## Requires your own connectors or authorization

- Gmail/inbox triage and reply drafting
- Google Calendar/meeting preparation
- Slack/Teams monitoring and draft responses
- Notion/Google Drive/Granola document workflows
- CRM lead qualification, customer health, and sales development
- Invoice/receipt/purchase-order reconciliation
- ATS/candidate sourcing and outreach
- Paid-media and campaign data analysis
- Full-text web-page reading beyond news headlines and Wikipedia summaries
- PDF/office/media analysis beyond extractable PDF text, OCR, neural semantic memory, and native Android builds

Use **Connections → Connect an API** for these services. Do not paste service credentials into chat. Start read-only and require approval for writes.

## Explicitly not a production substitute for Grok Bot

- Hosted cloud computer, browser control, or remote desktop takeover
- Full desktop operating system/file access
- Native Android builds, emulator/device testing, or Play Store publication
- Guaranteed production readiness, deployment, user adoption, or app-store recognition
- Encrypted production secret vault or multi-user authentication
- Full MCP transport/plugin marketplace
- Voice calls to businesses or always-on cloud execution when Relay is stopped
- Production-grade sandboxing for arbitrary code or untrusted multi-tenant APIs

For a lightweight app request, Relay can produce a small PWA scaffold and validate it. Native Android packaging requires a separately configured toolchain and explicit approval.
