#!/usr/bin/env node

/**
 * Call Prompter Server — Real-time sales co-pilot
 *
 * 1. Connects to Google Meet via Chrome CDP (port 9222)
 * 2. Captures live captions every ~15 seconds
 * 3. Sends chunks to Claude for real-time analysis
 * 4. Streams insights to UI via WebSocket (port 4242)
 *
 * Usage:
 *   bun server.mjs --prospect="Company X" --context="Discovery call"
 *   bun server.mjs --demo   (fake data for testing UI)
 *
 * Requirements:
 *   - Chrome running with --remote-debugging-port=9222
 *   - Google Meet open with captions enabled
 *   - Claude Code CLI available (or ANTHROPIC_API_KEY set)
 */

import { WebSocketServer } from 'ws'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WS_PORT = Number(process.env.PROMPTER_PORT) || 4242
const CDP_PORT = 9222
const CAPTURE_INTERVAL_MS = 15000
const MAX_HISTORY_CHUNKS = 60

// ─── Args ────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isDemo = args.includes('--demo')
const prospect = args.find(a => a.startsWith('--prospect='))?.split('=')[1] || 'Unknown'
const context = args.find(a => a.startsWith('--context='))?.split('=')[1] || 'Sales call'
const brief = args.find(a => a.startsWith('--brief='))?.split('=')[1] || ''

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

  // Analyze
  await analyzeChunk(chunk)
}

// ─── Claude Analysis ─────────────────────────────────────────

async function analyzeChunk(chunk) {
  const history = chunks.slice(-10).map(c => c.text).join('\n')

  const prompt = `You are a real-time sales co-pilot. Analyze this latest conversation chunk.

Prospect: ${prospect}
Context: ${context}
${brief ? 'Brief: ' + brief : ''}

Latest chunk (15s):
${chunk.text}

Recent history:
${history}

Respond in strict JSON (no markdown, no backticks):
{"keywords":["word1","word2"],"sentiment":"hot|warm|cool|cold","insight":"key observation","suggestion":"what the seller should do NOW","objection_detected":"or null","objection_response":"or null","budget_signal":"or null","closing_opportunity":false,"closing_script":"or null","danger":"or null"}`

  try {
    const result = execFileSync('claude', ['-p', prompt, '--output-format', 'text'], {
      timeout: 20000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL: '1' },
    })

    const cleaned = result.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(cleaned)

    // Broadcast each insight type
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
      broadcast({ type: 'closing', text: parsed.closing_script || 'Opportunité de closing détectée' })
    }

    if (parsed.danger && parsed.danger !== 'null') {
      broadcast({ type: 'danger', text: parsed.danger })
    }

    insights = [...insights, { ...parsed, ts: Date.now() }]
  } catch (err) {
    // Silent fail — don't interrupt the call
    broadcast({ type: 'system', text: 'Analyse en cours...' })
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

console.log(`\n  Metatron Call Prompter`)
console.log(`  ─────────────────────`)
console.log(`  WebSocket: ws://127.0.0.1:${WS_PORT}`)
console.log(`  UI:        file://${join(__dirname, 'ui.html')}?port=${WS_PORT}`)
console.log(`  Prospect:  ${prospect}`)
console.log(`  Context:   ${context}`)
console.log(`  Mode:      ${isDemo ? 'DEMO' : 'LIVE (CDP port ' + CDP_PORT + ')'}`)
console.log(`  Interval:  ${CAPTURE_INTERVAL_MS / 1000}s`)
console.log(`\n  Raccourcis UI: +/- taille, Espace pause, C clear, F fullscreen`)
console.log(`  Double-clic dans l'UI pour le mode démo\n`)

if (isDemo) {
  demoLoop()
} else {
  setInterval(captureLoop, CAPTURE_INTERVAL_MS)
  // First capture after 3s
  setTimeout(captureLoop, 3000)
}
