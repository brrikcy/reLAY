# Relay contributor notes

## Run and verify

- Node.js 22.13+; `node:sqlite` requires a recent Node 22 release. Node 22.17 is verified.
- `npm run dev`: Vite on 5173, API on 8787.
- `npm run build`: strict TypeScript check plus production Vite build.
- `npm start`: serve the built app and API on 127.0.0.1:8787.
- `npm test`: all unit and integration tests; temporary data only.
- Run build, tests, and `npm audit` before handing off changes.

## Architecture and conventions

- TypeScript ESM throughout; React frontend, Express backend, Node built-in SQLite.
- Amazon Bedrock provider uses native Converse through `@aws-sdk/client-bedrock-runtime`. Default on this device: model `deepseek.v3.2`, region `us-east-1`, AWS profile `bedrock`, output cap 2048 tokens. Use the AWS SDK SSO chain; never save AWS credentials in SQLite.
- `npm run verify:aws`: live Bedrock use cases. Requires `RELAY_LIVE_AWS=true`, valid SSO, and may incur AWS charges. Results go to `docs/aws-validation.json`.
- Keep the app local-first. Do not add network exposure, tracking, or cloud dependencies without an explicit requirement.
- Never return provider API keys or tool secret headers to the browser. `toProvider` and `publicTool` are the confidentiality boundary.
- Model/tool activity must reflect real recorded events; never present simulated actions or hidden reasoning as real work.
- The model is not a security boundary. Enforce permissions and validation in the runtime.
- Tool calls use per-tool `auto`, `approval`, or `deny`. Approved calls execute exactly once; denied calls do not execute. Keep the pending-call checkpoint consistent.
- Routines run only while the server is online. Do not silently replay missed runs. Webhook routines require hashed Bearer keys, exact event-ID/recent-payload idempotency, and durable queueing when the owner is busy. Daily routines use the selected timezone's actual UTC offset; interval scheduling uses elapsed minutes. Execution history and bounded retry are recorded.
- Per-bot daily run/token/tool budgets are local guardrails, not provider billing guarantees. A run is reserved once, not again after approval; only executed tools consume tool allowance. Failed starts and usage are recorded.
- Attachments are bounded per bot or room. Text, JSON, CSV, XML, source text, and PDFs with extractable text can enter bounded model context; OCR and image understanding are not claimed. Registered images are explicitly uninterpreted.
- Memory retrieval is bounded local lexical relevance (term coverage and phrase matching) with pinned rules/preferences. It is not a neural embedding service or perfect semantic recall.
- Every run is bounded by provider steps, 24 recorded calls, duplicate-call suppression, failed-tool quarantine, and a four-minute deadline. Preserve partial results without allowing repeated failed calls.
- Voice uses browser PCM capture and AWS Transcribe; at most two sessions, five-minute idle timeout, fifteen-minute maximum. Do not store audio.
- Group rooms and handoffs are implemented; delegation depth is capped at two.
- Project artifacts live only in `workspace/` (override with `RELAY_PROJECT_DIR`). File writes and validation commands require approval. Path traversal and arbitrary shell commands are forbidden.
- Memory belongs to a bot; tools/providers are shared. Do not store secrets in memory or messages.
- Direct-chat replies, reactions, edits, and soft deletion are durable message actions. Keep quoted replies attached to the new message, not the original. Do not fabricate delivery receipts, unread counts, online presence, forwarding, or multi-device sync.
- Model streaming uses actual provider deltas, not simulated progress text. Auto-scroll only when the user is near the latest message; preserve older-message reading. Queue additional instructions during active runs (maximum three) and start them afterward. Keep JSON fallback for non-streaming providers.
- Keep code simple and changes scoped. Follow the existing component/API organization.
- Update README and this file if commands, architecture, security behavior, or scope changes.

## Current scope

Local development/evaluation only: no authentication, no encrypted secret storage, no production SSRF sandbox. No hosted computer, browser control, native Android/device builds, MCP transport, or production app-store deployment. Group chat, handoffs, AWS speech-to-text, bounded project artifacts, text/document attachments, webhook routines, and daily usage budgets are implemented. Do not claim production readiness without evidence. See `docs/USE_CASES.md`.
