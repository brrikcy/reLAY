# Relay

A local-first web workspace for persistent, tool-using AI bots. Relay is an original framework inspired by publicly documented agent patterns—not xAI’s proprietary code, an official Grok product, or a complete Grok Bot clone.

## Run it

Requirements: **Node.js 22.13 or newer** (Node 22.17 is verified), npm, and a modern browser.

```powershell
npm install
npm run build
npm start
```

Open **http://127.0.0.1:8787**.

For development with automatic reloads:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the local Relay server.

The app starts with three bots. A fresh workspace begins in explicitly labeled demo mode; this device’s workspace is configured for **AWS Bedrock DeepSeek V3.2**. Demo replies never call an AI model or fetch external information. Your workspace is created at `data/relay.db` and persists across restarts.

## Amazon Bedrock DeepSeek V3.2 — configured and verified

Relay includes a native **Amazon Bedrock Converse** provider. The built-in configuration is:

- Model: `deepseek.v3.2` (in-region model ID; no inference profile required)
- Region: `us-east-1`
- AWS profile: `bedrock`
- Authentication: existing AWS IAM Identity Center (SSO) credentials through the AWS SDK provider chain
- Output cap: 2,048 tokens per model call, configurable up to 8,192
- Supports ordinary chat and client-side tool calling. DeepSeek V3.2 does not support the Responses API.

Your AWS role needs `bedrock:InvokeModel`, access to the selected model, and a supported region. No long-term AWS keys are stored in Relay. To refresh an expired SSO session, use your existing AWS sign-in flow for the `bedrock` profile, then restart Relay if necessary.

Verified on November 19, 2026 using this device’s SSO role:

- SSO identity resolution and a live `deepseek.v3.2` invocation.
- General chat and structured JSON output.
- Durable preference recall in a later model turn.
- Real model-selected REST tool arguments, approval-gated execution, and a final response using the tool result.
- Denied tool execution with zero external API calls.
- Explicit test execution of a paused routine.
- A visible, non-crashing failure for an unsupported region.
- Live responses for Scout, Atlas, and Echo in the normal workspace.

The reproducible validation harness is `scripts/verify-bedrock.ts`; its latest results are in `docs/aws-validation.json`. It uses a temporary database and harmless local weather API. Live tests require `RELAY_LIVE_AWS=true` and can incur AWS charges:

```powershell
$env:RELAY_LIVE_AWS = "true"
npm run verify:aws
```

## Connect a model

1. Open **Settings → Model providers → Add provider**, or configure the built-in xAI/OpenAI entry.
2. Enter the provider base URL, exact model name, API style, and key.
3. Save, then open a bot’s settings and select that provider.
4. Send a message.

Supported protocols:

- OpenAI-compatible **Chat Completions**: `POST {baseUrl}/chat/completions`
- OpenAI-compatible **Responses**: `POST {baseUrl}/responses`
- Amazon Bedrock **Converse** through `@aws-sdk/client-bedrock-runtime` and the standard AWS credential chain.

The provider must support the protocol you select and function calling if you want tools. Compatibility varies across custom/local providers; Relay does not translate non-OpenAI API formats. The included xAI/OpenAI presets are configuration shortcuts, not tested accounts. A real provider requires your own valid key, model access, and available quota. Model and API charges are your responsibility.

Examples of base URLs:

- xAI: `https://api.x.ai/v1`
- OpenAI: `https://api.openai.com/v1`
- A compatible local server: `http://127.0.0.1:11434/v1` (verify that server’s API style and model name)

## Connect any REST API

1. Open **Connections → Connect an API**.
2. Give the tool a function name and a precise description.
3. Configure its method, endpoint, JSON Schema arguments, and permission policy.
4. Add public headers or server-side secret headers if needed.
5. Save, then assign the tool in **bot settings**.

Example weather tool:

```text
Name: get_weather
Method: GET
URL: https://api.example.com/weather
Permission: Ask for approval every time
```

```json
{
  "type": "object",
  "properties": {
    "city": {
      "type": "string",
      "description": "City name, e.g. London"
    }
  },
  "required": ["city"],
  "additionalProperties": false
}
```

- `GET` and `DELETE`: schema arguments become URL query parameters.
- `POST`, `PUT`, and `PATCH`: arguments become a JSON request body.
- Use `{{city}}` in a URL to insert an argument. URL structure is preserved; query values are encoded. A complete `{{url}}` template is supported by the built-in public webpage reader, which rejects private targets and does not execute JavaScript or bypass access controls.
- Public and secret header values also support `{{argument}}` interpolation.
- The model sees the function name, description, and JSON Schema—not secret header values.
- Responses are capped at 512 KB read / 24,000 characters passed to the model, with timeouts and a redirect limit.

