# Call Prompter

Real-time AI sales co-pilot for Google Meet.

Captures live captions during your calls, analyzes the conversation every few seconds, and streams actionable insights to a terminal-style overlay on your second screen: what to say, when to close, objection counters, budget signals, flight risk alerts.

You talk. AI watches your back.

## How it works

```
Google Meet (captions enabled)
       |
       | Extension reads captions from DOM in real-time
       v
Call Prompter Server (local)
       |
       | LLM analyzes chunks with your sales context
       v
WebSocket :4242
       |
       v
Prompter UI (second screen)
```

## Demo

https://github.com/user-attachments/assets/demo.webm

## Quick start (demo mode)

```bash
git clone https://github.com/OlamCreations/call-prompter
cd call-prompter

# Run demo — no Google Meet needed, no LLM needed
bun server.mjs --demo

# Open ui.html in your browser, double-click to start the demo
```

## Live mode — 3 ways to capture captions

All three options require the server running and Google Meet captions enabled.

### Step 1: Start the server

```bash
bun server.mjs --prospect="Acme Corp" --context="Discovery call"
```

### Step 2: Enable captions in Google Meet

This is required for all capture methods. The prompter reads the caption text from the page.

1. Join your Google Meet call
2. Click the **CC** button at the bottom of the Meet screen (or press `c`)
3. If you don't see captions appearing, click the **three dots (...)** menu -> **Settings** -> **Captions** -> toggle **Captions** on
4. **Set the caption language** to match the spoken language of the call:
   - Three dots (...) -> Settings -> Captions -> **Spoken language**
   - Choose the primary language being spoken (English, French, German, Spanish, etc.)
   - If participants switch languages mid-call, update this setting or set it to the dominant language
5. Captions should now appear at the bottom of your Meet window — the prompter reads these

### Step 3: Connect captions to the server

Pick one:

#### Option A: Chrome Extension (recommended)

No special flags. No Chrome restart. Install once, works on every Meet call.

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo
5. You should see "Call Prompter" in your extensions list
6. Join a Google Meet call — the extension auto-detects it and starts streaming captions

The extension icon shows connection status. Click it to see if the server is receiving captions.

#### Option B: Bookmarklet (zero install)

No extension needed. Just a bookmark.

1. Open `bookmarklet.js` from this repo
2. Copy the `javascript:void(...)` line
3. Create a new bookmark in Chrome, paste it as the URL
4. Join a Google Meet call with captions enabled
5. Click the bookmarklet — it injects a caption reader into the page

#### Option C: Chrome CDP (advanced)

For developers. Enables watch mode (auto-detect Meet tabs).

```bash
# One-time: configure Chrome to expose DevTools Protocol
node setup.mjs

# Restart Chrome, then:
bun watch.mjs    # auto-starts prompter when you join Meet
```

### Step 4: Open the prompter UI

Open `ui.html` in your browser (second screen, or split-screen with Meet).

It auto-connects to the server via WebSocket. Insights stream in real-time as the call progresses.

## LLM providers

The server supports multiple LLM backends. Default is Claude Code CLI.

```bash
# Claude Code CLI (default, no API key needed if logged in)
bun server.mjs --prospect="Client"

# Claude API
ANTHROPIC_API_KEY=sk-... bun server.mjs --provider=anthropic --prospect="Client"

# OpenAI
OPENAI_API_KEY=sk-... bun server.mjs --provider=openai --model=gpt-4o-mini --prospect="Client"

# Local Ollama (free, no API key)
bun server.mjs --provider=ollama --model=llama3 --prospect="Client"

# Any OpenAI-compatible API
CUSTOM_API_URL=https://api.together.xyz/v1/chat/completions CUSTOM_API_KEY=... bun server.mjs --provider=custom --model=meta-llama/Llama-3-70b --prospect="Client"
```

## Your sales context (playbook)

Create a `context.md` file with your business context. It gets injected into every LLM analysis so the AI knows your product, pricing, and selling style.

```bash
cp context.example.md context.md
# Edit with your info, then:
bun server.mjs --context-file=context.md --prospect="Client"
```

The context file should include: your product description, pricing tiers, differentiators, common objections with responses, closing triggers, and preferred tone. See `context.example.md` for a template.

If no `--context-file` is specified, the server auto-loads `context.md` from the project root if it exists.

