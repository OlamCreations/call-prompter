#!/usr/bin/env node

/**
 * Call Prompter Server — Real-time sales co-pilot
 *
 * 1. Connects to Google Meet via Chrome CDP (port 9222)
 * 2. Captures live captions every ~15 seconds
 * 3. Sends chunks to any LLM for real-time analysis
 * 4. Streams insights to UI via WebSocket (port 4242)
 *
 * Usage:
 *   bun server.mjs --prospect="Company X" --context="Discovery call"
 *   bun server.mjs --provider=openai --model=gpt-4o
 *   bun server.mjs --provider=ollama --model=llama3
 *   bun server.mjs --context-file=my-playbook.md
 *   bun server.mjs --demo
 *
 * Providers:
 *   claude       Claude Code CLI (default, no API key needed)
 *   anthropic    Claude API (needs ANTHROPIC_API_KEY)
 *   openai       OpenAI API (needs OPENAI_API_KEY)
 *   ollama       Local Ollama (needs ollama running)
 *   custom       Any OpenAI-compatible API (needs CUSTOM_API_URL + CUSTOM_API_KEY)
 *
 * Context file:
 *   A markdown file with your business context, offers, pricing, talking points.
 *   Injected into every analysis prompt so the AI knows YOUR product.
 *
 * Requirements:
 *   - Chrome running with --remote-debugging-port=9222
 *   - Google Meet open with captions enabled
 *   - One of: Claude CLI, ANTHROPIC_API_KEY, OPENAI_API_KEY, ollama, CUSTOM_API_URL
 */

import { WebSocketServer } from 'ws'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_PORT = Number(process.env.PROMPTER_PORT) || 4242
const CDP_PORT = Number(process.env.CDP_PORT) || 9222
const CAPTURE_INTERVAL_MS = Number(process.env.CAPTURE_INTERVAL) || 3000
const ANALYSIS_INTERVAL_MS = Number(process.env.ANALYSIS_INTERVAL) || 8000
const MAX_HISTORY_CHUNKS = 60

// ─── Args ────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(name) { return args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') }

// ─── Config file (for non-devs) ──────────────────────────────

let fileConfig = {}
const configPath = join(__dirname, 'config.json')
if (existsSync(configPath)) {
  try { fileConfig = JSON.parse(readFileSync(configPath, 'utf-8')) } catch {}
}

const isDemo = args.includes('--demo')
const prospect = getArg('prospect') || fileConfig.prospect || 'Unknown'
const context = getArg('context') || fileConfig.context || 'Sales call'
const brief = getArg('brief') || ''
const provider = getArg('provider') || process.env.PROMPTER_PROVIDER || fileConfig.provider || 'claude'
const model = getArg('model') || process.env.PROMPTER_MODEL || fileConfig.model || ''
const contextFilePath = getArg('context-file') || fileConfig.context_file || ''

// Apply API key from config.json if env var not set
if (fileConfig.api_key && fileConfig.api_key !== 'sk-paste-your-key-here') {
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = fileConfig.api_key
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = fileConfig.api_key
  if (provider === 'custom' && !process.env.CUSTOM_API_KEY) process.env.CUSTOM_API_KEY = fileConfig.api_key
}

// ─── Context File ────────────────────────────────────────────

let userContext = ''
if (contextFilePath && existsSync(contextFilePath)) {
  userContext = readFileSync(contextFilePath, 'utf-8').trim()
} else if (existsSync(join(__dirname, 'context.md'))) {
  userContext = readFileSync(join(__dirname, 'context.md'), 'utf-8').trim()
}

// ─── Hooks (extend with your own pipelines) ─────────────────

const hooksPath = getArg('hooks') || (existsSync(join(__dirname, 'hooks.mjs')) ? join(__dirname, 'hooks.mjs') : '')
let hooks = {
  // Called before LLM analysis. Return enriched context string (e.g. from RAG).
  // (chunk, history, userContext) => Promise<string>
  beforeAnalysis: null,

  // Called after LLM returns parsed insights. Mutate or enrich insights.
  // (parsed, chunk, history) => Promise<object>
  afterAnalysis: null,

  // Called on every new transcript chunk. Use for logging, streaming, etc.
  // (chunk) => Promise<void>
  onTranscript: null,

  // Called when call ends (watch mode). Use for post-call summary pipelines.
  // (fullTranscript, insights) => Promise<void>
  onCallEnd: null,
}