**Start with read-only endpoints and harmless test data.** Keep sending, publishing, purchases, deletion, and production changes behind approval. “Allow once” applies to one requested call. Denial returns a denial result to the model; it does not prevent the model from proposing another action in a later run, so also use a restrictive policy or remove a tool when appropriate.

## Current capabilities and use cases

- Persistent specialist bots, one-to-one chat, and shared rooms with @mentions and specialist handoffs.
- Push-to-talk group voice: browser microphone PCM → AWS Transcribe → selected bots. Device speech synthesis reads replies. Relay does not store audio.
- Public current-news, Wikipedia research, and read-only public HTML extraction with source URLs and explicit truncation/access limitations. This is not JavaScript browser control or an X/paywall connector.
- Live practical data: weather/geocoding, country data, exchange rates, and holidays.
- Text/document attachments for bots and rooms (up to 5 MB). Text, JSON, CSV, XML, source files, and PDFs with extractable text enter bounded model context; registered images are explicitly uninterpreted. Scanned PDFs/OCR and image understanding are not implemented.
- Local relevance-ranked memory retrieval using meaningful term coverage and phrase matching, with pinned rules/preferences. It is lexical retrieval, not a neural embedding service or perfect semantic recall.
- Reusable skills and approval-gated real file artifacts in `workspace/`.
- Interval, daily-local-time, and authenticated webhook routines, with pause/test controls, hashed keys, idempotent event delivery, durable queued execution, bounded retry, and execution history.
- Per-bot daily run, model-token, and executed-tool budgets with remaining usage shown in Settings. These are guardrails, not a provider billing guarantee.
- Unified direct/group history search and JSON exports.
- WhatsApp-inspired direct and group-chat behaviors: quoted replies, reaction toggles, copy/edit/delete actions, up to four direct-chat pins, chronological day separators, in-chat result navigation, per-bot/room session drafts, new-message counts while reading older messages, and jump-to-latest. Attachment chips open bounded extracted-text previews with honest text-only downloads. Delivery receipts, real online presence, forwarding, sidebar unread aggregation, and multi-device sync are not claimed.
- Progressive model streaming for Chat Completions SSE and Bedrock ConverseStream, with position-preserving updates and a non-streaming JSON fallback. Additional instructions during active chat are queued (up to three) and start after the current run.
- Loop safeguards: duplicate-call suppression, failed-tool quarantine, provider step limits, 24 recorded calls, four-minute deadline, and bounded context.

See **[docs/USE_CASES.md](docs/USE_CASES.md)** for the Grok-inspired workflow coverage matrix. Gmail, Slack, calendar, CRM, and document workflows require your own connectors. Hosted computer control, native Android/device builds, encrypted production vaults, deployment, and guaranteed app-store recognition are not implemented.

## What is implemented

- Persistent bot profiles with focused instructions, model providers, and assigned tools.
- SQLite-backed conversations, durable memories, run records, tool activity, and approvals.
- A bounded model → tool call → tool result → model loop.
- Per-tool `auto`, `approval`, and `deny` policies.
- Manual memories plus chat commands:
  - `Remember that I prefer concise weekly updates.`
  - `What do you remember?`
  - `Forget that I prefer concise weekly updates.`
- Interval and authenticated webhook routines with pause/resume, explicit test runs, and durable trigger records.
- Text/document attachments and per-bot daily usage budgets.
- Live updates through Server-Sent Events.
- Responsive desktop/mobile interface.
- Secret values excluded from browser API responses.
- Basic JSON Schema argument validation, HTTP target checks, redirect/response bounds, and step limits.

## Scope and security

**Relay is ready for local evaluation and development. It is not production-hardened or multi-user.**