## Hooks (plug your own pipelines)

Hooks let you extend the analysis loop with your own code: RAG retrieval, CRM lookups, custom logging, post-call workflows.

```bash
cp hooks.example.mjs hooks.mjs
# Edit with your logic, then:
bun server.mjs --prospect="Client"    # hooks.mjs is auto-loaded
```

Available hooks:

| Hook | When | Use case |
|------|------|----------|
| `beforeAnalysis` | Before each LLM call | RAG search, vector DB, CRM lookup — inject extra context |
| `afterAnalysis` | After LLM returns | Enrich insights, add scoring, filter noise |
| `onTranscript` | On every new caption | Log to file, stream to webhook, real-time pipeline |
| `onCallEnd` | When call ends (watch mode) | Post-call summary, CRM update, follow-up email |

See `hooks.example.mjs` for documented examples with RAG, CRM, Slack, and webhook integrations.

## UI controls

| Control | Action |
|---------|--------|
| `+` / `-` keys | Increase / decrease font size |
| `Ctrl` + mouse wheel | Adjust font size |
| Slider in bottom bar | Drag to set font size (10-48px) |
| `Space` | Pause / resume feed |
| `C` | Clear feed |
| `F` | Fullscreen |
| `Esc` | Exit fullscreen |
| Double-click | Toggle demo mode |
| Sidebar arrow button | Show / hide sidebar |

## Insight types

| Type | Visual | What it means |
|------|--------|---------------|
| **Prospect** | Forest green glass card | What your prospect is saying — the most important text |
| **You** | Muted text | What you said — subdued because you already know |
| **Say** | Teal glass card | Suggested response — what you should say right now |
| **Close Now** | Amber glass card, large | Closing opportunity — a script to close the deal |
| **Warning** | Red glass card, large | Flight risk or disengagement signal |
| **Objection** | Orange glass card | Objection detected with a counter-argument |
| **Budget Signal** | Amber accent card | Pricing or budget information detected |
| **Keywords** | Small teal text | Key terms extracted from the conversation |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMPTER_PORT` | `4242` | WebSocket server port |
| `CDP_PORT` | `9222` | Chrome DevTools Protocol port (CDP mode only) |
| `CAPTURE_INTERVAL` | `3000` | CDP reconnect check interval in ms |
| `ANALYSIS_INTERVAL` | `8000` | LLM analysis interval in ms |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama server URL |
| `CUSTOM_API_URL` | — | Custom OpenAI-compatible API endpoint |
| `CUSTOM_API_KEY` | — | API key for custom endpoint |

## How caption capture works

**Extension / Bookmarklet mode:** A MutationObserver watches the Google Meet DOM for caption elements. When new caption text appears (typically within 100-500ms of being spoken), it's sent to the server via WebSocket. A 500ms backup poll catches anything the observer misses.

**CDP mode:** A persistent WebSocket connection to Chrome's DevTools Protocol injects the same MutationObserver directly into the Meet page. No extension needed, but requires Chrome launched with `--remote-debugging-port=9222`.

**Analysis:** Every 8 seconds, the server merges recent caption chunks and sends them to the configured LLM with conversation history and your sales context. The LLM returns structured JSON insights that are broadcast to the UI.

## Caption language tips

Google Meet's caption quality depends on the language setting matching the spoken language:

1. **Single language call:** Set Meet captions to that language. Straightforward.
2. **Bilingual call:** Set captions to the dominant language. Meet handles code-switching reasonably well for closely related language pairs (EN/FR, EN/ES) but may struggle with distant pairs.
3. **The LLM adapts:** Regardless of caption language, the LLM analyzes in whatever language the captions arrive and provides insights in English (or your context file's language).
4. **Accent handling:** Meet's speech recognition works best with clear audio. Use a headset if possible, especially in noisy environments.

## Requirements

- [Bun](https://bun.sh) >= 1.0 (or Node.js >= 20)
- Google Chrome with Google Meet
- One of: [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), Anthropic API key, OpenAI API key, [Ollama](https://ollama.ai), or any OpenAI-compatible API

## For LLMs and AI agents

This repo includes `llms.txt` — a structured context file for AI agents working with this codebase.

```bash
cat llms.txt    # full architecture, file map, modification guide, common tasks
```

## License

MIT — Olam Creations
