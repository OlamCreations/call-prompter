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
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_PORT = Number(process.env.PROMPTER_PORT) || 4242
const CDP_PORT = Number(process.env.CDP_PORT) || 9222
const CAPTURE_INTERVAL_MS = Number(process.env.CAPTURE_INTERVAL) || 3000
const ANALYSIS_INTERVAL_MS = Number(process.env.ANALYSIS_INTERVAL) || 15000
const MAX_HISTORY_CHUNKS = 60

// ─── Args ────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(name) { return args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') }

const isDemo = args.includes('--demo')
const prospect = getArg('prospect') || 'Unknown'
const context = getArg('context') || 'Sales call'
const brief = getArg('brief') || ''
const provider = getArg('provider') || process.env.PROMPTER_PROVIDER || 'claude'
const model = getArg('model') || process.env.PROMPTER_MODEL || ''
const contextFilePath = getArg('context-file') || ''

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

const wss = new WebSocketServer({ port: WS_PORT })
const clients = new Set()

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  broadcast({ type: 'system', text: `Prompter actif — ${prospect} — ${context}` })
})

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data)
  }
}

// ─── CDP Caption Capture ─────────────────────────────────────

async function getCdpTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
    const targets = await res.json()
    return targets.filter(t => t.url?.includes('meet.google.com'))
  } catch {
    return []
  }
}

async function captureCaption(wsUrl) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(wsUrl)
      let result = ''
      let msgId = 1

      ws.onopen = () => {
        // Enable captions container query
        ws.send(JSON.stringify({
          id: msgId++,
          method: 'Runtime.evaluate',
          params: {
            expression: `
              (() => {
                // Google Meet captions container
                const captions = document.querySelectorAll('[jsname="tgaKEf"], [data-message-text], .iOzk7, [jscontroller="TEjod"] span, .TBMuR span');
                if (captions.length === 0) {
                  // Fallback: look for any caption-like elements
                  const allSpans = document.querySelectorAll('div[class*="caption"] span, div[class*="subtitle"] span');
                  return Array.from(allSpans).map(el => el.textContent).filter(Boolean).join(' ');
                }
                return Array.from(captions).map(el => el.textContent).filter(Boolean).join(' ');
              })()
            `,
            returnByValue: true,
          },
        }))
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.result?.result?.value) {
            result = msg.result.result.value
          }
        } catch { /* ignore */ }
        ws.close()
      }

      ws.onclose = () => resolve(result)
      ws.onerror = () => resolve('')

      setTimeout(() => { try { ws.close() } catch {} resolve(result) }, 5000)
    } catch {
      resolve('')
    }
  })
}

async function captureLoop() {
  const targets = await getCdpTargets()
  if (targets.length === 0) {
    broadcast({ type: 'system', text: 'Aucun onglet Google Meet trouvé. Ouvre Meet et active les sous-titres.' })
    return
  }

  const wsUrl = targets[0].webSocketDebuggerUrl
  if (!wsUrl) {
    broadcast({ type: 'system', text: 'CDP WebSocket non disponible pour Meet.' })
    return
  }

  const caption = await captureCaption(wsUrl)
  if (!caption || caption.length < 5) return

  // Deduplicate: skip if same as last chunk
  const lastChunk = chunks[chunks.length - 1]
  if (lastChunk && caption === lastChunk.text) return

  const chunk = { text: caption, ts: Date.now() }
  chunks = [...chunks, chunk].slice(-MAX_HISTORY_CHUNKS)

  broadcast({ type: 'transcript', speaker: 'Meet', text: caption })

  // Hook: onTranscript
  if (hooks.onTranscript) {
    try { await hooks.onTranscript(chunk) } catch {}
  }

  // Analysis runs on its own interval, not blocking caption capture
}

// Analysis loop — runs independently from capture, async
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

function demoLoop() {
  const scenarios = [
    () => {
      broadcast({ type: 'transcript', speaker: 'Prospect', text: 'Right now our team spends about 15 hours a week on manual data entry across three different systems...' })
      setTimeout(() => {
        broadcast({ type: 'keyword', words: ['manual data entry', '15h/week', 'three systems'] })
        broadcast({ type: 'sentiment', level: 'warm' })
        broadcast({ type: 'suggestion', text: 'Quantify the cost: "15 hours at your team\'s rate, that\'s roughly $3,000/month on copy-paste work?"' })
      }, 2000)
    },
    () => {
      broadcast({ type: 'transcript', speaker: 'Prospect', text: 'Yeah probably around $3,000-4,000 if you count the errors and rework too...' })
      setTimeout(() => {
        broadcast({ type: 'budget', text: '$3,000-4,000/month current cost -> your solution at $299/month = 10x ROI' })
        broadcast({ type: 'insight', text: 'Massive pain point. Error cost on top of time cost = strong urgency signal.' })
        broadcast({ type: 'sentiment', level: 'hot' })
      }, 2000)
    },
    () => {
      broadcast({ type: 'transcript', speaker: 'You', text: 'We can automate all three integrations. Most teams are live within a week...' })
      setTimeout(() => {
        broadcast({ type: 'closing', text: '"For your volume, $299/month vs $4,000 wasted = instant ROI. Want to start a pilot this week?"' })
      }, 1500)
    },
    () => {
      broadcast({ type: 'transcript', speaker: 'Prospect', text: 'That sounds interesting but I need to run this by my CTO first...' })
      setTimeout(() => {
        broadcast({ type: 'danger', text: '"Run by my CTO" = decision delayed. Lock down a follow-up NOW.' })
        broadcast({ type: 'suggestion', text: '"Totally get it. When is your next sync with your CTO? I can send a technical one-pager."' })
        broadcast({ type: 'sentiment', level: 'cool' })
      }, 2000)
    },
    () => {
      broadcast({ type: 'transcript', speaker: 'Prospect', text: 'We have a standup Thursday actually. If you could send something before that...' })
      setTimeout(() => {
        broadcast({ type: 'insight', text: 'Prospect wants to champion this internally. Send the brief tonight.' })
        broadcast({ type: 'suggestion', text: '"Perfect. I\'ll send a one-pager tonight. Want to book a 15-min call with your CTO on Friday?"' })
        broadcast({ type: 'sentiment', level: 'warm' })
      }, 2000)
    },
  ]

  let i = 0
  setInterval(() => {
    scenarios[i % scenarios.length]()
    i++
  }, 8000)
}

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

if (isDemo) {
  demoLoop()
} else {
  // Fast caption capture (every 3s) — transcript appears instantly
  setInterval(captureLoop, CAPTURE_INTERVAL_MS)
  setTimeout(captureLoop, 2000)

  // Slower LLM analysis (every 15s) — insights appear with slight delay
  setInterval(analysisLoop, ANALYSIS_INTERVAL_MS)
  setTimeout(analysisLoop, 5000)
}
