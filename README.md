# Call Prompter

Real-time AI sales co-pilot for Google Meet.

Captures live captions during your calls, analyzes the conversation every 15 seconds, and streams actionable insights to a terminal-style overlay: closing opportunities, objection responses, budget signals, danger alerts.

You talk. AI watches your back.

## How it works

```
Google Meet (your screen)
       | Chrome CDP reads live captions every 15s
       v
Call Prompter Server
       | Claude analyzes each chunk with full context
       v
WebSocket :4242
       | streams to terminal UI
       v
Prompter UI (your second screen)
```

## Screenshot

```
+------------------------------------------+-----------------------------+
|                                          |  KEY NUMBERS                |
|  19:50 PROSPECT                          |  · 20h/week                |
|  "We lose about 20 hours a week          |  · 4000€/month             |
|   on manual monitoring..."               |                            |
|                                          |  KEY POINTS                |
|  19:50 JONAS                             |  · Manual process pain     |
|  "How much does that cost in salary?"    |  · Looking to automate     |
|                                          |                            |
|  ┌─ SAY ─────────────────────────┐       |  OBJECTIONS                |
|  │ Quantify: "20h × 50€/h =     │       |  · Need to check with      |
|  │ 4000€/month wasted"          │       |    partner → book 3-way    |
|  └───────────────────────────────┘       |                            |
|                                          |  NEXT STEPS                |
|  ┌─ CLOSE NOW ───────────────────┐       |  · Send recap tonight      |
|  │ "For your volume, our agent   │       |  · 3-way call Thursday     |
|  │ runs 24/7 for 500€/month.    │       |                            |
|  │ Setup in 48h."               │       |                            |
|  └───────────────────────────────┘       |                            |
|                                          |                            |
|  ┌─ ATTENTION ───────────────────┐       |                            |
|  │ "Talk to my partner" = flight │       |                            |
|  │ signal. Lock next meeting NOW │       |                            |
|  └───────────────────────────────┘       |                            |
|                                          |                            |
+--[LIVE]--[12:34]--[HOT]----[-|===|+]--[PAUSE]--[CLEAR]--+

```

## Demo

https://github.com/user-attachments/assets/demo.webm

## Quick start

```bash
# Clone
git clone https://github.com/OlamCreations/call-prompter
cd call-prompter

# One-time setup: configure Chrome for caption capture
node setup.mjs

# Run demo (no Chrome needed)
bun server.mjs --demo

# Open UI in browser, double-click to start demo
open ui.html
```

## Live mode — 3 ways to connect

### Option A: Chrome Extension (recommended)

No special Chrome flags. No restart. Just install and go.

```bash
# 1. Open chrome://extensions
# 2. Enable "Developer mode" (top right)
# 3. Click "Load unpacked" → select the extension/ folder
# 4. Start the server:
bun server.mjs --prospect="Acme Corp" --context="Discovery call"
# 5. Join Google Meet, enable captions (CC button)
# 6. Open ui.html on your second screen
```

The extension auto-detects Meet tabs and streams captions to the server.

### Option B: Bookmarklet (zero install)

```bash
# 1. Start the server:
bun server.mjs --prospect="Acme Corp"
# 2. Create a bookmark with this URL (see bookmarklet.js for full code):
#    javascript:void((()=>{const W='ws://127.0.0.1:4242'...})())
# 3. Join Google Meet, enable captions
# 4. Click the bookmarklet
# 5. Open ui.html
```

### Option C: Chrome CDP (advanced)

For power users. Requires Chrome launched with a special flag.

```bash
# 1. One-time setup:
node setup.mjs
# 2. Restart Chrome
# 3. Start the server:
bun server.mjs --prospect="Acme Corp"
# 4. Or use watch mode (auto-detects Meet tabs):
bun watch.mjs
```

## Watch mode (auto-detect Meet)

Automatically starts the prompter when you join a Google Meet, stops when you leave:

```bash
bun watch.mjs
```

## UI controls

| Control | Action |
|---------|--------|
| `+` / `-` keys | Increase / decrease font size |
| `Ctrl + mouse wheel` | Adjust font size |
| Slider in bottom bar | Drag to set font size (10-48px) |
| `Space` | Pause / resume feed |
| `C` | Clear feed |
| `F` | Fullscreen |
| `Esc` | Exit fullscreen |
| Double-click | Toggle demo mode |
| Sidebar `◂` button | Show / hide sidebar |

## Insight types

| Type | Color | When |
|------|-------|------|
| **Prospect** | Green card | What your prospect is saying |
| **You** | White text | What you said (subdued) |
| **Say** | Green border | Suggested response for you |
| **Close now** | Gold card, large | Closing opportunity detected |
| **Attention** | Red card, large | Danger signal (flight risk, objection) |
| **Objection** | Orange card | Objection detected + suggested counter |
| **Budget** | Purple card | Budget/pricing signal |
| **Keywords** | Teal, small | Key terms extracted |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMPTER_PORT` | `4242` | WebSocket server port |
| `CDP_PORT` | `9222` | Chrome DevTools Protocol port |

## How the AI analysis works

Every 15 seconds, the server:

1. Reads Google Meet captions via Chrome CDP
2. Deduplicates against the last chunk
3. Sends the chunk + conversation history to Claude
4. Claude returns structured JSON with:
   - Keywords detected
   - Sentiment (hot/warm/cool/cold)
   - Actionable suggestion
   - Objection + response if applicable
   - Budget signals
   - Closing opportunity + script
   - Danger alerts
5. Each insight type is broadcast to the UI via WebSocket

## Requirements

- [Bun](https://bun.sh) >= 1.0 (or Node.js >= 20)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (for AI analysis in live mode)
- Google Chrome (for CDP caption capture)
- A Google Meet call with captions enabled

## Language support

The prompter auto-detects the call language. Google Meet captions handle the transcription in the spoken language (English, French, German, Spanish, etc.), and Claude analyzes in that language while providing insights in your preferred language.

## For LLMs and AI agents

This repo includes `llms.txt` — a structured context file for AI agents working with this codebase.

If you're using Claude Code, Codex, Cursor, or any AI coding assistant:

```bash
# Point your agent to the context file
cat llms.txt
```

Common agent tasks are documented there: switching LLM providers, adding new insight types, supporting other platforms (Zoom, Teams), deploying as a web service.

## License

MIT — Olam Creations
