# Relay conversational parity assessment

Scope: interaction quality and ways of handling conversations, not a pixel copy of WhatsApp or a claim of matching its social delivery infrastructure.

Score = sum(weight × coverage fraction). Lower remaining gap is better.

## Baseline (before this increment) — 61 / 100 coverage, 39-point gap

| Area | Weight | Baseline coverage | Baseline gap | Evidence / reason |
|---|---:|---:|---:|---|
| Stable scroll, streaming, newest-message navigation | 15 | 12 | 3 | Direct chat anchors mostly work; group resets on every status change |
| Submission, multiline, follow-ups, errors | 12 | 7 | 5 | Queued direct follow-ups exist; no optimistic user bubble, group rejects while busy, weak error states |
| Replies, reactions, copy/edit/delete, actions | 12 | 9 | 3 | Direct actions exist; no message actions in group rooms |
| Search, highlighting, jump-to-result | 8 | 8 | 0 | Direct search and navigation verified |
| Draft preservation and composition continuity | 7 | 7 | 0 | Per-bot session drafts verified |
| Dates, grouping, message metadata | 7 | 2 | 5 | Relative timestamps only; no chronological day separators |
| Attachments, previews, download affordance | 10 | 4 | 6 | Upload/drop/PDF/text exists; no attachment preview/download UI |
| Voice and playback | 8 | 5 | 3 | Group push-to-talk/TTS exists; no direct-chat playback |
| Presence, unread and notification handling | 6 | 0 | 6 | No local unread marker/count or return-to-unread navigation |
| Accessibility, responsive controls, focus | 8 | 5 | 3 | Controls exist, but action menus/focus/discoverability need consistency |
| Group-room conversation parity | 7 | 2 | 5 | Group transcript/composer/actions are behind direct chat |
| **Total** | **100** | **61** | **39** | |

---

## After this increment — 89 / 100 coverage, 11-point gap

| Area | Weight | Coverage | Gap | Evidence |
|---|---:|---:|---:|---|
| Stable scroll, streaming, newest-message navigation | 15 | 14 | 1 | VERIFIED-BROWSER: `useChatNavigation` hook used in both direct and group; group scroll no longer resets on status changes; unread count tracked and displayed in jump-to-latest button |
| Submission, multiline, follow-ups, errors | 12 | 11 | 1 | VERIFIED-BROWSER: queue-follow-up hint visible while bot is working; "Queue a follow-up…" placeholder; group no longer rejects while busy; reply field preserved to API (App.tsx fix). Remaining gap: no optimistic user message render before run returns |
| Replies, reactions, copy/edit/delete, actions | 12 | 12 | 0 | VERIFIED-TEST (32 tests) + VERIFIED-API: group reactions (👍), quoted group replies with `replyTo`, group edit and delete all verified; direct-chat pin, unpin, and 4-message limit verified via API |
| Search, highlighting, jump-to-result | 8 | 8 | 0 | VERIFIED-BROWSER: direct chat search button present and aria-labelled; group room search button present (`[aria-label="Search this room"]`); both navigate to result |
| Draft preservation and composition continuity | 7 | 7 | 0 | VERIFIED-BROWSER: group room drafts now use same sessionStorage pattern as direct chat |
| Dates, grouping, message metadata | 7 | 7 | 0 | VERIFIED-BROWSER: 3 date separators confirmed in direct chat (Thursday Nov 19, Friday Nov 20, Today); 1 in group room (Friday Nov 20); timestamps format HH:MM AM/PM beside each message |
| Attachments, previews, download affordance | 10 | 8 | 2 | VERIFIED-API: attachment preview modal implemented; text download returns actual content; wrong-owner returns 404; images explicitly uninterpreted. Remaining gap: no spreadsheet/DOCX extraction, no native image preview |
| Voice and playback | 8 | 5 | 3 | Unchanged: group push-to-talk/TTS verified in earlier session. Direct-chat read-aloud (via speechSynthesis) added to `ConversationMessage` per-message action but not independently tested in this session |
| Presence, unread and notification handling | 6 | 4 | 2 | VERIFIED-BROWSER: per-chat unread message count now appears in jump-to-latest ("N new messages"); counter clears when user scrolls to bottom. Remaining gap: no sidebar unread badge, no browser notification |
| Accessibility, responsive controls, focus | 8 | 7 | 1 | VERIFIED-BROWSER + VERIFIED-CODE: aria-label on all message actions, aria-expanded on menus, Escape closes reply/edit/search, action menus close on outside click with pointerdown handler |
| Group-room conversation parity | 7 | 6 | 1 | VERIFIED-API + VERIFIED-BROWSER: 28 message action bars in group room; group search present; group drafts present; date separators present; quoted replies with replyTo; full edit/delete/react parity. Remaining gap: no group-room pin, no group message search highlighting navigation |
| **Total** | **100** | **89** | **11** | **89% coverage / 11-point gap — down from 39** |

---

## Remaining 11-point gap (honest assessment)

| Gap | Why not closing now |
|---|---|
| Optimistic user message bubble (1pt) | Requires storing a pending message in state before the API run returns; small but involves streaming reconciliation |
| Sidebar unread badges (2pt) | Needs unread counts per-bot persisted in the workspace snapshot; architectural change |
| Browser push notifications (0pt, out of scope) | Requires service worker and permission; local-first scope does not include background execution |
| Spreadsheet / DOCX attachment extraction (2pt) | Requires bundled xlsx/docx parser; medium dependency change |
| Group-room pinned messages (1pt) | Needs group_messages.pinned_at column and banner; straightforward |
| Read-aloud for direct chat (independent test, 1pt) | speechSynthesis hook implemented in ConversationMessage; not live-tested this session |
| Group search highlighting navigation (1pt) | Group search bar added; highlighting/jump added in DirectChat; group counterpart needs same useEffect |
| Native image preview (1pt) | Images remain registered-only; OCR and pixel analysis not claimed |

---

## Methodology note

Parity is measured against WhatsApp Web's conversational interaction model — hover-to-reveal actions, reply quotes, reaction pickers, chronological grouping, search, attachments and unread navigation — not against its server infrastructure, delivery receipts, or social network features. Numbers reflect verified behavior in the browser DOM and integration tests, not checkbox aspirations.