- It binds to `127.0.0.1` by default and has **no user authentication**. Do not expose it to a network or the public internet.
- API keys and secret headers are stored **unencrypted** in `data/relay.db`. Restrict access to that file and back it up appropriately. This is not an encrypted credential vault.
- Tool HTTP checks block many private/reserved network targets and recheck redirects, but DNS rebinding and other SSRF risks are not fully eliminated. Only configure trusted endpoints and use scoped, least-privilege credentials.
- Tool output is untrusted data. Prompt injection can still influence a model; a system prompt is not a security boundary.
- Routines run only while the Relay server is online. Missed intervals are skipped, not replayed. They can spend API credits, and their tool calls can have real effects. Daily schedules use the selected IANA timezone and actual UTC offset. Webhook events are durably queued when the bot is busy, with one bounded retry after eligible failures. Webhook endpoints are local API routes, not internet-reachable unless you deliberately provide a secure tunnel. Keys are shown once and stored only as SHA-256 hashes; use HTTPS and authentication at any tunnel boundary.
- Attachments are stored in local SQLite. Document text is untrusted and bounded to 20,000 characters per model context; upload size is 5 MB and text is capped at 200,000 characters. PDF text extraction uses PDF.js and reports page count/truncation; scanned/image-only PDFs require OCR, which is not implemented. Images are registered only, not visually analyzed.
- Memory retrieval uses bounded local lexical relevance, not neural embeddings or semantic/vector search. Rules/preferences remain pinned; older relevant facts may be selected by the current request.
- Daily budgets reset using the server date. A run consumes one allowance even after approval resume; only actually executed tools consume tool allowance. Provider pricing, retries, in-flight calls, and accounting differences mean budgets do not guarantee a dollar limit.
- Completed actions cannot be undone by stopping a run. Interrupted runs fail closed on restart and are not automatically retried.
- Memory is contextual, not authoritative. Re-check changing facts and never save passwords, payment data, one-time codes, or API keys as memories or chat messages.
- The frontend uses Google Fonts; use a local font bundle if you require completely offline UI rendering.

Not included: Grok’s hosted cloud computer, browser/computer control, voice calls, encrypted vault, app marketplace, MCP transport, native Android/device builds, OCR/office/media analysis, image understanding, neural semantic memory, or production deployment. These are not simulated.

## Configuration

Environment variables are read from the process environment, not automatically from `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server bind address. Keep it local. |
| `PORT` | `8787` | Server port. |
| `RELAY_DATA_FILE` | `./data/relay.db` | SQLite file location. |
| `RELAY_ALLOW_PRIVATE_NETWORK` | unset | Set to `true` only for trusted local/private APIs. Disables private-network target blocking. |

PowerShell example for a trusted local tool API:

```powershell
$env:RELAY_ALLOW_PRIVATE_NETWORK = "true"
npm start
```

## Verify

```powershell
npm run build
npm test
npm audit
```

The test suite uses temporary local mock model/API servers and a temporary SQLite database. It does not require API keys or modify your normal workspace data. It verifies approvals, denial, argument handling, persistence, confidentiality, protocol adapters, and routine execution.

## Research and documentation

The in-app **How it works** page links the source material. Primary references reviewed November 19, 2026:

- [How Grok Bot works](https://docs.x.ai/grok-bot/how-grok-bot-works)
- [Create and manage Bots](https://docs.x.ai/grok-bot/bots)
- [Designing Grok Bot for persistent agents](https://x.ai/news/designing-grok-bot)
- [Skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [xAI function calling](https://docs.x.ai/developers/tools/function-calling)
- [xAI multi-agent documentation](https://docs.x.ai/developers/model-capabilities/text/multi-agent)
- [Open Grok community implementation](https://github.com/mweinbach/open-grok)
- [Community self-hosted Grok Bot clone](https://github.com/nickvasilescu/grokbot-clone)

Documented patterns informed the design; no proprietary implementation is claimed. Community projects are unaffiliated references, not dependencies or endorsements.

## Project structure

```text
server/
  index.ts                 HTTP API and persistence routes
  db.ts                    SQLite schema, migrations, seed data
  runtime/
    agent.ts               Bounded agent loop and approval lifecycle
    providers.ts           Chat Completions / Responses adapters
    tools.ts               Validated, bounded HTTP tool execution
    memory.ts              Durable memory and explicit chat commands
    routines.ts            Interval scheduler and trigger reconciliation
    routine-webhooks.ts    Hashed keys, idempotency, durable trigger records
    attachments.ts         Bounded bot/room document registration and context
    pdf.ts                 PDF.js page-text extraction
    retrieval.ts           Local lexical memory relevance
    budgets.ts             Daily usage reservation and accounting
    web-research.ts        News normalization and bounded HTML extraction
src/
  App.tsx                  Live workspace state and SSE integration
  components/              Chat, settings, connections, research, modals
  styles.css               Responsive UI
 tests/                    Unit and end-to-end tests
```