async function loadHooks() {
  if (!hooksPath) return
  try {
    const userHooks = await import(hooksPath)
    hooks = { ...hooks, ...userHooks.default || userHooks }
    console.log(`  Hooks:    loaded from ${hooksPath}`)
  } catch (err) {
    console.log(`  Hooks:    failed to load (${err.message})`)
  }
}

// ─── State (append-only arrays, no mutation) ─────────────────

let chunks = []
let insights = []
let currentSentiment = 'warm'

// ─── WebSocket Server ────────────────────────────────────────

// ─── HTTP Server (serves UI on http://127.0.0.1:PORT) ───────

const httpServer = Bun?.serve?.({
  port: WS_PORT + 1,
  async fetch(req) {
    const url = new URL(req.url)
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

    // Save config from extension settings
    if (url.pathname === '/config' && req.method === 'POST') {
      try {
        const body = await req.json()
        const config = {
          provider: body.provider || 'openai',
          model: body.model || '',
          api_key: body.api_key || '',
          custom_api_url: body.custom_url || '',
          prospect: prospect,
          context: context,
          context_file: contextFilePath,
        }
        writeFileSync(join(__dirname, 'config.json'), JSON.stringify(config, null, 2))
        return Response.json({ ok: true, message: 'Config saved. Restart server to apply.' }, { headers: cors })
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 400, headers: cors })
      }
    }

    if (url.pathname === '/status') {
      return Response.json({ ok: true, connected: clients.size, prospect, context, provider, chunks: chunks.length, sentiment: currentSentiment }, { headers: cors })
    }
    try {
      const uiPath = join(__dirname, 'ui.html')
      const html = readFileSync(uiPath, 'utf-8')
      return new Response(html, { headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' } })
    } catch {
      return new Response('UI not found. Place ui.html next to server.mjs', { status: 404 })
    }
  },
}) || null

if (httpServer) {
  console.log(`  UI HTTP:   http://127.0.0.1:${WS_PORT + 1}`)
}

// ─── WebSocket Server ────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT })
const clients = new Set()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))

  // Accept captions from Chrome extension (no CDP needed)
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'caption' && msg.text) {
        onCaptionReceived(msg.text)
      }
    } catch {}
  })

  broadcast({ type: 'system', text: `Prompter active — ${prospect} — ${context}` })
})

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data)
  }
}

// ─── CDP Caption Capture (persistent stream) ────────────────

let cdpWs = null
let cdpConnected = false
let lastCaptionText = ''

async function getCdpTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
    const targets = await res.json()
    return targets.filter(t => t.url?.includes('meet.google.com'))
  } catch {
    return []
  }
}

function onCaptionReceived(text) {
  if (!text || text.length < 3) return
  if (text === lastCaptionText) return
  lastCaptionText = text

  const chunk = { text, ts: Date.now() }
  chunks = [...chunks, chunk].slice(-MAX_HISTORY_CHUNKS)
  broadcast({ type: 'transcript', speaker: 'Meet', text })

  if (hooks.onTranscript) {
    hooks.onTranscript(chunk).catch(() => {})
  }
}

