/**
 * Call Prompter — Chrome Extension Content Script
 *
 * Injected into Google Meet pages. Reads live captions from the DOM
 * and sends them to the local Call Prompter server via WebSocket.
 *
 * Debounces captions (waits for text to stabilize before sending)
 * and filters out Meet UI garbage (arrows, buttons, speaker labels).
 */

const WS_URL = 'ws://127.0.0.1:4242'

// Caption container selectors (Google Meet specific)
const CAPTION_SELECTORS = [
  '[jsname="tgaKEf"]',
  '[data-message-text]',
  '.iOzk7',
  '.TBMuR',
  'div[class*="caption"]',
]

// Garbage patterns to filter out (Meet UI elements)
const GARBAGE_PATTERNS = [
  /arrow_downward/i,
  /arrow_upward/i,
  /aller en bas/i,
  /go to bottom/i,
  /scroll down/i,
  /^vous$/i,
  /^you$/i,
  /^meet$/i,
  /^[a-z]{1,3}$/i,          // Single short words that are just fragments
  /^\s*$/,                    // Empty/whitespace
]

let ws = null
let connected = false
let reconnectTimer = null
let lastSentText = ''
let debounceTimer = null
let currentCaption = ''

function log(msg) {
  console.log(`[Call Prompter] ${msg}`)
}

// ─── WebSocket ───────────────────────────────────────────────

function connectWs() {
  if (ws && ws.readyState <= 1) return

  try {
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      connected = true
      log('Connected to prompter server')
    }

    ws.onclose = () => {
      connected = false
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connectWs, 5000)
    }

    ws.onerror = () => ws.close()
  } catch {
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connectWs, 5000)
  }
}

// ─── Caption cleaning ────────────────────────────────────────

function cleanCaption(raw) {
  // Split into lines/segments
  const parts = raw.split(/\n|\r/).map(s => s.trim()).filter(Boolean)

  const cleaned = parts.filter(part => {
    // Remove garbage patterns
    for (const pattern of GARBAGE_PATTERNS) {
      if (pattern.test(part)) return false
    }
    // Remove very short fragments (likely UI artifacts)
    if (part.length < 4) return false
    return true
  })

  return cleaned.join(' ').replace(/\s+/g, ' ').trim()
}

function extractSpeaker(container) {
  // Try to find speaker name from Meet's caption structure
  // Meet shows "Speaker Name" before the caption text
  const nameEl = container.querySelector('[class*="name"], [class*="speaker"], [jsname]')
  if (nameEl && nameEl.textContent.length < 30 && nameEl.textContent.length > 1) {
    const name = nameEl.textContent.trim()
    // Filter out known non-name elements
    if (!GARBAGE_PATTERNS.some(p => p.test(name)) && name.length > 1) {
      return name
    }
  }
  return null
}

// ─── Caption reading with debounce ───────────────────────────

function readCaptions() {
  for (const sel of CAPTION_SELECTORS) {
    const containers = document.querySelectorAll(sel)
    if (containers.length === 0) continue

    // Get text from all caption containers
    const texts = []
    let speaker = null

    containers.forEach(container => {
      // Try to extract speaker
      if (!speaker) speaker = extractSpeaker(container)

      // Get all text nodes, skip nested interactive elements
      const spans = container.querySelectorAll('span')
      if (spans.length > 0) {
        spans.forEach(span => {
          const t = span.textContent.trim()
          if (t) texts.push(t)
        })
      } else {
        const t = container.textContent.trim()
        if (t) texts.push(t)
      }
    })

    const raw = texts.join(' ')
    const cleaned = cleanCaption(raw)

    if (cleaned && cleaned.length > 3 && cleaned !== currentCaption) {
      currentCaption = cleaned

      // Debounce: wait 1.5s for caption to stabilize before sending
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (currentCaption && currentCaption !== lastSentText) {
          sendCaption(currentCaption, speaker)
          lastSentText = currentCaption
        }
      }, 1500)
    }
    return
  }
}

function sendCaption(text, speaker) {
  if (!connected || !ws || ws.readyState !== 1) return

  ws.send(JSON.stringify({
    type: 'caption',
    text,
    speaker: speaker || 'Meet',
    ts: Date.now(),
    source: 'extension',
  }))
}

// ─── MutationObserver ────────────────────────────────────────

const observer = new MutationObserver(() => readCaptions())

function startObserving() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // Backup poll every 2s (less aggressive)
  setInterval(readCaptions, 2000)

  log('Caption observer started (with 1.5s debounce)')
}

// ─── Message handler ─────────────────────────────────────────

chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({
      connected,
      lastText: lastSentText.slice(0, 50),
      url: window.location.href,
    })
  }
})

// ─── Start ───────────────────────────────────────────────────

log('Initializing on ' + window.location.href)
connectWs()

if (document.readyState === 'complete') {
  startObserving()
} else {
  window.addEventListener('load', startObserving)
}