async function connectCdpStream() {
  const targets = await getCdpTargets()
  if (targets.length === 0) {
    if (cdpConnected) {
      broadcast({ type: 'system', text: 'Meet tab closed.' })
      cdpConnected = false
    }
    return
  }

  const wsUrl = targets[0].webSocketDebuggerUrl
  if (!wsUrl || cdpConnected) return

  try {
    cdpWs = new WebSocket(wsUrl)
    let msgId = 1

    cdpWs.onopen = () => {
      cdpConnected = true
      broadcast({ type: 'system', text: 'Connected to Google Meet (real-time capture)' })

      // Inject MutationObserver that pushes captions via console.log
      // We listen for Runtime.consoleAPICalled events
      cdpWs.send(JSON.stringify({ id: msgId++, method: 'Runtime.enable', params: {} }))

      cdpWs.send(JSON.stringify({
        id: msgId++,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              if (window.__captionObserver) return 'ALREADY_RUNNING';

              let lastText = '';
              const SELECTORS = [
                '[jsname="tgaKEf"]',
                '[data-message-text]',
                '.iOzk7',
                '[jscontroller="TEjod"] span',
                '.TBMuR span',
                'div[class*="caption"] span',
                'div[class*="subtitle"] span',
              ];

              function readCaptions() {
                for (const sel of SELECTORS) {
                  const els = document.querySelectorAll(sel);
                  if (els.length > 0) {
                    const text = Array.from(els).map(el => el.textContent).filter(Boolean).join(' ').trim();
                    if (text && text !== lastText && text.length > 2) {
                      lastText = text;
                      console.log('__CAPTION__' + text);
                    }
                    return;
                  }
                }
              }

              // MutationObserver on body — fires on any DOM change (captions appearing)
              window.__captionObserver = new MutationObserver(() => readCaptions());
              window.__captionObserver.observe(document.body, {
                childList: true, subtree: true, characterData: true
              });

              // Also poll every 500ms as backup
              window.__captionInterval = setInterval(readCaptions, 500);

              return 'OBSERVER_INSTALLED';
            })()
          `,
          returnByValue: true,
        },
      }))
    }

    cdpWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)

        // Listen for console.log events from our MutationObserver
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'log') {
          const text = msg.params.args?.[0]?.value || ''
          if (text.startsWith('__CAPTION__')) {
            onCaptionReceived(text.slice('__CAPTION__'.length))
          }
        }
      } catch {}
    }

    cdpWs.onclose = () => {
      cdpConnected = false
      cdpWs = null
      broadcast({ type: 'system', text: 'CDP disconnected. Reconnecting...' })
    }

    cdpWs.onerror = () => {
      try { cdpWs?.close() } catch {}
    }
  } catch {
    cdpConnected = false
  }
}

// Analysis loop — runs independently, non-blocking
let analysisRunning = false
async function analysisLoop() {
  if (analysisRunning || chunks.length === 0) return
  analysisRunning = true
  try {
    const latestChunks = chunks.slice(-5)
    const merged = { text: latestChunks.map(c => c.text).join(' '), ts: Date.now() }
    await analyzeChunk(merged)
  } catch {}
  analysisRunning = false
}

// ─── LLM Analysis (multi-provider) ──────────────────────────

function buildPrompt(chunk, history) {
  return `You are a real-time sales co-pilot. Analyze this latest conversation chunk.

Prospect: ${prospect}
Context: ${context}
${brief ? 'Brief: ' + brief : ''}
${userContext ? '\n--- YOUR PLAYBOOK ---\n' + userContext + '\n--- END PLAYBOOK ---\n' : ''}
Latest chunk (15s):
${chunk.text}

Recent history:
${history}

Respond in strict JSON (no markdown, no backticks):
{"keywords":["word1","word2"],"sentiment":"hot|warm|cool|cold","insight":"key observation","suggestion":"what the seller should do NOW","objection_detected":"or null","objection_response":"or null","budget_signal":"or null","closing_opportunity":false,"closing_script":"or null","danger":"or null"}`
}

async function callLLM(prompt) {
  switch (provider) {
    case 'claude': return callClaude(prompt)
    case 'anthropic': return callAnthropicAPI(prompt)
    case 'openai': return callOpenAI(prompt)
    case 'ollama': return callOllama(prompt)
    case 'custom': return callCustom(prompt)
    default: return callClaude(prompt)
  }
}

function callClaude(prompt) {
  const result = execFileSync('claude', ['-p', prompt, '--output-format', 'text'], {
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL: '1' },
  })
  return result.trim()
}

async function callAnthropicAPI(prompt) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callOllama(prompt) {
  const url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'llama3',
      prompt,
      stream: false,
    }),
  })
  const data = await res.json()
  return data.response || ''
}

async function callCustom(prompt) {
  const url = process.env.CUSTOM_API_URL
  const key = process.env.CUSTOM_API_KEY || ''
  if (!url) throw new Error('CUSTOM_API_URL not set')
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model || 'default',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content || data.content?.[0]?.text || ''
}

async function analyzeChunk(chunk) {
  const history = chunks.slice(-10).map(c => c.text).join('\n')

  // Hook: beforeAnalysis — enrich context (RAG, graph query, CRM lookup, etc.)
  let extraContext = ''
  if (hooks.beforeAnalysis) {
    try { extraContext = await hooks.beforeAnalysis(chunk, history, userContext) || '' } catch {}
  }

  const prompt = buildPrompt(chunk, history) + (extraContext ? '\n\nAdditional context from your pipeline:\n' + extraContext : '')

  try {
    const raw = await callLLM(prompt)
    const cleaned = raw.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned)

    if (parsed.sentiment) {
      currentSentiment = parsed.sentiment
      broadcast({ type: 'sentiment', level: parsed.sentiment })
    }

    if (parsed.keywords?.length > 0) {
      broadcast({ type: 'keyword', words: parsed.keywords })
    }

    if (parsed.insight) {
      broadcast({ type: 'insight', text: parsed.insight })
    }

    if (parsed.suggestion) {
      broadcast({ type: 'suggestion', text: parsed.suggestion })
    }

    if (parsed.objection_detected && parsed.objection_detected !== 'null') {
      broadcast({
        type: 'objection',
        text: parsed.objection_detected,
        response: parsed.objection_response,
      })
    }

    if (parsed.budget_signal && parsed.budget_signal !== 'null') {
      broadcast({ type: 'budget', text: parsed.budget_signal })
    }

    if (parsed.closing_opportunity) {
      broadcast({ type: 'closing', text: parsed.closing_script || 'Closing opportunity detected' })
    }

    if (parsed.danger && parsed.danger !== 'null') {
      broadcast({ type: 'danger', text: parsed.danger })
    }

    // Hook: afterAnalysis — enrich or transform insights
    const finalInsights = hooks.afterAnalysis
      ? await hooks.afterAnalysis(parsed, chunk, history).catch(() => parsed)
      : parsed

    insights = [...insights, { ...finalInsights, ts: Date.now() }]
  } catch (err) {
    broadcast({ type: 'system', text: `Analysis pending (${provider})...` })
  }
}

// ─── Demo Mode ───────────────────────────────────────────────
// Demo is now UI-only (via DEMO button in the browser).
// Server --demo flag just skips CDP connection.

// ─── Main ────────────────────────────────────────────────────

console.log(`\n  Call Prompter`)
console.log(`  ─────────────`)
console.log(`  WebSocket: ws://127.0.0.1:${WS_PORT}`)
console.log(`  UI:        file://${join(__dirname, 'ui.html')}`)
console.log(`  Provider:  ${provider}${model ? ' (' + model + ')' : ''}`)
console.log(`  Prospect:  ${prospect}`)
console.log(`  Context:   ${context}`)
console.log(`  Playbook:  ${userContext ? contextFilePath || 'context.md' : 'none'}`)
console.log(`  Hooks:     ${hooksPath || 'none'}`)
console.log(`  Mode:      ${isDemo ? 'DEMO' : 'LIVE (CDP port ' + CDP_PORT + ')'}`)
console.log(`  Capture:   every ${CAPTURE_INTERVAL_MS / 1000}s (captions → instant)`)
console.log(`  Analysis:  every ${ANALYSIS_INTERVAL_MS / 1000}s (LLM → insights)`)
console.log(`\n  UI shortcuts: +/- font size, Space pause, C clear, F fullscreen`)
console.log(`  Double-click in UI to toggle demo mode\n`)

await loadHooks()

if (!isDemo) {
  // Persistent CDP stream — captions arrive instantly via MutationObserver
  // Reconnect check every 3s (in case Meet tab opens/closes)
  setInterval(connectCdpStream, CAPTURE_INTERVAL_MS)
  setTimeout(connectCdpStream, 1000)

  // LLM analysis every 15s — merges recent chunks, non-blocking
  setInterval(analysisLoop, ANALYSIS_INTERVAL_MS)
  setTimeout(analysisLoop, 5000)
}
